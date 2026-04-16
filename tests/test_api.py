from __future__ import annotations

import io
import os

import pytest
import torch
from fastapi.testclient import TestClient
from PIL import Image

# Prevent loading heavyweight checkpoints during tests.
os.environ["MODEL_PATH"] = "src/weights/does-not-exist.pth"

from api.main import app  # noqa: E402


class DummyModel:
    def __call__(self, tensor):
        # 5 classes => compatible with top-5 response contract
        return torch.tensor([[0.1, 0.8, 0.05, 0.03, 0.02]], dtype=torch.float32)


def _png_bytes() -> bytes:
    img = Image.new("RGB", (32, 32), color=(100, 180, 70))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture()
def client():
    with TestClient(app) as c:
        c.app.state.model = DummyModel()
        c.app.state.class_names = [
            "class_a",
            "class_b",
            "class_c",
            "class_d",
            "class_e",
        ]
        c.app.state.transform = lambda image: {"image": torch.zeros(3, 224, 224)}
        c.app.state.device = "cpu"
        yield c


def test_health(client: TestClient):
    res = client.get("/health")
    assert res.status_code == 200
    payload = res.json()
    assert payload["status"] == "ok"
    assert payload["ready"] is True
    assert payload["device"] == "cpu"
    assert "timestamp" in payload


def test_classes(client: TestClient):
    res = client.get("/classes")
    assert res.status_code == 200
    payload = res.json()
    assert isinstance(payload, list)
    assert payload[0] == "class_a"
    assert len(payload) == 5


def test_predict_upload(client: TestClient):
    files = {"file": ("leaf.png", _png_bytes(), "image/png")}
    res = client.post("/predict", files=files)
    assert res.status_code == 200

    payload = res.json()
    assert payload["predicted_class"] == "class_b"
    assert isinstance(payload["confidence"], float)
    assert len(payload["top5"]) == 5


def test_predict_rejects_missing_upload(client: TestClient):
    res = client.post("/predict")
    assert res.status_code == 422
