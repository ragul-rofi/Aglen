"""
gradcam.py — Grad-CAM explainability engine for Aglen.

This is the core differentiator of the project. Every function here
exists to answer one question: *"Why did the model say that?"*

The engine wraps ``pytorch-grad-cam``, adds automatic overlay
generation, and — most importantly — produces a **human-readable
activation summary** that translates raw heatmap statistics into
language a farmer, agronomist, or non-ML stakeholder can act on.
"""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from pydantic import BaseModel, Field
from pytorch_grad_cam import GradCAM
from pytorch_grad_cam.utils.model_targets import ClassifierOutputTarget

from src.preprocess import load_image, resize_and_pad
from src.dataset import get_transforms, IMAGENET_MEAN, IMAGENET_STD


# ── Explanation schema ──────────────────────────────────────────────────────


class ExplanationResult(BaseModel):
    """Self-contained explanation payload returned by ``GradCAMEngine.explain``.

    Every field is JSON-serialisable so it can be sent straight to the
    frontend or saved to disk.
    """

    predicted_class: str
    confidence: float = Field(ge=0.0, le=1.0)
    class_idx: int
    heatmap_base64: str
    activation_summary: str


# ── Disease-context knowledge base ──────────────────────────────────────────
# Short, actionable descriptions for the most common PlantVillage classes.
# Used by generate_activation_summary() to contextualise the heatmap.

DISEASE_CONTEXT: dict[str, str] = {
    "Tomato___Late_blight": (
        "large, dark, water-soaked lesions that typically begin at leaf edges "
        "and expand inward — often with a pale green or yellow border"
    ),
    "Tomato___Early_blight": (
        "concentric ring (target-shaped) lesions on older leaves, usually "
        "surrounded by yellowing tissue"
    ),
    "Tomato___Bacterial_spot": (
        "small, angular, dark spots that may merge into larger necrotic "
        "patches, sometimes with a yellow halo"
    ),
    "Tomato___Leaf_Mold": (
        "pale green-to-yellow diffuse patches on the upper leaf surface with "
        "olive-green to brown velvety growth beneath"
    ),
    "Tomato___Septoria_leaf_spot": (
        "numerous small circular spots with dark borders and grey centres, "
        "often on lower foliage first"
    ),
    "Potato___Late_blight": (
        "irregular dark blotches with a water-soaked margin, rapidly "
        "expanding under humid conditions"
    ),
    "Potato___Early_blight": (
        "dark brown circular lesions with distinct concentric rings, "
        "progressing from lower to upper leaves"
    ),
    "Apple___Apple_scab": (
        "olive-green to dark, velvety, irregular spots on the leaf surface "
        "that may cause curling or distortion"
    ),
    "Grape___Black_rot": (
        "circular tan lesions bordered by a dark brown ring, often with "
        "tiny black fruiting bodies in the centre"
    ),
    "Corn_(maize)___Common_rust_": (
        "elongated brick-red to brown pustules scattered across both leaf "
        "surfaces, releasing powdery spores"
    ),
}

# Healthy-leaf generic wording
_HEALTHY_CONTEXT = (
    "a uniformly coloured, undamaged leaf surface — the model found no "
    "localised disease indicators"
)

_FALLBACK_CONTEXT = "visible lesion or discolouration patterns on the leaf surface"


# ── Spatial helpers ─────────────────────────────────────────────────────────


_GRID_LABELS: dict[tuple[int, int], str] = {
    (0, 0): "upper-left",    (0, 1): "upper-centre",   (0, 2): "upper-right",
    (1, 0): "centre-left",   (1, 1): "centre",         (1, 2): "centre-right",
    (2, 0): "lower-left",    (2, 1): "lower-centre",   (2, 2): "lower-right",
}


def _centroid_to_region(cy: float, cx: float, h: int, w: int) -> str:
    """Map a centroid (cy, cx) to a human-friendly region name on a 3×3 grid."""
    row = min(int(cy / h * 3), 2)
    col = min(int(cx / w * 3), 2)
    return _GRID_LABELS[(row, col)]


# ── Activation summary generator ───────────────────────────────────────────


def generate_activation_summary(
    heatmap: np.ndarray,
    predicted_class: str,
) -> str:
    """Translate a Grad-CAM heatmap into a readable explanation.

    The summary communicates three things a non-technical user cares about:

    1. **How much** of the leaf the model looked at (activated area %).
    2. **Where** on the leaf it focused (spatial region).
    3. **What that pattern means** for the predicted disease.

    Args:
        heatmap: Float32 array of shape (H, W), values in [0, 1].
        predicted_class: The human-readable class name from the model output.

    Returns:
        A one-to-three sentence natural-language explanation.
    """
    h, w = heatmap.shape

    # ── Area percentage (pixels with activation > 0.5) ──────────────────
    activated_mask = heatmap > 0.5
    area_pct = activated_mask.sum() / (h * w) * 100

    # ── High-activation region (> 0.7) bounding box & centroid ──────────
    hot_mask = heatmap > 0.7
    hot_pixels = hot_mask.sum()

    if hot_pixels > 0:
        ys, xs = np.where(hot_mask)
        cy, cx = ys.mean(), xs.mean()
        position = _centroid_to_region(cy, cx, h, w)

        # Bounding-box extent relative to image — gives a sense of spread
        bbox_h = (ys.max() - ys.min()) / h * 100
        bbox_w = (xs.max() - xs.min()) / w * 100
        spread = max(bbox_h, bbox_w)
    else:
        # Very diffuse activation — fall back to > 0.5 centroid
        if activated_mask.sum() > 0:
            ys, xs = np.where(activated_mask)
            cy, cx = ys.mean(), xs.mean()
            position = _centroid_to_region(cy, cx, h, w)
        else:
            position = "centre"
        spread = 0.0

    # ── Disease context ─────────────────────────────────────────────────
    if "healthy" in predicted_class.lower():
        disease_context = _HEALTHY_CONTEXT
    else:
        disease_context = DISEASE_CONTEXT.get(predicted_class, _FALLBACK_CONTEXT)

    # ── Compose the summary ─────────────────────────────────────────────
    # Intensity descriptor
    if area_pct < 10:
        focus_desc = "a highly localised"
    elif area_pct < 30:
        focus_desc = "a moderately focused"
    elif area_pct < 60:
        focus_desc = "a broad"
    else:
        focus_desc = "a very diffuse"

    summary = (
        f"The model applied {focus_desc} attention to {area_pct:.0f}% of the "
        f"leaf surface, concentrating primarily on the {position} region."
    )

    # Spread insight (only when there's a clear hot zone)
    if spread > 0:
        if spread < 20:
            summary += (
                " The high-confidence activation is tightly clustered, "
                "suggesting a single distinct feature drove the prediction."
            )
        elif spread < 50:
            summary += (
                " The activation spans a moderate area, consistent with "
                "a lesion or pattern covering part of the leaf."
            )
        else:
            summary += (
                " The activation is spread across a large portion of the leaf, "
                "indicating widespread or systemic visual symptoms."
            )

    summary += f" For {predicted_class.replace('_', ' ')}, this pattern typically indicates {disease_context}."

    return summary


# ── Engine ──────────────────────────────────────────────────────────────────


class GradCAMEngine:
    """Grad-CAM wrapper that turns a ResNet into an explainable predictor.

    Args:
        model: A trained ``nn.Module`` (must expose ``layer4``).
        device: Device string (``'cpu'`` or ``'cuda'``).
        class_names: Ordered list of class labels. If *None*, the engine
                     returns integer indices instead of names.
    """

    def __init__(
        self,
        model: nn.Module,
        device: str,
        class_names: list[str] | None = None,
    ) -> None:
        self.model = model
        self.device = device
        self.class_names = class_names

        self.model.to(self.device)
        self.model.eval()

        # Auto-detect target layer: last conv block in ResNet
        self.target_layer = self.model.layer4[-1]

        self._cam = GradCAM(
            model=self.model,
            target_layers=[self.target_layer],
        )

        # Inference transform (deterministic, no augmentation)
        self._transform = get_transforms("val")

    # ── Heatmap generation ──────────────────────────────────────────────

    def generate_heatmap(
        self,
        image_tensor: torch.Tensor,
        class_idx: int | None = None,
    ) -> np.ndarray:
        """Compute Grad-CAM heatmap for a single image.

        Args:
            image_tensor: Pre-processed tensor of shape ``(1, 3, 224, 224)``.
            class_idx: Target class. If *None*, the predicted (argmax) class
                       is used.

        Returns:
            Float32 array of shape ``(224, 224)`` with values in ``[0, 1]``.
        """
        image_tensor = image_tensor.to(self.device)

        # Resolve target class
        if class_idx is None:
            with torch.no_grad():
                logits = self.model(image_tensor)
            class_idx = int(logits.argmax(dim=1).item())

        targets = [ClassifierOutputTarget(class_idx)]

        # pytorch-grad-cam returns (B, H, W) float32 [0, 1]
        heatmap = self._cam(
            input_tensor=image_tensor,
            targets=targets,
        )

        return heatmap[0]  # (224, 224)

    # ── Overlay ─────────────────────────────────────────────────────────

    @staticmethod
    def overlay_heatmap(
        original_img: np.ndarray,
        heatmap: np.ndarray,
        alpha: float = 0.4,
    ) -> np.ndarray:
        """Blend a Grad-CAM heatmap over the original image.

        Args:
            original_img: ``(224, 224, 3)`` uint8 RGB, **not normalised**.
            heatmap: ``(224, 224)`` float32 in ``[0, 1]``.
            alpha: Heatmap opacity (0 = invisible, 1 = opaque).

        Returns:
            ``(224, 224, 3)`` uint8 RGB blended overlay.
        """
        # Scale heatmap to uint8 for colour-mapping
        heatmap_uint8 = (heatmap * 255).astype(np.uint8)

        # JET colourmap expects single-channel uint8 → returns BGR
        jet_bgr = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)
        jet_rgb = cv2.cvtColor(jet_bgr, cv2.COLOR_BGR2RGB)

        # Resize if shapes don't match
        h, w = original_img.shape[:2]
        if jet_rgb.shape[:2] != (h, w):
            jet_rgb = cv2.resize(jet_rgb, (w, h))

        overlay = cv2.addWeighted(original_img, 1 - alpha, jet_rgb, alpha, 0)
        return overlay

    # ── Full explain pipeline ───────────────────────────────────────────

    def explain(self, image_path: str) -> ExplanationResult:
        """End-to-end: image path → ``ExplanationResult``.

        1. Load and resize the raw image (for overlay).
        2. Apply inference transforms → tensor.
        3. Forward pass → predicted class + confidence.
        4. Grad-CAM → heatmap.
        5. Overlay → base64 PNG.
        6. Activation summary → human-readable text.

        Args:
            image_path: Path to a leaf image on disk.

        Returns:
            Fully populated ``ExplanationResult``.
        """
        # Raw image (for overlay — must be uint8 RGB, 224×224)
        raw_img = load_image(image_path)
        raw_224 = resize_and_pad(raw_img, target=224)

        # Transformed tensor for the model
        augmented = self._transform(image=raw_224)
        tensor = augmented["image"].unsqueeze(0).to(self.device)  # (1,3,224,224)

        # Prediction
        with torch.no_grad():
            logits = self.model(tensor)
            probs = F.softmax(logits, dim=1)

        class_idx = int(probs.argmax(dim=1).item())
        confidence = float(probs[0, class_idx].item())

        if self.class_names and class_idx < len(self.class_names):
            predicted_class = self.class_names[class_idx]
        else:
            predicted_class = str(class_idx)

        # Grad-CAM heatmap
        heatmap = self.generate_heatmap(tensor, class_idx=class_idx)

        # Overlay
        overlay = self.overlay_heatmap(raw_224, heatmap, alpha=0.4)

        # Encode overlay as base64 PNG
        pil_overlay = Image.fromarray(overlay)
        buffer = io.BytesIO()
        pil_overlay.save(buffer, format="PNG")
        heatmap_b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

        # Activation summary
        summary = generate_activation_summary(heatmap, predicted_class)

        return ExplanationResult(
            predicted_class=predicted_class,
            confidence=round(confidence, 4),
            class_idx=class_idx,
            heatmap_base64=heatmap_b64,
            activation_summary=summary,
        )


# ── Gallery generator ───────────────────────────────────────────────────────


def batch_explain_gallery(
    engine: GradCAMEngine,
    dataset,
    class_names: list[str],
    n_per_class: int = 3,
    output_path: str = "outputs/gradcam_gallery.json",
) -> dict[str, list[ExplanationResult]]:
    """Generate a Grad-CAM gallery with *n_per_class* examples per class.

    Iterates through the dataset, collects up to *n_per_class* samples for
    every class, runs ``engine.explain`` on each, and persists the results
    to JSON.

    Args:
        engine: An initialised ``GradCAMEngine``.
        dataset: A ``PlantDiseaseDataset`` instance.
        class_names: Ordered list of class labels.
        n_per_class: How many examples to generate per class.
        output_path: Where to save the JSON gallery.

    Returns:
        Dict keyed by class name, values are lists of ``ExplanationResult``.
    """
    from collections import defaultdict
    from tqdm import tqdm

    # Bucket sample indices by label
    class_buckets: dict[int, list[int]] = defaultdict(list)
    for idx in range(len(dataset)):
        _, label = dataset._samples[idx]
        if len(class_buckets[label]) < n_per_class:
            class_buckets[label].append(idx)

    gallery: dict[str, list[ExplanationResult]] = {}
    total = sum(len(v) for v in class_buckets.values())

    with tqdm(total=total, desc="Generating gallery") as pbar:
        for label_idx, sample_indices in sorted(class_buckets.items()):
            cname = class_names[label_idx]
            gallery[cname] = []

            for sample_idx in sample_indices:
                img_path, _ = dataset._samples[sample_idx]
                try:
                    result = engine.explain(str(img_path))
                    gallery[cname].append(result)
                except Exception as exc:
                    print(f"  ⚠ Skipped {img_path.name}: {exc}")
                pbar.update(1)

    # Save to disk
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    serialisable = {
        cname: [r.model_dump() for r in results]
        for cname, results in gallery.items()
    }
    with open(out, "w") as f:
        json.dump(serialisable, f, indent=2)
    print(f"Gallery saved → {out}  ({total} explanations)")

    return gallery


# ── CLI sanity check ────────────────────────────────────────────────────────


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print(
            "Usage: python -m src.gradcam <checkpoint_path> <image_path>\n"
            "  e.g. python -m src.gradcam src/weights/best_model.pth data/sample.jpg"
        )
        sys.exit(1)

    checkpoint_path = sys.argv[1]
    image_path = sys.argv[2]

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Device: {device}")

    # Load class names from train split
    from src.dataset import PlantDiseaseDataset

    try:
        train_ds = PlantDiseaseDataset("data/plantvillage", split="train")
        names = train_ds.class_names
    except FileNotFoundError:
        names = None
        print("⚠ Could not load class names — using indices.")

    from src.model import load_model

    num_classes = len(names) if names else 38
    model = load_model(checkpoint_path, num_classes=num_classes, device=device)

    engine = GradCAMEngine(model=model, device=device, class_names=names)
    result = engine.explain(image_path)

    print(f"\n{'═' * 60}")
    print(f"  Predicted : {result.predicted_class}")
    print(f"  Confidence: {result.confidence:.2%}")
    print(f"  Class idx : {result.class_idx}")
    print(f"{'─' * 60}")
    print(f"  {result.activation_summary}")
    print(f"{'─' * 60}")
    print(f"  Overlay   : {len(result.heatmap_base64)} chars (base64 PNG)")
    print(f"{'═' * 60}")
