from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

MODEL_STORE_DIR = Path(os.getenv("MODEL_STORE_DIR", "src/weights/model_store"))
REGISTRY_PATH = MODEL_STORE_DIR / "registry.json"
ACTIVE_POINTER_PATH = MODEL_STORE_DIR / "active_model.txt"


def _ensure_store() -> None:
    MODEL_STORE_DIR.mkdir(parents=True, exist_ok=True)
    if not REGISTRY_PATH.exists():
        REGISTRY_PATH.write_text("[]", encoding="utf-8")


def _read_registry() -> list[dict]:
    _ensure_store()
    try:
        payload = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        payload = []
    return payload if isinstance(payload, list) else []


def _write_registry(entries: list[dict]) -> None:
    _ensure_store()
    REGISTRY_PATH.write_text(json.dumps(entries, indent=2), encoding="utf-8")


def list_models() -> list[dict]:
    entries = _read_registry()
    active_id = get_active_model_id()
    for entry in entries:
        entry["is_active"] = entry.get("model_id") == active_id
    return sorted(entries, key=lambda x: x.get("created_at", ""), reverse=True)


def get_active_model_id() -> str | None:
    _ensure_store()
    if not ACTIVE_POINTER_PATH.exists():
        return None
    model_id = ACTIVE_POINTER_PATH.read_text(encoding="utf-8").strip()
    return model_id or None


def get_active_model_entry() -> dict | None:
    active_id = get_active_model_id()
    if not active_id:
        return None
    for entry in _read_registry():
        if entry.get("model_id") == active_id:
            return entry
    return None


def register_model(
    model_bytes: bytes,
    original_filename: str,
    label: str | None,
    class_names_bytes: bytes | None = None,
) -> dict:
    _ensure_store()

    model_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "-" + uuid4().hex[:8]
    model_dir = MODEL_STORE_DIR / model_id
    model_dir.mkdir(parents=True, exist_ok=True)

    model_path = model_dir / "model.pth"
    model_path.write_bytes(model_bytes)

    class_names_path = None
    if class_names_bytes:
        class_names_payload = json.loads(class_names_bytes.decode("utf-8"))
        if not isinstance(class_names_payload, list):
            raise ValueError("class_names.json must be a JSON array.")
        class_names_path = model_dir / "class_names.json"
        class_names_path.write_text(json.dumps(class_names_payload, indent=2), encoding="utf-8")

    entry = {
        "model_id": model_id,
        "label": label or Path(original_filename).stem,
        "source_filename": original_filename,
        "model_path": str(model_path),
        "class_names_path": str(class_names_path) if class_names_path else None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    entries = _read_registry()
    entries.append(entry)
    _write_registry(entries)
    return entry


def activate_model(model_id: str) -> dict:
    entries = _read_registry()
    selected = None
    for entry in entries:
        if entry.get("model_id") == model_id:
            selected = entry
            break

    if selected is None:
        raise LookupError(f"Model '{model_id}' not found in registry.")

    _ensure_store()
    ACTIVE_POINTER_PATH.write_text(model_id, encoding="utf-8")
    return selected
