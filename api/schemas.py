"""
schemas.py — Pydantic request/response models for the Aglen API.

All models are JSON-serialisable and appear directly in the auto-generated
OpenAPI docs.
"""

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field


# ── Requests ────────────────────────────────────────────────────────────────


class PredictionRequest(BaseModel):
    """JSON body alternative to multipart file upload."""

    image_base64: str = Field(
        ...,
        description="Base64-encoded image (JPEG, PNG, or WebP). "
                    "Do NOT include the `data:image/...;base64,` prefix.",
    )


# ── Responses ───────────────────────────────────────────────────────────────


class ClassConfidence(BaseModel):
    """Single class + probability entry inside a top-K list."""

    class_name: str = Field(..., description="Human-readable disease / healthy label.")
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="Softmax probability."
    )


class PredictionResponse(BaseModel):
    """Returned by ``POST /predict``."""

    predicted_class: str = Field(..., description="Top-1 predicted class name.")
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="Top-1 softmax confidence."
    )
    top5: list[ClassConfidence] = Field(
        ..., description="Top-5 predictions sorted by confidence (descending)."
    )


class ExplainResponse(PredictionResponse):
    """Returned by ``POST /explain`` — extends ``PredictionResponse``."""

    heatmap_base64: str = Field(
        ...,
        description="Base64-encoded PNG of the Grad-CAM overlay "
                    "(can be used directly in an <img> src).",
    )
    activation_summary: str = Field(
        ...,
        description="Human-readable explanation of what the model focused on.",
    )


class ExplainPersistedResponse(ExplainResponse):
    """Returned by ``POST /explain`` when persistence is enabled."""

    scan_id: str | None = Field(
        default=None,
        description="Persisted scan identifier when X-User-Id is provided.",
    )


class ScanFeedbackRequest(BaseModel):
    """Request body for updating scan feedback."""

    feedback: str = Field(..., pattern="^(confirmed|wrong|unsure)$")
    corrected_class: str | None = None


class AdminAlertCreateRequest(BaseModel):
    disease_class: str
    severity: str = Field(default="low", pattern="^(low|medium|high|critical)$")
    affected_state: str
    affected_district: str | None = None
    case_count: int = Field(default=0, ge=0)
    advisory_text: str | None = None


class AdminModelActivateRequest(BaseModel):
    model_id: str


class HealthResponse(BaseModel):
    """Returned by ``GET /health``."""

    status: str = Field(default="ok", description="Service health status.")
    ready: bool = Field(
        ..., description="Whether the model is loaded and ready."
    )
    device: str = Field(..., description="Inference device (cpu / cuda).")
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="Server UTC timestamp.",
    )


class RootResponse(BaseModel):
    """Returned by ``GET /``."""

    service: str = Field(..., description="Human-readable API service name.")
    docs_url: str = Field(..., description="OpenAPI docs URL.")
    health_url: str = Field(..., description="Health endpoint URL.")
    endpoints: list[str] = Field(..., description="Primary inference endpoints.")


class EndpointMetrics(BaseModel):
    """Aggregated request timing metrics for one endpoint."""

    count: int = Field(..., ge=0, description="Total number of requests.")
    avg_ms: float = Field(..., ge=0.0, description="Average duration in milliseconds.")
    min_ms: float = Field(..., ge=0.0, description="Fastest observed request in milliseconds.")
    max_ms: float = Field(..., ge=0.0, description="Slowest observed request in milliseconds.")
    last_ms: float = Field(..., ge=0.0, description="Most recent request duration in milliseconds.")


class MetricsResponse(BaseModel):
    """Returned by ``GET /metrics``."""

    predict: EndpointMetrics
    explain: EndpointMetrics


class ErrorResponse(BaseModel):
    """Standard error envelope for non-2xx responses."""

    detail: str = Field(..., description="Human-readable error message.")
