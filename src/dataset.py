"""
dataset.py — PyTorch Dataset and DataLoader factory for PlantVillage.

Expects the standard folder-per-class layout::

    root_dir/
      train/
        Apple___Apple_scab/
          img001.jpg
          ...
        Apple___healthy/
          ...
      val/
        ...
      test/   (optional)
        ...

Uses Albumentations for all augmentation pipelines.
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path
from typing import Literal

import albumentations as A
import numpy as np
from albumentations.pytorch import ToTensorV2
from PIL import Image
from torch.utils.data import DataLoader, Dataset

# ── ImageNet channel statistics ─────────────────────────────────────────────

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


# ── Augmentation pipelines ──────────────────────────────────────────────────


def get_transforms(split: str) -> A.Compose:
    """Return an Albumentations pipeline for the requested split.

    Args:
        split: One of ``'train'``, ``'val'``, or ``'test'``.

    Returns:
        An ``A.Compose`` pipeline that outputs a dict with key ``image``
        (float32 tensor, C×H×W) after ``ToTensorV2``.
    """
    if split == "train":
        return A.Compose([
            A.RandomResizedCrop(
                height=224, width=224, scale=(0.8, 1.0), ratio=(0.9, 1.1)
            ),
            A.HorizontalFlip(p=0.5),
            A.RandomBrightnessContrast(
                brightness_limit=0.2, contrast_limit=0.2, p=0.3
            ),
            A.ColorJitter(
                brightness=0.2, contrast=0.2, saturation=0.2, hue=0.1, p=0.3
            ),
            A.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
            ToTensorV2(),
        ])

    # val / test share the same deterministic pipeline
    return A.Compose([
        A.Resize(height=256, width=256),
        A.CenterCrop(height=224, width=224),
        A.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
        ToTensorV2(),
    ])


# ── Dataset ─────────────────────────────────────────────────────────────────


class PlantDiseaseDataset(Dataset):
    """A map-style PyTorch Dataset for the PlantVillage folder layout.

    Args:
        root_dir: Path to the top-level data directory (e.g. ``data/plantvillage``).
        split: Which sub-folder to load — ``'train'``, ``'val'``, or ``'test'``.
        transform: An optional ``A.Compose`` pipeline. If *None*, the
                   default pipeline for the given *split* is used.

    Raises:
        FileNotFoundError: If the resolved split directory does not exist.
    """

    def __init__(
        self,
        root_dir: str,
        split: Literal["train", "val", "test"] = "train",
        transform: A.Compose | None = None,
    ) -> None:
        self._split = split
        self._split_dir = Path(root_dir) / split

        # Kaggle PlantVillage uses "valid" instead of "val" — handle both
        if not self._split_dir.is_dir() and split == "val":
            alt = Path(root_dir) / "valid"
            if alt.is_dir():
                self._split_dir = alt

        if not self._split_dir.is_dir():
            raise FileNotFoundError(
                f"Split directory not found: {self._split_dir.resolve()}"
            )

        self._transform = transform or get_transforms(split)

        # Build sorted class list → deterministic label mapping
        class_dirs = sorted(
            d for d in self._split_dir.iterdir() if d.is_dir()
        )
        self._class_names: list[str] = [d.name for d in class_dirs]
        self._label_to_idx: dict[str, int] = {
            name: idx for idx, name in enumerate(self._class_names)
        }

        # Collect all (image_path, label) pairs
        self._samples: list[tuple[Path, int]] = []
        for class_dir in class_dirs:
            label = self._label_to_idx[class_dir.name]
            for img_path in sorted(class_dir.iterdir()):
                if img_path.suffix.lower() in IMAGE_EXTENSIONS:
                    self._samples.append((img_path, label))

    # ── Public helpers ──────────────────────────────────────────────────

    @property
    def class_names(self) -> list[str]:
        """Sorted list of human-readable class names."""
        return list(self._class_names)

    @property
    def num_classes(self) -> int:
        """Total number of disease/healthy classes."""
        return len(self._class_names)

    @property
    def label_to_idx(self) -> dict[str, int]:
        """Mapping from class folder name to integer label."""
        return dict(self._label_to_idx)

    # ── Dataset protocol ────────────────────────────────────────────────

    def __len__(self) -> int:  # noqa: D105
        return len(self._samples)

    def __getitem__(self, index: int):  # noqa: D105
        img_path, label = self._samples[index]

        # Load via PIL → numpy RGB array
        image = np.array(Image.open(img_path).convert("RGB"))

        # Apply Albumentations pipeline
        augmented = self._transform(image=image)
        tensor = augmented["image"]  # float32, C×H×W after ToTensorV2

        return tensor, label

    def __repr__(self) -> str:
        return (
            f"PlantDiseaseDataset(split='{self._split}', "
            f"classes={self.num_classes}, samples={len(self)})"
        )


# ── DataLoader factory ──────────────────────────────────────────────────────


def get_dataloaders(
    root_dir: str,
    batch_size: int = 32,
    num_workers: int = 4,
) -> dict[str, DataLoader]:
    """Create DataLoaders for every available split under *root_dir*.

    Missing ``val/`` or ``test/`` directories are silently skipped —
    only ``train`` is required.

    Args:
        root_dir: Path to the top-level data directory.
        batch_size: Batch size for all loaders.
        num_workers: Parallel data-loading workers.

    Returns:
        Dict keyed by ``'train'``, ``'val'``, and/or ``'test'`` with
        the corresponding ``DataLoader`` instances.

    Raises:
        FileNotFoundError: If the ``train/`` split is missing.
    """
    loaders: dict[str, DataLoader] = {}

    for split in ("train", "val", "test"):
        split_path = Path(root_dir) / split

        if not split_path.is_dir():
            if split == "train":
                raise FileNotFoundError(
                    f"Training split is required but not found: {split_path.resolve()}"
                )
            # val/test are optional — skip gracefully
            continue

        dataset = PlantDiseaseDataset(root_dir, split=split)

        loaders[split] = DataLoader(
            dataset,
            batch_size=batch_size,
            shuffle=(split == "train"),
            num_workers=num_workers,
            pin_memory=True,
            drop_last=(split == "train"),
        )

    return loaders


# ── CLI sanity check ────────────────────────────────────────────────────────


if __name__ == "__main__":
    data_root = sys.argv[1] if len(sys.argv) > 1 else "data/plantvillage"
    print(f"Loading data from: {data_root}\n")

    loaders = get_dataloaders(data_root, batch_size=32, num_workers=0)

    for split_name, loader in loaders.items():
        ds: PlantDiseaseDataset = loader.dataset  # type: ignore[assignment]
        print(f"── {split_name} ──")
        print(f"  Classes : {ds.num_classes}")
        print(f"  Samples : {len(ds)}")

        # Grab one batch to verify shapes
        images, labels = next(iter(loader))
        print(f"  Batch   : images {tuple(images.shape)}, labels {tuple(labels.shape)}")
        print(f"  Dtype   : {images.dtype}")
        print()

    # Label distribution for train
    if "train" in loaders:
        train_ds: PlantDiseaseDataset = loaders["train"].dataset  # type: ignore[assignment]
        label_counts = Counter(label for _, label in train_ds._samples)
        print("── Train label distribution (top 10) ──")
        for label_idx, count in label_counts.most_common(10):
            name = train_ds.class_names[label_idx]
            print(f"  [{label_idx:2d}] {name}: {count}")
        print(f"  ... ({len(label_counts)} classes total)")
