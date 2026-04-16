
 #!/usr/bin/env python3
"""
Quick inference test to verify the new model works end-to-end.
Run: python test_inference.py
"""

import json
from pathlib import Path

import torch
from src.model import build_model

# ── Configuration ───────────────────────────────────────────────────────────

MODEL_PATH = "src/weights/best_model.pth"
CLASS_NAMES_PATH = "src/weights/class_names.json"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# ── Load model ──────────────────────────────────────────────────────────────

print("Loading model...")

# Load class names
if Path(CLASS_NAMES_PATH).is_file():
    with open(CLASS_NAMES_PATH) as f:
        class_names = json.load(f)
    print(f"✓ Loaded {len(class_names)} classes from {CLASS_NAMES_PATH}")
else:
    class_names = [f"class_{i}" for i in range(38)]
    print(f"⚠ No class names found, using generic names")

num_classes = len(class_names)

# Build and load model
model = build_model(num_classes=num_classes, freeze_backbone=False)
state_dict = torch.load(
    MODEL_PATH, map_location=torch.device(DEVICE), weights_only=True
)
model.load_state_dict(state_dict)
model.to(DEVICE)
model.eval()

print(f"✓ Model loaded from {MODEL_PATH} on {DEVICE}")

# ── Test inference ──────────────────────────────────────────────────────────

print("\nRunning inference test...")

# Create a dummy batch
dummy_input = torch.randn(1, 3, 224, 224).to(DEVICE)

with torch.no_grad():
    logits = model(dummy_input)
    probs = torch.softmax(logits, dim=1)
    top_k = torch.topk(probs, k=min(5, num_classes))

print(f"Top-5 predictions for dummy input:")
for idx, (prob, class_idx) in enumerate(zip(top_k.values[0], top_k.indices[0]), 1):
    print(f"  {idx}. {class_names[class_idx]}: {prob.item():.4f}")

print(f"\n✓ Inference test passed!")
