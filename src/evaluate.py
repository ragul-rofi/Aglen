"""
evaluate.py — Model evaluation and reporting for Aglen.

Runs inference on a held-out split, computes per-class and aggregate
metrics, and produces a JSON report plus a normalised confusion-matrix
heatmap.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # non-interactive backend — safe in headless envs
import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn as nn
from pydantic import BaseModel, Field
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix as sk_confusion_matrix,
    f1_score,
)
from tqdm import tqdm

from src.dataset import get_dataloaders, PlantDiseaseDataset
from src.model import load_model


# ── Report schema ───────────────────────────────────────────────────────────


class EvaluationReport(BaseModel):
    """Structured evaluation results (serialisable to JSON)."""

    overall_accuracy: float
    weighted_f1: float
    per_class: dict[str, dict[str, float]]
    confusion_matrix: list[list[int]]
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


# ── Core evaluation ────────────────────────────────────────────────────────


@torch.no_grad()
def evaluate_model(
    model: nn.Module,
    test_loader: torch.utils.data.DataLoader,
    class_names: list[str],
    device: str,
) -> EvaluationReport:
    """Run inference on *test_loader* and compute full metrics.

    Args:
        model: Trained model (already in ``eval`` mode on *device*).
        test_loader: DataLoader for the evaluation split.
        class_names: Ordered list of human-readable class names.
        device: Target device string.

    Returns:
        A populated ``EvaluationReport``.
    """
    model.eval()
    all_preds: list[int] = []
    all_labels: list[int] = []

    for images, labels in tqdm(test_loader, desc="Evaluating", leave=False):
        images = images.to(device, non_blocking=True)
        preds = model(images).argmax(dim=1).cpu().tolist()
        all_preds.extend(preds)
        all_labels.extend(labels.tolist())

    # Aggregate metrics
    overall_acc = accuracy_score(all_labels, all_preds)
    weighted_f1 = f1_score(all_labels, all_preds, average="weighted", zero_division=0)

    # Per-class from sklearn classification_report
    report_dict = classification_report(
        all_labels,
        all_preds,
        target_names=class_names,
        output_dict=True,
        zero_division=0,
    )

    per_class: dict[str, dict[str, float]] = {}
    for name in class_names:
        entry = report_dict[name]
        per_class[name] = {
            "precision": round(entry["precision"], 4),
            "recall": round(entry["recall"], 4),
            "f1": round(entry["f1-score"], 4),
            "support": int(entry["support"]),
        }

    # Confusion matrix
    cm = sk_confusion_matrix(all_labels, all_preds)

    return EvaluationReport(
        overall_accuracy=round(overall_acc, 4),
        weighted_f1=round(weighted_f1, 4),
        per_class=per_class,
        confusion_matrix=cm.tolist(),
    )


# ── Persistence ─────────────────────────────────────────────────────────────


def save_report(report: EvaluationReport, output_path: str) -> None:
    """Write the evaluation report as pretty-printed JSON.

    Args:
        report: The report to save.
        output_path: Destination file path (created if missing).
    """
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(report.model_dump(), f, indent=2)
    print(f"Report saved → {path}")


# ── Visualisation ───────────────────────────────────────────────────────────


def plot_confusion_matrix(
    report: EvaluationReport,
    output_path: str,
    class_names: list[str] | None = None,
) -> None:
    """Render and save a row-normalised confusion-matrix heatmap.

    Args:
        report: Evaluation report containing the raw confusion matrix.
        output_path: Where to save the PNG file.
        class_names: Optional labels for axes; uses indices if *None*.
    """
    cm = np.array(report.confusion_matrix, dtype=np.float64)

    # Row-normalise (each row sums to 1)
    row_sums = cm.sum(axis=1, keepdims=True)
    row_sums[row_sums == 0] = 1  # avoid div-by-zero for empty classes
    cm_norm = cm / row_sums

    n_classes = cm.shape[0]
    fig, ax = plt.subplots(figsize=(20, 20))

    im = ax.imshow(cm_norm, interpolation="nearest", cmap="Blues", vmin=0, vmax=1)
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)

    # Tick labels
    labels = class_names if class_names else [str(i) for i in range(n_classes)]
    tick_fontsize = max(4, min(8, 200 // n_classes))

    ax.set_xticks(range(n_classes))
    ax.set_yticks(range(n_classes))
    ax.set_xticklabels(labels, rotation=90, fontsize=tick_fontsize, ha="center")
    ax.set_yticklabels(labels, fontsize=tick_fontsize)

    # Cell annotations (only if fewer than 20 classes — too dense otherwise)
    if n_classes <= 20:
        for i in range(n_classes):
            for j in range(n_classes):
                colour = "white" if cm_norm[i, j] > 0.5 else "black"
                ax.text(
                    j, i, f"{cm_norm[i, j]:.2f}",
                    ha="center", va="center",
                    fontsize=6, color=colour,
                )

    ax.set_xlabel("Predicted", fontsize=12)
    ax.set_ylabel("True", fontsize=12)
    ax.set_title(
        f"Normalised Confusion Matrix  |  Accuracy {report.overall_accuracy:.2%}  "
        f"F1 {report.weighted_f1:.4f}",
        fontsize=14,
    )
    fig.tight_layout()

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"Confusion matrix saved → {path}")


# ── Analysis helpers ────────────────────────────────────────────────────────


def find_worst_classes(report: EvaluationReport, n: int = 5) -> list[str]:
    """Return the *n* class names with the lowest F1 scores.

    Useful for directing Grad-CAM inspection to the hardest classes.

    Args:
        report: Evaluation report with per-class metrics.
        n: Number of worst classes to return.

    Returns:
        List of class-name strings, ordered worst-first.
    """
    ranked = sorted(
        report.per_class.items(),
        key=lambda item: item[1]["f1"],
    )
    return [name for name, _ in ranked[:n]]


# ── CLI entry point ─────────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments for evaluation."""
    parser = argparse.ArgumentParser(
        description="Aglen — Evaluate trained model",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--checkpoint",
        type=str,
        required=True,
        help="Path to model checkpoint (.pth).",
    )
    parser.add_argument(
        "--data-root",
        type=str,
        default="data/plantvillage",
        help="Root directory of the PlantVillage dataset.",
    )
    parser.add_argument(
        "--split",
        type=str,
        default="val",
        choices=["train", "val", "test"],
        help="Which dataset split to evaluate on.",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="outputs/eval",
        help="Directory to save report and plots.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=64,
        help="Batch size for inference.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Device: {device}\n")

    # Load data
    loaders = get_dataloaders(
        root_dir=args.data_root,
        batch_size=args.batch_size,
        num_workers=4,
    )

    if args.split not in loaders:
        print(f"✗ Split '{args.split}' not found. Available: {list(loaders.keys())}")
        sys.exit(1)

    eval_loader = loaders[args.split]
    eval_ds: PlantDiseaseDataset = eval_loader.dataset  # type: ignore[assignment]
    class_names = eval_ds.class_names
    print(f"Split: {args.split}  |  Samples: {len(eval_ds)}  |  Classes: {len(class_names)}")

    # Load model
    model = load_model(
        checkpoint_path=args.checkpoint,
        num_classes=len(class_names),
        device=device,
    )
    print(f"Checkpoint loaded: {args.checkpoint}\n")

    # Evaluate
    report = evaluate_model(model, eval_loader, class_names, device)

    print(f"Overall accuracy : {report.overall_accuracy:.4f}")
    print(f"Weighted F1      : {report.weighted_f1:.4f}")

    # Worst classes
    worst = find_worst_classes(report, n=5)
    print(f"\nWorst-performing classes (by F1):")
    for i, name in enumerate(worst, 1):
        metrics = report.per_class[name]
        print(
            f"  {i}. {name}  —  "
            f"P={metrics['precision']:.3f}  R={metrics['recall']:.3f}  "
            f"F1={metrics['f1']:.3f}  (n={metrics['support']})"
        )

    # Save outputs
    output_dir = Path(args.output_dir)
    save_report(report, str(output_dir / "evaluation_report.json"))
    plot_confusion_matrix(report, str(output_dir / "confusion_matrix.png"), class_names)

    print(f"\n✓ Evaluation complete. Results in {output_dir}/")
