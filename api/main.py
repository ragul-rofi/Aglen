"""
main.py — FastAPI inference server for Aglen.

Endpoints
─────────
GET  /health    Liveness check.
POST /predict   Upload leaf image → top-5 disease predictions.
POST /explain   Upload leaf image → predictions + Grad-CAM overlay + summary.
GET  /classes   List all supported disease class names.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import time
import traceback
import uuid
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from dotenv import load_dotenv
from fastapi import FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.db.scans import get_user_scans, save_scan, update_scan_feedback
from api.schemas import (
    ClassConfidence,
    EndpointMetrics,
    ErrorResponse,
    ExplainPersistedResponse,
    ExplainResponse,
    HealthResponse,
    MetricsResponse,
    PredictionRequest,
    PredictionResponse,
    RootResponse,
    ScanFeedbackRequest,
)
from api.utils import (
    ALLOWED_MIME_TYPES,
    MAX_FILE_BYTES,
    base64_to_rgb_array,
    bytes_to_rgb_array,
    validate_content_type,
    validate_file_size,
)
from src.dataset import PlantDiseaseDataset, get_transforms
from src.gradcam import GradCAMEngine
from src.model import build_model
from src.preprocess import resize_and_pad

load_dotenv()

# ── Configuration ───────────────────────────────────────────────────────────

MODEL_PATH = os.getenv("MODEL_PATH", "src/weights/best_model.pth")
DEVICE = os.getenv("DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
NUM_CLASSES = 38
MAX_FILE_MB = MAX_FILE_BYTES / (1024 * 1024)

logger = logging.getLogger("aglen.api")
if not logger.handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )

# ── OpenAPI tags ────────────────────────────────────────────────────────────

TAGS = [
    {
        "name": "Inference",
        "description": "Run disease classification and Grad-CAM explanations.",
    },
    {
        "name": "Meta",
        "description": "Health checks and model metadata.",
    },
    {
        "name": "Scans",
        "description": "Persisted scan history and feedback.",
    },
]


# ── Lifespan ────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model + GradCAM engine on startup, clean up on shutdown."""
    # ── Startup ─────────────────────────────────────────────────────────
    app.state.model = None
    app.state.engine = None
    app.state.class_names = []
    app.state.device = DEVICE
    app.state.transform = get_transforms("val")
    app.state.metrics = {
        "predict": {
            "count": 0,
            "total_ms": 0.0,
            "min_ms": 0.0,
            "max_ms": 0.0,
            "last_ms": 0.0,
        },
        "explain": {
            "count": 0,
            "total_ms": 0.0,
            "min_ms": 0.0,
            "max_ms": 0.0,
            "last_ms": 0.0,
        },
    }

    # Class names — try to load from weights/class_names.json (from Colab), then dataset, then generic
    class_names_path = Path("src/weights/class_names.json")
    if class_names_path.is_file():
        try:
            with open(class_names_path) as f:
                app.state.class_names = json.load(f)
            num_classes = len(app.state.class_names)
            print(f"✓ Loaded {num_classes} class names from {class_names_path}")
        except Exception as exc:
            print(f"⚠  Failed to load class_names.json: {exc}")
            app.state.class_names = [f"class_{i}" for i in range(NUM_CLASSES)]
            num_classes = NUM_CLASSES
    else:
        # Try loading from dataset
        try:
            train_ds = PlantDiseaseDataset("data/plantvillage", split="train")
            app.state.class_names = train_ds.class_names
            num_classes = train_ds.num_classes
            print(f"✓ Loaded {num_classes} class names from training dataset")
        except FileNotFoundError:
            app.state.class_names = [f"class_{i}" for i in range(NUM_CLASSES)]
            num_classes = NUM_CLASSES
            print("⚠  No class names found — using generic class names.")

    # Model
    ckpt = Path(MODEL_PATH)
    if ckpt.is_file():
        try:
            model = build_model(num_classes=num_classes, freeze_backbone=False)
            state_dict = torch.load(
                str(ckpt), map_location=torch.device(DEVICE), weights_only=True
            )
            model.load_state_dict(state_dict)
            model.to(DEVICE)
            model.eval()
            app.state.model = model

            # Grad-CAM engine
            app.state.engine = GradCAMEngine(
                model=model,
                device=DEVICE,
                class_names=app.state.class_names,
            )
            print(f"✓ Model loaded from {ckpt} on {DEVICE}")
        except Exception as exc:
            print(f"✗ Failed to load model: {exc}")
    else:
        print(f"⚠  Checkpoint not found at {ckpt} — running without model.")

    yield

    # ── Shutdown ────────────────────────────────────────────────────────
    app.state.model = None
    app.state.engine = None
    print("Model resources released.")


# ── App ─────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Aglen API",
    version="1.0.0",
    description=(
        "Explainable Crop Disease Detection — upload a leaf photo to get a "
        "disease diagnosis with a Grad-CAM visual explanation of *why* the "
        "model made that call."
    ),
    openapi_tags=TAGS,
    lifespan=lifespan,
)

# CORS — wide open for the demo frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Global exception handler ───────────────────────────────────────────────


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all that returns a JSON body instead of an HTML 500 page."""
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(detail=f"Internal server error: {exc}").model_dump(),
    )


# ── Helpers ─────────────────────────────────────────────────────────────────


def _require_model(app_state) -> None:
    """Raise 503 if model is not loaded."""
    if app_state.model is None:
        raise HTTPException(
            status_code=503,
            detail="Model is not loaded. Check MODEL_PATH and restart the server.",
        )


async def _read_upload(file: UploadFile) -> np.ndarray:
    """Read an ``UploadFile``, validate, and decode to RGB array."""
    if not file.filename:
        raise ValueError("No file was uploaded. Choose an image and try again.")

    validate_content_type(file.content_type)

    data = await file.read()
    if not data:
        raise ValueError("Uploaded file is empty. Please upload a valid image file.")

    validate_file_size(data)
    return bytes_to_rgb_array(data)


def _upload_validation_hint() -> str:
    accepted = ", ".join(sorted(ALLOWED_MIME_TYPES))
    return (
        f"Accepted MIME types: {accepted}. "
        f"Maximum upload size: {MAX_FILE_MB:.0f} MB."
    )


def _record_metric(app_state, key: str, duration_ms: float) -> None:
    metric = app_state.metrics.get(key)
    if metric is None:
        return

    metric["count"] += 1
    metric["total_ms"] += duration_ms
    metric["last_ms"] = duration_ms
    if metric["min_ms"] == 0.0 or duration_ms < metric["min_ms"]:
        metric["min_ms"] = duration_ms
    if duration_ms > metric["max_ms"]:
        metric["max_ms"] = duration_ms


def _format_metric(metric: dict) -> EndpointMetrics:
    count = metric["count"]
    avg = metric["total_ms"] / count if count else 0.0
    return EndpointMetrics(
        count=count,
        avg_ms=round(avg, 3),
        min_ms=round(metric["min_ms"], 3),
        max_ms=round(metric["max_ms"], 3),
        last_ms=round(metric["last_ms"], 3),
    )


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    req_id = uuid.uuid4().hex[:8]
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - start) * 1000
        logger.exception(
            "req_id=%s method=%s path=%s status=500 duration_ms=%.2f",
            req_id,
            request.method,
            request.url.path,
            duration_ms,
        )
        raise

    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-Id"] = req_id
    response.headers["X-Process-Time-Ms"] = f"{duration_ms:.2f}"
    logger.info(
        "req_id=%s method=%s path=%s status=%s duration_ms=%.2f",
        req_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


def _predict_sync(
    model, image_rgb: np.ndarray, transform, class_names: list[str], device: str
) -> PredictionResponse:
    """Run inference (CPU-bound) and build the response."""
    img_224 = resize_and_pad(image_rgb, target=224)
    augmented = transform(image=img_224)
    tensor = augmented["image"].unsqueeze(0).to(device)

    with torch.no_grad():
        logits = model(tensor)
        probs = F.softmax(logits, dim=1)[0]

    top5_probs, top5_idx = probs.topk(5)

    top5 = [
        ClassConfidence(
            class_name=class_names[idx.item()],
            confidence=round(prob.item(), 4),
        )
        for prob, idx in zip(top5_probs, top5_idx)
    ]

    return PredictionResponse(
        predicted_class=top5[0].class_name,
        confidence=top5[0].confidence,
        top5=top5,
    )


def _explain_sync(
    engine: GradCAMEngine, image_rgb: np.ndarray, transform, class_names, device
) -> ExplainResponse:
    """Run prediction + Grad-CAM (CPU-bound) and build the response."""
    img_224 = resize_and_pad(image_rgb, target=224)
    augmented = transform(image=img_224)
    tensor = augmented["image"].unsqueeze(0).to(device)

    # Prediction
    with torch.no_grad():
        logits = engine.model(tensor)
        probs = F.softmax(logits, dim=1)[0]

    top5_probs, top5_idx = probs.topk(5)
    class_idx = top5_idx[0].item()

    top5 = [
        ClassConfidence(
            class_name=class_names[idx.item()],
            confidence=round(prob.item(), 4),
        )
        for prob, idx in zip(top5_probs, top5_idx)
    ]

    # Grad-CAM
    heatmap = engine.generate_heatmap(tensor, class_idx=class_idx)
    overlay = engine.overlay_heatmap(img_224, heatmap, alpha=0.4)

    # Base64 encode
    from api.utils import numpy_to_base64_png
    from src.gradcam import generate_activation_summary

    heatmap_b64 = numpy_to_base64_png(overlay)
    summary = generate_activation_summary(heatmap, class_names[class_idx])

    return ExplainResponse(
        predicted_class=top5[0].class_name,
        confidence=top5[0].confidence,
        top5=top5,
        heatmap_base64=heatmap_b64,
        activation_summary=summary,
    )


# ── Endpoints ───────────────────────────────────────────────────────────────


@app.get(
    "/",
    response_model=RootResponse,
    tags=["Meta"],
    summary="API entrypoint",
    description="Returns quick links and available inference endpoints.",
)
async def root():
    return RootResponse(
        service="Aglen API",
        docs_url="/docs",
        health_url="/health",
        endpoints=[
            "/predict",
            "/predict/base64",
            "/explain",
            "/explain/base64",
            "/scans",
        ],
    )


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["Meta"],
    summary="Service health check",
    description="Returns the current status of the API, whether the model is "
                "loaded, and which device is in use.",
)
async def health():
    return HealthResponse(
        status="ok",
        ready=app.state.model is not None,
        device=app.state.device,
    )


@app.get(
    "/classes",
    response_model=list[str],
    tags=["Meta"],
    summary="List supported classes",
    description="Returns the ordered list of all 38 plant disease / healthy class names.",
)
async def list_classes():
    return app.state.class_names


@app.get(
    "/metrics",
    response_model=MetricsResponse,
    tags=["Meta"],
    summary="Inference timing metrics",
    description="Returns lightweight request count and latency summaries for inference endpoints.",
)
async def metrics():
    return MetricsResponse(
        predict=_format_metric(app.state.metrics["predict"]),
        explain=_format_metric(app.state.metrics["explain"]),
    )


@app.post(
    "/predict",
    response_model=PredictionResponse,
    responses={
        422: {"model": ErrorResponse, "description": "Invalid image format."},
        503: {"model": ErrorResponse, "description": "Model not loaded."},
    },
    tags=["Inference"],
    summary="Classify a leaf image",
    description="Upload a leaf image (multipart file) to receive the predicted "
                "disease class and top-5 predictions with confidence scores.",
)
async def predict(
    file: UploadFile = File(...),
):
    _require_model(app.state)

    start = time.perf_counter()
    try:
        image_rgb = await _read_upload(file)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{exc} {_upload_validation_hint()}")

    # Run inference off the event loop
    loop = asyncio.get_running_loop()
    response = await loop.run_in_executor(
        None,
        partial(
            _predict_sync,
            app.state.model,
            image_rgb,
            app.state.transform,
            app.state.class_names,
            app.state.device,
        ),
    )
    _record_metric(app.state, "predict", (time.perf_counter() - start) * 1000)
    return response


@app.post(
    "/predict/base64",
    response_model=PredictionResponse,
    responses={
        422: {"model": ErrorResponse, "description": "Invalid image format."},
        503: {"model": ErrorResponse, "description": "Model not loaded."},
    },
    tags=["Inference"],
    summary="Classify an image from base64",
    description="Send a base64-encoded image payload to receive the predicted "
                "disease class and top-5 predictions with confidence scores.",
)
async def predict_base64(body: PredictionRequest):
    _require_model(app.state)

    start = time.perf_counter()
    try:
        image_rgb = base64_to_rgb_array(body.image_base64)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{exc} {_upload_validation_hint()}")

    loop = asyncio.get_running_loop()
    response = await loop.run_in_executor(
        None,
        partial(
            _predict_sync,
            app.state.model,
            image_rgb,
            app.state.transform,
            app.state.class_names,
            app.state.device,
        ),
    )
    _record_metric(app.state, "predict", (time.perf_counter() - start) * 1000)
    return response


@app.post(
    "/explain",
    response_model=ExplainPersistedResponse,
    responses={
        422: {"model": ErrorResponse, "description": "Invalid image format."},
        503: {"model": ErrorResponse, "description": "Model not loaded."},
    },
    tags=["Inference"],
    summary="Classify + explain with Grad-CAM",
    description="Upload a leaf image to receive the disease prediction **plus** a "
                "Grad-CAM heatmap overlay (base64 PNG) and a human-readable "
                "activation summary explaining *why* the model made that call.",
)
async def explain(
    file: UploadFile = File(...),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    _require_model(app.state)

    start = time.perf_counter()
    try:
        if not file.filename:
            raise ValueError("No file was uploaded. Choose an image and try again.")

        validate_content_type(file.content_type)
        image_bytes = await file.read()
        if not image_bytes:
            raise ValueError("Uploaded file is empty. Please upload a valid image file.")

        validate_file_size(image_bytes)
        image_rgb = bytes_to_rgb_array(image_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{exc} {_upload_validation_hint()}")

    loop = asyncio.get_running_loop()
    response = await loop.run_in_executor(
        None,
        partial(
            _explain_sync,
            app.state.engine,
            image_rgb,
            app.state.transform,
            app.state.class_names,
            app.state.device,
        ),
    )

    persisted_scan_id: str | None = None
    if x_user_id:
        try:
            heatmap_bytes = base64.b64decode(response.heatmap_base64)
            saved = await save_scan(
                user_id=x_user_id,
                scan_data=response.model_dump(),
                image_bytes=image_bytes,
                heatmap_bytes=heatmap_bytes,
            )
            persisted_scan_id = saved.get("id")
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to persist scan: {exc}")

    _record_metric(app.state, "explain", (time.perf_counter() - start) * 1000)
    return ExplainPersistedResponse(**response.model_dump(), scan_id=persisted_scan_id)


@app.get(
    "/scans",
    tags=["Scans"],
    summary="List scans for a user",
    description="Returns paginated scan history for a given user id.",
)
async def list_scans(
    user_id: str = Query(...),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    try:
        rows = await get_user_scans(user_id=user_id, limit=limit, offset=offset)
        return rows
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch scans: {exc}")


@app.patch(
    "/scans/{scan_id}/feedback",
    tags=["Scans"],
    summary="Update feedback for a scan",
    description="Updates feedback and optional corrected class for a user-owned scan.",
)
async def patch_scan_feedback(
    scan_id: str,
    body: ScanFeedbackRequest,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    if not x_user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header is required.")

    try:
        row = await update_scan_feedback(
            scan_id=scan_id,
            user_id=x_user_id,
            feedback=body.feedback,
            corrected_class=body.corrected_class,
        )
        return row
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update feedback: {exc}")


@app.post(
    "/explain/base64",
    response_model=ExplainResponse,
    responses={
        422: {"model": ErrorResponse, "description": "Invalid image format."},
        503: {"model": ErrorResponse, "description": "Model not loaded."},
    },
    tags=["Inference"],
    summary="Classify + explain from base64",
    description="Send a base64-encoded image payload to receive disease prediction "
                "plus Grad-CAM heatmap overlay and activation summary.",
)
async def explain_base64(body: PredictionRequest):
    _require_model(app.state)

    start = time.perf_counter()
    try:
        image_rgb = base64_to_rgb_array(body.image_base64)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{exc} {_upload_validation_hint()}")

    loop = asyncio.get_running_loop()
    response = await loop.run_in_executor(
        None,
        partial(
            _explain_sync,
            app.state.engine,
            image_rgb,
            app.state.transform,
            app.state.class_names,
            app.state.device,
        ),
    )
    _record_metric(app.state, "explain", (time.perf_counter() - start) * 1000)
    return response
