"""
train.py — Full training loop for Aglen with W&B logging.

Features:
  • Mixed-precision training (AMP) when CUDA is available
  • CosineAnnealingLR or ReduceLROnPlateau scheduling
  • Early stopping on validation loss (patience=5)
  • Best-model checkpointing
  • Per-epoch metrics logged to Weights & Biases
  • Final confusion matrix uploaded to W&B
  • training_log.json saved alongside the checkpoint
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import f1_score
from torch.cuda.amp import GradScaler, autocast
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR, ReduceLROnPlateau
from tqdm import tqdm

import wandb

from src.dataset import PlantDiseaseDataset, get_dataloaders
from src.model import ModelConfig, build_model, count_parameters


# ── Single epoch ────────────────────────────────────────────────────────────


def train_one_epoch(
    model: nn.Module,
    loader: torch.utils.data.DataLoader,
    optimizer: torch.optim.Optimizer,
    criterion: nn.Module,
    device: str,
    epoch: int,
    scaler: GradScaler | None = None,
) -> dict[str, float]:
    """Run one training epoch with optional mixed-precision.

    Args:
        model: The network to train.
        loader: Training DataLoader.
        optimizer: Optimiser instance.
        criterion: Loss function.
        device: Target device string.
        epoch: Current epoch number (for display only).
        scaler: ``GradScaler`` for AMP, or *None* to disable.

    Returns:
        ``{'loss': float, 'accuracy': float}`` averaged over the epoch.
    """
    model.train()
    running_loss = 0.0
    correct = 0
    total = 0

    use_amp = scaler is not None

    pbar = tqdm(loader, desc=f"Epoch {epoch:>3d} [train]", leave=False)
    for images, labels in pbar:
        images = images.to(device, non_blocking=True)
        labels = labels.to(device, non_blocking=True)

        optimizer.zero_grad(set_to_none=True)

        with autocast(device_type="cuda", enabled=use_amp):
            logits = model(images)
            loss = criterion(logits, labels)

        if use_amp:
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
        else:
            loss.backward()
            optimizer.step()

        batch_size = labels.size(0)
        running_loss += loss.item() * batch_size
        correct += (logits.argmax(dim=1) == labels).sum().item()
        total += batch_size

        pbar.set_postfix(
            loss=f"{running_loss / total:.4f}",
            acc=f"{correct / total:.4f}",
        )

    epoch_loss = running_loss / total
    epoch_acc = correct / total
    return {"loss": epoch_loss, "accuracy": epoch_acc}


# ── Validation ──────────────────────────────────────────────────────────────


@torch.no_grad()
def validate(
    model: nn.Module,
    loader: torch.utils.data.DataLoader,
    criterion: nn.Module,
    device: str,
) -> dict[str, float]:
    """Evaluate model on a validation/test set.

    Args:
        model: The network to evaluate.
        loader: Validation DataLoader.
        criterion: Loss function.
        device: Target device string.

    Returns:
        ``{'loss': float, 'accuracy': float, 'f1': float}``
        where F1 is the weighted-average over all classes.
    """
    model.eval()
    running_loss = 0.0
    correct = 0
    total = 0
    all_preds: list[int] = []
    all_labels: list[int] = []

    pbar = tqdm(loader, desc="          [val]  ", leave=False)
    for images, labels in pbar:
        images = images.to(device, non_blocking=True)
        labels = labels.to(device, non_blocking=True)

        logits = model(images)
        loss = criterion(logits, labels)

        batch_size = labels.size(0)
        running_loss += loss.item() * batch_size
        preds = logits.argmax(dim=1)
        correct += (preds == labels).sum().item()
        total += batch_size

        all_preds.extend(preds.cpu().tolist())
        all_labels.extend(labels.cpu().tolist())

    epoch_loss = running_loss / total
    epoch_acc = correct / total
    epoch_f1 = f1_score(all_labels, all_preds, average="weighted", zero_division=0)

    return {"loss": epoch_loss, "accuracy": epoch_acc, "f1": epoch_f1}


# ── Full training run ───────────────────────────────────────────────────────


def train(
    config: ModelConfig,
    data_root: str,
    save_dir: str,
) -> None:
    """Execute the full training pipeline.

    Args:
        config: Hyperparameter configuration.
        data_root: Path to the PlantVillage data root.
        save_dir: Directory for checkpoints and logs.
    """
    save_path = Path(save_dir)
    save_path.mkdir(parents=True, exist_ok=True)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    use_amp = device == "cuda"
    print(f"Device: {device}  |  AMP: {use_amp}")

    # ── W&B ─────────────────────────────────────────────────────────────
    wandb.init(project="aglen", config=config.model_dump())

    # ── Data ────────────────────────────────────────────────────────────
    loaders = get_dataloaders(
        root_dir=data_root,
        batch_size=config.batch_size,
        num_workers=4,
    )
    train_loader = loaders["train"]
    val_loader = loaders.get("val")

    if val_loader is None:
        print("⚠  No validation split found — using train metrics for checkpointing.")

    train_ds: PlantDiseaseDataset = train_loader.dataset  # type: ignore[assignment]
    class_names = train_ds.class_names
    print(f"Classes: {len(class_names)}  |  Train samples: {len(train_ds)}")

    # ── Model ───────────────────────────────────────────────────────────
    model = build_model(num_classes=config.num_classes, freeze_backbone=True)
    model.to(device)

    params = count_parameters(model)
    print(f"Parameters — total: {params['total']:,}  trainable: {params['trainable']:,}")
    wandb.config.update(params)

    # ── Optimiser & scheduler ───────────────────────────────────────────
    criterion = nn.CrossEntropyLoss()
    optimizer = AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=config.learning_rate,
        weight_decay=config.weight_decay,
    )

    if config.scheduler == "cosine":
        scheduler = CosineAnnealingLR(optimizer, T_max=config.epochs)
    elif config.scheduler == "plateau":
        scheduler = ReduceLROnPlateau(
            optimizer, mode="min", factor=0.5, patience=3, verbose=True
        )
    else:
        raise ValueError(f"Unknown scheduler: {config.scheduler!r}")

    scaler = GradScaler() if use_amp else None

    # ── Training state ──────────────────────────────────────────────────
    best_val_loss = float("inf")
    patience_counter = 0
    patience = 5
    training_log: list[dict] = []

    # Collect all predictions for final confusion matrix
    final_all_preds: list[int] = []
    final_all_labels: list[int] = []

    # ── Epoch loop ──────────────────────────────────────────────────────
    print(f"\n{'═' * 60}")
    print(f"  Starting training — {config.epochs} epochs")
    print(f"{'═' * 60}\n")

    for epoch in range(1, config.epochs + 1):
        current_lr = optimizer.param_groups[0]["lr"]

        train_metrics = train_one_epoch(
            model, train_loader, optimizer, criterion, device, epoch, scaler
        )

        # Validate
        if val_loader is not None:
            val_metrics = validate(model, val_loader, criterion, device)
        else:
            val_metrics = {"loss": train_metrics["loss"], "accuracy": train_metrics["accuracy"], "f1": 0.0}

        # Step scheduler
        if config.scheduler == "cosine":
            scheduler.step()
        elif config.scheduler == "plateau":
            scheduler.step(val_metrics["loss"])

        # ── Logging ─────────────────────────────────────────────────────
        epoch_record = {
            "epoch": epoch,
            "lr": current_lr,
            "train_loss": train_metrics["loss"],
            "train_acc": train_metrics["accuracy"],
            "val_loss": val_metrics["loss"],
            "val_acc": val_metrics["accuracy"],
            "val_f1": val_metrics["f1"],
        }
        training_log.append(epoch_record)

        wandb.log({
            "epoch": epoch,
            "lr": current_lr,
            "train/loss": train_metrics["loss"],
            "train/accuracy": train_metrics["accuracy"],
            "val/loss": val_metrics["loss"],
            "val/accuracy": val_metrics["accuracy"],
            "val/f1": val_metrics["f1"],
        })

        print(
            f"Epoch {epoch:>3d}/{config.epochs}  │  "
            f"lr {current_lr:.2e}  │  "
            f"train loss {train_metrics['loss']:.4f}  acc {train_metrics['accuracy']:.4f}  │  "
            f"val loss {val_metrics['loss']:.4f}  acc {val_metrics['accuracy']:.4f}  f1 {val_metrics['f1']:.4f}"
        )

        # ── Checkpointing ──────────────────────────────────────────────
        if val_metrics["loss"] < best_val_loss:
            best_val_loss = val_metrics["loss"]
            patience_counter = 0
            ckpt_path = save_path / "best_model.pth"
            torch.save(model.state_dict(), ckpt_path)
            print(f"          ✓ Saved best model → {ckpt_path}")
        else:
            patience_counter += 1

        # ── Early stopping ──────────────────────────────────────────────
        if patience_counter >= patience:
            print(f"\n⚠  Early stopping at epoch {epoch} (patience={patience})")
            break

    # ── Final confusion matrix ──────────────────────────────────────────
    print(f"\n{'─' * 60}")
    print("  Generating final confusion matrix...")
    print(f"{'─' * 60}\n")

    # Reload best model for final eval
    best_ckpt = save_path / "best_model.pth"
    if best_ckpt.is_file():
        model.load_state_dict(
            torch.load(str(best_ckpt), map_location=device, weights_only=True)
        )

    eval_loader = val_loader if val_loader is not None else train_loader
    model.eval()
    with torch.no_grad():
        for images, labels in tqdm(eval_loader, desc="Final eval", leave=False):
            images = images.to(device, non_blocking=True)
            preds = model(images).argmax(dim=1).cpu().tolist()
            final_all_preds.extend(preds)
            final_all_labels.extend(labels.tolist())

    wandb.log({
        "confusion_matrix": wandb.plot.confusion_matrix(
            probs=None,
            y_true=final_all_labels,
            preds=final_all_preds,
            class_names=class_names,
        )
    })

    # ── Save training log ───────────────────────────────────────────────
    log_path = save_path / "training_log.json"
    with open(log_path, "w") as f:
        json.dump(training_log, f, indent=2)
    print(f"Training log saved → {log_path}")

    wandb.finish()

    print(f"\n{'═' * 60}")
    print(f"  Training complete!")
    print(f"  Best val loss : {best_val_loss:.4f}")
    print(f"  Checkpoint    : {save_path / 'best_model.pth'}")
    print(f"  Log           : {log_path}")
    print(f"{'═' * 60}\n")


# ── CLI entry point ─────────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments for training."""
    parser = argparse.ArgumentParser(
        description="Aglen — Train plant disease classifier",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--data-root",
        type=str,
        default="data/plantvillage",
        help="Root directory of the PlantVillage dataset.",
    )
    parser.add_argument(
        "--save-dir",
        type=str,
        default="src/weights",
        help="Directory to save checkpoints and logs.",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=25,
        help="Number of training epochs.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="Batch size for training and validation.",
    )
    parser.add_argument(
        "--lr",
        type=float,
        default=1e-4,
        help="Initial learning rate.",
    )
    parser.add_argument(
        "--scheduler",
        type=str,
        default="cosine",
        choices=["cosine", "plateau"],
        help="Learning rate scheduler type.",
    )
    parser.add_argument(
        "--weight-decay",
        type=float,
        default=1e-5,
        help="AdamW weight decay.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()

    config = ModelConfig(
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        weight_decay=args.weight_decay,
        scheduler=args.scheduler,
    )

    print(f"Config: {config.model_dump()}\n")

    train(config=config, data_root=args.data_root, save_dir=args.save_dir)
