"""
utils.py — Shared helpers for the Aglen API layer.

Handles image decoding from both upload files and base64 strings,
file-size / format validation, and numpy ↔ base64 conversion.
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# ── Constants ───────────────────────────────────────────────────────────────

MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}


# ── Validation ──────────────────────────────────────────────────────────────


def validate_content_type(content_type: str | None) -> None:
    """Raise ``ValueError`` if *content_type* is not an accepted image MIME."""
    if content_type and content_type not in ALLOWED_MIME_TYPES:
        raise ValueError(
            f"Unsupported image format: {content_type}. "
            f"Accepted: {', '.join(sorted(ALLOWED_MIME_TYPES))}"
        )


def validate_file_size(data: bytes) -> None:
    """Raise ``ValueError`` if *data* exceeds the 10 MB limit."""
    if len(data) > MAX_FILE_BYTES:
        size_mb = len(data) / (1024 * 1024)
        raise ValueError(
            f"Image too large ({size_mb:.1f} MB). Maximum allowed: "
            f"{MAX_FILE_BYTES / (1024 * 1024):.0f} MB."
        )


# ── Decoding ────────────────────────────────────────────────────────────────


def bytes_to_rgb_array(data: bytes) -> np.ndarray:
    """Decode raw image bytes into a uint8 RGB numpy array.

    Args:
        data: Raw JPEG / PNG / WebP bytes.

    Returns:
        ``(H, W, 3)`` uint8 array in RGB order.

    Raises:
        ValueError: If the bytes cannot be decoded as an image.
    """
    try:
        pil_img = Image.open(io.BytesIO(data)).convert("RGB")
        return np.array(pil_img)
    except Exception as exc:
        raise ValueError(f"Cannot decode image bytes: {exc}") from exc


def base64_to_rgb_array(b64_string: str) -> np.ndarray:
    """Decode a base64-encoded image string to uint8 RGB array.

    Strips the optional ``data:image/...;base64,`` prefix if present.
    """
    # Strip data-URI prefix
    if "," in b64_string and b64_string.startswith("data:"):
        b64_string = b64_string.split(",", 1)[1]

    try:
        raw = base64.b64decode(b64_string)
    except Exception as exc:
        raise ValueError(f"Invalid base64 encoding: {exc}") from exc

    validate_file_size(raw)
    return bytes_to_rgb_array(raw)


def numpy_to_base64_png(img: np.ndarray) -> str:
    """Encode a uint8 RGB array as a base64 PNG string."""
    pil_img = Image.fromarray(img)
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")
