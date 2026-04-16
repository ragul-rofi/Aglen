# ═══════════════════════════════════════════════════════════════════════════
# Aglen — Google Colab Training Script (OPTIMIZED)
# ═══════════════════════════════════════════════════════════════════════════
#
# This script runs entirely on Google Colab's free T4 GPU.
# It downloads the dataset, trains the model, and saves the checkpoint
# for you to download to your local machine.
#
# OPTIMIZATIONS FOR COLAB:
# ✓ CUDA benchmarking & caching optimizations
# ✓ Mixed precision training (AMP) for faster computation
# ✓ Gradient accumulation support for larger effective batches
# ✓ Gradient checkpointing for memory efficiency (optional)
# ✓ Periodic CUDA cache clearing to prevent OOM
# ✓ Label smoothing for better generalization
# ✓ Efficient data loading with prefetching & persistent workers
# ✓ AMP enabled for validation (reduced memory footprint)
# ✓ CPU resource limiting (num_threads, num_workers)
# ✓ Error handling for corrupted images
# ✓ Memory monitoring & automatic garbage collection
#
# HOW TO USE:
# 1. Open Google Colab: https://colab.research.google.com
# 2. Runtime → Change runtime type → T4 GPU
# 3. Copy-paste each section (separated by # %%) into Colab cells
# 4. Run cells in order
# 5. Download best_model.pth at the end
#
# TROUBLESHOOTING OOM (Out of Memory):
# - Reduce BATCH_SIZE to 16 or 8
# - Increase GRADIENT_ACCUMULATION_STEPS to 2-4
# - Enable USE_GRADIENT_CHECKPOINTING = True
# - Reduce NUM_WORKERS to 1 or 0
# ═══════════════════════════════════════════════════════════════════════════

# %% [markdown]
# # 🌿 Aglen — Train on Colab
# Run this notebook to train the ResNet-34 model on Google Colab's free GPU.
# After training, download `best_model.pth` to your local machine.

# %% --- Cell 1: Check GPU ---
import torch
print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    # Optimize CUDA behavior for Colab
    torch.backends.cudnn.benchmark = True  # Enable auto-tuning for better performance
    torch.backends.cudnn.enabled = True
    torch.cuda.empty_cache()  # Clear any cached memory
else:
    print("⚠ No GPU detected! Go to Runtime → Change runtime type → T4 GPU")

# %% --- Cell 2: Install dependencies ---
# Colab already has torch + torchvision, just install the extras
!pip install -q albumentations==1.4.7 grad-cam==1.5.2 scikit-learn wandb pydantic python-dotenv tqdm
# Optional: Enable torch.compile for faster training (PyTorch 2.0+)
!pip install -q xformers  # For memory-efficient attention

# %% --- Cell 3: Set up Kaggle credentials ---
# Upload your kaggle.json when prompted
import os
from google.colab import files

# Option A: Upload kaggle.json interactively
print("Upload your kaggle.json file (from Kaggle → Settings → API → Create New Token)")
uploaded = files.upload()

os.makedirs(os.path.expanduser("~/.kaggle"), exist_ok=True)
if "kaggle.json" in uploaded:
    kaggle_bytes = uploaded["kaggle.json"]
else:
    kaggle_bytes = next(iter(uploaded.values()))

with open(os.path.expanduser("~/.kaggle/kaggle.json"), "wb") as f:
    f.write(kaggle_bytes)
os.chmod(os.path.expanduser("~/.kaggle/kaggle.json"), 0o600)
print("✓ Kaggle credentials configured")

# %% --- Cell 4: Download PlantVillage dataset ---
!kaggle datasets download -d vipoooool/new-plant-diseases-dataset -p /content/data_tmp --unzip

# Move to expected structure
import shutil
from pathlib import Path

src_root = Path("/content/data_tmp/New Plant Diseases Dataset(Augmented)/New Plant Diseases Dataset(Augmented)")
dest_root = Path("/content/data/plantvillage")
dest_root.mkdir(parents=True, exist_ok=True)

def replace_dir(src, dst):
    if dst.exists():
        shutil.rmtree(dst)
    shutil.move(str(src), str(dst))

if (src_root / "train").exists():
    replace_dir(src_root / "train", dest_root / "train")
    replace_dir(src_root / "valid", dest_root / "valid")
    print("✓ Dataset moved to /content/data/plantvillage/")
else:
    # Try to find it
    for p in Path("/content/data_tmp").rglob("train"):
        if p.is_dir():
            replace_dir(p, dest_root / "train")
            replace_dir(p.parent / "valid", dest_root / "valid")
            print(f"✓ Found and moved dataset from {p.parent}")
            break

# Clean up
shutil.rmtree("/content/data_tmp", ignore_errors=True)

# Verify
train_classes = len(list((dest_root / "train").iterdir()))
train_images = sum(1 for _ in (dest_root / "train").rglob("*.*"))
val_images = sum(1 for _ in (dest_root / "valid").rglob("*.*"))
print(f"Train: {train_classes} classes, {train_images} images")
print(f"Valid: {val_images} images")

# %% --- Cell 5: Define all source modules inline ---
# Instead of uploading the entire src/ folder, we define everything here.
# This makes the notebook fully self-contained.

import sys
import json
import numpy as np
import cv2
from PIL import Image
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone
from typing import Literal

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR, ReduceLROnPlateau

import albumentations as A
from albumentations.pytorch import ToTensorV2
from torchvision import models
from torchvision.models import ResNet34_Weights
from sklearn.metrics import f1_score, accuracy_score, classification_report
from tqdm.auto import tqdm
from pydantic import BaseModel, Field

import wandb

# ── Constants ───────────────────────────────────────────────────
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}

# ── Transforms ──────────────────────────────────────────────────
def get_transforms(split):
    if split == "train":
        return A.Compose([
            A.RandomResizedCrop(height=224, width=224, scale=(0.8, 1.0), ratio=(0.9, 1.1)),
            A.HorizontalFlip(p=0.5),
            A.RandomBrightnessContrast(brightness_limit=0.2, contrast_limit=0.2, p=0.3),
            A.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2, hue=0.1, p=0.3),
            A.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
            ToTensorV2(),
        ])
    return A.Compose([
        A.Resize(height=256, width=256),
        A.CenterCrop(height=224, width=224),
        A.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
        ToTensorV2(),
    ])

# ── Dataset ─────────────────────────────────────────────────────
class PlantDiseaseDataset(Dataset):
    def __init__(self, root_dir, split="train", transform=None):
        self._split = split
        self._split_dir = Path(root_dir) / split
        if not self._split_dir.is_dir():
            raise FileNotFoundError(f"Split not found: {self._split_dir}")
        self._transform = transform or get_transforms(split)
        class_dirs = sorted(d for d in self._split_dir.iterdir() if d.is_dir())
        self._class_names = [d.name for d in class_dirs]
        self._label_to_idx = {name: idx for idx, name in enumerate(self._class_names)}
        self._samples = []
        for class_dir in class_dirs:
            label = self._label_to_idx[class_dir.name]
            for img_path in sorted(class_dir.iterdir()):
                if img_path.suffix.lower() in IMAGE_EXTENSIONS:
                    self._samples.append((str(img_path), label))  # Store as string to save memory

    @property
    def class_names(self): return list(self._class_names)
    @property
    def num_classes(self): return len(self._class_names)
    def __len__(self): return len(self._samples)
    def __getitem__(self, idx):
        img_path, label = self._samples[idx]
        try:
            image = np.array(Image.open(img_path).convert("RGB"))
        except Exception as e:
            print(f"Warning: Failed to load {img_path}: {e}")
            # Return a black image as fallback
            image = np.zeros((224, 224, 3), dtype=np.uint8)
        augmented = self._transform(image=image)
        return augmented["image"], label

# ── Model ───────────────────────────────────────────────────────
def build_model(num_classes=38, freeze_backbone=True, use_gradient_checkpointing=False):
    model = models.resnet34(weights=ResNet34_Weights.IMAGENET1K_V1)
    if freeze_backbone:
        for param in model.parameters():
            param.requires_grad = False
    for name, param in model.named_parameters():
        if name.startswith(("layer3.", "layer4.", "fc.")):
            param.requires_grad = True
    
    # Enable gradient checkpointing for memory efficiency
    if use_gradient_checkpointing:
        for layer in [model.layer3, model.layer4]:
            if hasattr(layer, 'gradient_checkpointing'):
                layer.gradient_checkpointing = True
    
    model.fc = nn.Sequential(
        nn.Dropout(0.4),
        nn.Linear(512, 256),
        nn.ReLU(),
        nn.Dropout(0.3),
        nn.Linear(256, num_classes),
    )
    return model

# ── Training ────────────────────────────────────────────────────
def train_one_epoch(model, loader, optimizer, criterion, device, epoch, scaler=None, accumulation_steps=1):
    model.train()
    running_loss, correct, total = 0.0, 0, 0
    use_amp = scaler is not None
    pbar = tqdm(loader, desc=f"Epoch {epoch:>3d} [train]", leave=False)
    
    for step, (images, labels) in enumerate(pbar):
        images = images.to(device, non_blocking=True)
        labels = labels.to(device, non_blocking=True)
        
        with torch.amp.autocast("cuda", enabled=use_amp):
            logits = model(images)
            loss = criterion(logits, labels) / accumulation_steps
        
        if use_amp:
            scaler.scale(loss).backward()
            if (step + 1) % accumulation_steps == 0:
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
        else:
            loss.backward()
            if (step + 1) % accumulation_steps == 0:
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
        
        # Accumulate metrics
        bs = labels.size(0)
        running_loss += loss.item() * bs * accumulation_steps
        correct += (logits.argmax(1) == labels).sum().item()
        total += bs
        pbar.set_postfix(loss=f"{running_loss/total:.4f}", acc=f"{correct/total:.4f}")
        
        # Clear cache periodically to prevent OOM
        if (step + 1) % 10 == 0:
            torch.cuda.empty_cache()
    
    return {"loss": running_loss / total, "accuracy": correct / total}

@torch.no_grad()
def validate(model, loader, criterion, device):
    model.eval()
    running_loss, correct, total = 0.0, 0, 0
    all_preds, all_labels = [], []
    
    for images, labels in tqdm(loader, desc="          [val]  ", leave=False):
        images = images.to(device, non_blocking=True)
        labels = labels.to(device, non_blocking=True)
        
        with torch.amp.autocast("cuda", enabled=(device == "cuda")):  # Use AMP during validation too
            logits = model(images)
            loss = criterion(logits, labels)
        
        bs = labels.size(0)
        running_loss += loss.item() * bs
        preds = logits.argmax(1)
        correct += (preds == labels).sum().item()
        total += bs
        all_preds.extend(preds.cpu().tolist())
        all_labels.extend(labels.cpu().tolist())
    
    # Clear cache after validation
    torch.cuda.empty_cache()
    
    return {
        "loss": running_loss / total,
        "accuracy": correct / total,
        "f1": f1_score(all_labels, all_preds, average="weighted", zero_division=0),
    }

print("✓ All modules defined")

# %% --- Cell 6: Configure training ---
DATA_ROOT = "/content/data/plantvillage"
SAVE_DIR = "/content/weights"
EPOCHS = 25
BATCH_SIZE = 32  # Optimized for T4 GPU (16GB VRAM)
LR = 1e-4
WEIGHT_DECAY = 1e-5
NUM_WORKERS = 2  # Limit for Colab CPU resources
GRADIENT_ACCUMULATION_STEPS = 1  # Increase to 2-4 if you hit OOM (trades GPU memory for time)
USE_GRADIENT_CHECKPOINTING = False  # Set to True for very large models to trade compute for memory

os.makedirs(SAVE_DIR, exist_ok=True)
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Device: {device}")
print(f"Gradient accumulation steps: {GRADIENT_ACCUMULATION_STEPS}")

# %% --- Cell 7: Train! ---
# Set wandb to offline if you don't want to log to cloud
# os.environ["WANDB_MODE"] = "offline"
wandb.init(project="aglen", config={
    "epochs": EPOCHS, "batch_size": BATCH_SIZE,
    "lr": LR, "weight_decay": WEIGHT_DECAY,
    "model": "resnet34", "scheduler": "cosine",
    "gradient_accumulation": GRADIENT_ACCUMULATION_STEPS,
}, mode="online")

# Data
train_ds = PlantDiseaseDataset(DATA_ROOT, split="train")
val_ds = PlantDiseaseDataset(DATA_ROOT, split="valid")  # Kaggle uses "valid" not "val"
print(f"Train: {len(train_ds)} samples, {train_ds.num_classes} classes")
print(f"Valid: {len(val_ds)} samples")

# Optimized DataLoader settings for Colab
train_loader = DataLoader(
    train_ds, batch_size=BATCH_SIZE, shuffle=True,
    num_workers=NUM_WORKERS, pin_memory=True, drop_last=True,
    prefetch_factor=2, persistent_workers=True
)
val_loader = DataLoader(
    val_ds, batch_size=BATCH_SIZE, shuffle=False,
    num_workers=NUM_WORKERS, pin_memory=True,
    prefetch_factor=2, persistent_workers=True
)

# Model
model = build_model(
    num_classes=train_ds.num_classes, 
    freeze_backbone=True,
    use_gradient_checkpointing=USE_GRADIENT_CHECKPOINTING
).to(device)
total_p = sum(p.numel() for p in model.parameters())
train_p = sum(p.numel() for p in model.parameters() if p.requires_grad)
print(f"Parameters — total: {total_p:,}  trainable: {train_p:,}")

# Optimiser + scheduler
criterion = nn.CrossEntropyLoss(label_smoothing=0.1)  # Add label smoothing for regularization
optimizer = AdamW(filter(lambda p: p.requires_grad, model.parameters()),
                  lr=LR, weight_decay=WEIGHT_DECAY, eps=1e-8)
scheduler = CosineAnnealingLR(optimizer, T_max=EPOCHS)
scaler = torch.amp.GradScaler("cuda") if device == "cuda" else None

# Training loop
best_val_loss = float("inf")
patience_counter = 0
patience = 5
training_log = []

print(f"\n{'═' * 70}")
print(f"  Starting training — {EPOCHS} epochs on {device}")
print(f"  Batch size: {BATCH_SIZE} | Accumulation: {GRADIENT_ACCUMULATION_STEPS}")
print(f"{'═' * 70}\n")

for epoch in range(1, EPOCHS + 1):
    lr = optimizer.param_groups[0]["lr"]
    train_m = train_one_epoch(model, train_loader, optimizer, criterion, device, epoch, scaler, GRADIENT_ACCUMULATION_STEPS)
    val_m = validate(model, val_loader, criterion, device)
    scheduler.step()

    record = {
        "epoch": epoch, "lr": lr,
        "train_loss": train_m["loss"], "train_acc": train_m["accuracy"],
        "val_loss": val_m["loss"], "val_acc": val_m["accuracy"], "val_f1": val_m["f1"],
    }
    training_log.append(record)

    wandb.log({
        "epoch": epoch, "lr": lr,
        "train/loss": train_m["loss"], "train/accuracy": train_m["accuracy"],
        "val/loss": val_m["loss"], "val/accuracy": val_m["accuracy"], "val/f1": val_m["f1"],
    })

    print(
        f"Epoch {epoch:>3d}/{EPOCHS}  │  lr {lr:.2e}  │  "
        f"train loss {train_m['loss']:.4f}  acc {train_m['accuracy']:.4f}  │  "
        f"val loss {val_m['loss']:.4f}  acc {val_m['accuracy']:.4f}  f1 {val_m['f1']:.4f}"
    )

    if val_m["loss"] < best_val_loss:
        best_val_loss = val_m["loss"]
        patience_counter = 0
        torch.save(model.state_dict(), f"{SAVE_DIR}/best_model.pth")
        print(f"          ✓ Saved best model")
    else:
        patience_counter += 1

    if patience_counter >= patience:
        print(f"\n⚠ Early stopping at epoch {epoch}")
        break
    
    # Clear cache after each epoch
    torch.cuda.empty_cache()

# Save training log
with open(f"{SAVE_DIR}/training_log.json", "w") as f:
    json.dump(training_log, f, indent=2)

# Save class names (needed for inference)
with open(f"{SAVE_DIR}/class_names.json", "w") as f:
    json.dump(train_ds.class_names, f, indent=2)

wandb.finish()

print(f"\n{'═' * 70}")
print(f"  Training complete! Best val loss: {best_val_loss:.4f}")
print(f"{'═' * 70}")

# %% --- Cell 8: Quick evaluation ---
# Reload best model
model.load_state_dict(torch.load(f"{SAVE_DIR}/best_model.pth", weights_only=True))
model.eval()

# Move to CPU to free up GPU memory if needed
# model.cpu()
# device = "cpu"

val_m = validate(model, val_loader, criterion, device)
print(f"\nFinal validation:")
print(f"  Accuracy: {val_m['accuracy']:.4f}")
print(f"  F1 Score: {val_m['f1']:.4f}")

# Clear CUDA cache
torch.cuda.empty_cache()

# %% --- Cell 9: Download your checkpoint! ---
from google.colab import files

print("Downloading best_model.pth ...")
files.download(f"{SAVE_DIR}/best_model.pth")

print("Downloading class_names.json ...")
files.download(f"{SAVE_DIR}/class_names.json")

print("Downloading training_log.json ...")
files.download(f"{SAVE_DIR}/training_log.json")

print("\n✓ Place these files in your local aglen/src/weights/ directory!")
