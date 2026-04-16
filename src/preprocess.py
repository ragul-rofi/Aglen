"""
preprocess.py — Image preprocessing pipeline for Aglen.

Provides load, denoise, normalize, resize-with-padding, and a full
pipeline that chains them into a model-ready float32 tensor.
All operations use OpenCV + NumPy only (no framework dependency).
"""

from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import cv2
import numpy as np


# ── Individual transforms ───────────────────────────────────────────────────


def load_image(path: str) -> np.ndarray:
    """Load an image from disk and return it as an RGB uint8 array.

    Args:
        path: Absolute or relative path to the image file.

    Returns:
        np.ndarray of shape (H, W, 3), dtype uint8, in RGB order.

    Raises:
        FileNotFoundError: If *path* does not point to an existing file.
        ValueError: If the file exists but OpenCV cannot decode it.
    """
    resolved = Path(path).resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"Image not found: {resolved}")

    img = cv2.imread(str(resolved), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"OpenCV failed to decode image: {resolved}")

    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def denoise(img: np.ndarray, kernel_size: int = 5) -> np.ndarray:
    """Apply Gaussian blur to reduce high-frequency noise.

    Args:
        img: Input image array (H, W, 3), any dtype.
        kernel_size: Side length of the square Gaussian kernel.
                     Must be a positive odd integer.

    Returns:
        Blurred image with the same shape and dtype as *img*.

    Raises:
        ValueError: If *kernel_size* is not a positive odd integer.
    """
    if kernel_size < 1 or kernel_size % 2 == 0:
        raise ValueError(
            f"kernel_size must be a positive odd integer, got {kernel_size}"
        )

    return cv2.GaussianBlur(img, (kernel_size, kernel_size), sigmaX=0)


def normalize(img: np.ndarray) -> np.ndarray:
    """Scale pixel values from [0, 255] uint8 to [0.0, 1.0] float32.

    Args:
        img: Input image array, expected dtype uint8.

    Returns:
        float32 array with values in [0, 1], same spatial shape.
    """
    return img.astype(np.float32) / 255.0


def resize_and_pad(img: np.ndarray, target: int = 224) -> np.ndarray:
    """Resize an image to fit inside a *target* × *target* square,
    preserving aspect ratio and padding the remainder with black.

    Args:
        img: Input image array (H, W, 3), dtype uint8.
        target: Side length of the output square in pixels.

    Returns:
        uint8 array of shape (*target*, *target*, 3).
    """
    h, w = img.shape[:2]
    scale = target / max(h, w)
    new_w = int(w * scale)
    new_h = int(h * scale)

    resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

    canvas = np.zeros((target, target, 3), dtype=np.uint8)

    # Centre the resized image on the canvas
    y_offset = (target - new_h) // 2
    x_offset = (target - new_w) // 2
    canvas[y_offset : y_offset + new_h, x_offset : x_offset + new_w] = resized

    return canvas


# ── Full pipeline ───────────────────────────────────────────────────────────


def preprocess_pipeline(path: str) -> np.ndarray:
    """End-to-end preprocessing: load → denoise → resize & pad → normalize.

    Args:
        path: Path to an image file on disk.

    Returns:
        float32 array of shape (224, 224, 3) with values in [0, 1].
    """
    img = load_image(path)
    img = denoise(img)
    img = resize_and_pad(img, target=224)
    img = normalize(img)
    return img


def batch_preprocess(
    paths: list[str], workers: int = 4
) -> list[np.ndarray]:
    """Process multiple images in parallel using a thread pool.

    Args:
        paths: List of image file paths.
        workers: Maximum number of concurrent threads.

    Returns:
        List of preprocessed float32 arrays, one per input path,
        in the same order as *paths*.

    Raises:
        Exception: Re-raises the first exception encountered during
                   processing so the caller can handle it.
    """
    results: list[np.ndarray | None] = [None] * len(paths)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_idx = {
            pool.submit(preprocess_pipeline, p): i for i, p in enumerate(paths)
        }

        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            results[idx] = future.result()  # propagates exceptions

    return results  # type: ignore[return-value]


# ── CLI sanity check ────────────────────────────────────────────────────────


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m src.preprocess <image_path>")
        sys.exit(1)

    image_path = sys.argv[1]
    print(f"Processing: {image_path}")

    out = preprocess_pipeline(image_path)
    print(f"  Shape : {out.shape}")
    print(f"  Dtype : {out.dtype}")
    print(f"  Range : [{out.min():.4f}, {out.max():.4f}]")
    print("  ✓ Sanity check passed.")
