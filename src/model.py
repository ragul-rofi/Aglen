"""
model.py — ResNet-34 transfer learning architecture for Aglen.

Loads ImageNet-pretrained ResNet-34, selectively unfreezes the last two
residual blocks (layer3, layer4) and the classifier head, then replaces
``fc`` with a custom two-layer head with dropout.
"""

from __future__ import annotations

import sys
from pathlib import Path

import torch
import torch.nn as nn
from pydantic import BaseModel
from torchvision import models
from torchvision.models import ResNet34_Weights


# ── Training configuration ──────────────────────────────────────────────────


class ModelConfig(BaseModel):
    """Centralised hyperparameter store (validated via Pydantic)."""

    num_classes: int = 38
    learning_rate: float = 1e-4
    weight_decay: float = 1e-5
    epochs: int = 25
    batch_size: int = 32
    scheduler: str = "cosine"


# ── Model construction ──────────────────────────────────────────────────────


def build_model(num_classes: int = 38, freeze_backbone: bool = True) -> nn.Module:
    """Build a fine-tunable ResNet-34 for plant disease classification.

    Strategy:
        1. Load ImageNet-pretrained ResNet-34.
        2. Optionally freeze *all* backbone parameters.
        3. Always unfreeze ``layer3``, ``layer4``, and ``fc`` so the
           last two residual blocks and the classifier head are trainable.
        4. Replace the original ``fc`` with a custom head.

    Args:
        num_classes: Number of output disease/healthy classes.
        freeze_backbone: If ``True``, freeze everything first, then
                         selectively unfreeze layer3 + layer4.

    Returns:
        Modified ``nn.Module`` ready for training.
    """
    model = models.resnet34(weights=ResNet34_Weights.IMAGENET1K_V1)

    # Step 1 — optionally freeze every parameter
    if freeze_backbone:
        for param in model.parameters():
            param.requires_grad = False

    # Step 2 — always unfreeze layer3, layer4, and fc
    for name, param in model.named_parameters():
        if name.startswith(("layer3.", "layer4.", "fc.")):
            param.requires_grad = True

    # Step 3 — replace the classifier head
    model.fc = nn.Sequential(
        nn.Dropout(0.4),
        nn.Linear(512, 256),
        nn.ReLU(),
        nn.Dropout(0.3),
        nn.Linear(256, num_classes),
    )

    return model


# ── Checkpoint loading ──────────────────────────────────────────────────────


def load_model(
    checkpoint_path: str,
    num_classes: int = 38,
    device: str = "cpu",
) -> nn.Module:
    """Reconstruct the model and restore weights from a checkpoint.

    Args:
        checkpoint_path: Path to a ``.pth`` file saved by the training loop.
        num_classes: Must match the value used during training.
        device: Target device (``'cpu'``, ``'cuda'``, ``'cuda:0'``, …).

    Returns:
        Model in **eval** mode, on the requested device.

    Raises:
        FileNotFoundError: If *checkpoint_path* does not exist.
    """
    resolved = Path(checkpoint_path).resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"Checkpoint not found: {resolved}")

    model = build_model(num_classes=num_classes, freeze_backbone=False)

    state_dict = torch.load(
        str(resolved),
        map_location=torch.device(device),
        weights_only=True,
    )
    model.load_state_dict(state_dict)
    model.to(device)
    model.eval()

    return model


# ── Introspection ───────────────────────────────────────────────────────────


def count_parameters(model: nn.Module) -> dict[str, int]:
    """Count total, trainable, and frozen parameters.

    Args:
        model: Any ``nn.Module``.

    Returns:
        Dict with keys ``'total'``, ``'trainable'``, ``'frozen'``.
    """
    total = sum(p.numel() for p in model.parameters())
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    frozen = total - trainable

    return {"total": total, "trainable": trainable, "frozen": frozen}


# ── CLI sanity check ────────────────────────────────────────────────────────


if __name__ == "__main__":
    device = "cuda" if torch.cuda.is_available() else "cpu"
    config = ModelConfig()
    print(f"Config: {config.model_dump()}\n")

    model = build_model(num_classes=config.num_classes, freeze_backbone=True)
    model.to(device)

    params = count_parameters(model)
    print(f"Parameters:")
    print(f"  Total     : {params['total']:>12,}")
    print(f"  Trainable : {params['trainable']:>12,}")
    print(f"  Frozen    : {params['frozen']:>12,}")
    print()

    # Forward-pass smoke test
    dummy = torch.randn(1, 3, 224, 224, device=device)
    with torch.no_grad():
        logits = model(dummy)

    print(f"Forward pass:")
    print(f"  Input  : {tuple(dummy.shape)}")
    print(f"  Output : {tuple(logits.shape)}")
    assert logits.shape == (1, config.num_classes), (
        f"Expected (1, {config.num_classes}), got {tuple(logits.shape)}"
    )
    print("  ✓ Output shape verified.")
