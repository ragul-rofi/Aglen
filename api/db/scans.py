from __future__ import annotations

import asyncio
import uuid

from api.db.client import get_db


async def _run_io(fn, *args, **kwargs):
    return await asyncio.to_thread(fn, *args, **kwargs)


def _extract_rows(response) -> list[dict]:
    data = getattr(response, "data", None)
    return data if isinstance(data, list) else []


async def save_scan(
    user_id: str,
    scan_data: dict,
    image_bytes: bytes,
    heatmap_bytes: bytes,
) -> dict:
    db = get_db()
    scan_id = str(uuid.uuid4())
    image_path = f"{user_id}/{scan_id}.jpg"
    heatmap_path = f"{user_id}/{scan_id}_heatmap.jpg"

    await _run_io(
        db.storage.from_("scans").upload,
        image_path,
        image_bytes,
        {"content-type": "image/jpeg", "upsert": "true"},
    )
    await _run_io(
        db.storage.from_("scans").upload,
        heatmap_path,
        heatmap_bytes,
        {"content-type": "image/jpeg", "upsert": "true"},
    )

    row = {
        "id": scan_id,
        "user_id": user_id,
        "image_url": image_path,
        "heatmap_url": heatmap_path,
        "predicted_class": scan_data["predicted_class"],
        "confidence": scan_data["confidence"],
        "top5": scan_data.get("top5", []),
        "activation_summary": scan_data.get("activation_summary"),
        "crop_type": scan_data.get("crop_type"),
        "growth_stage": scan_data.get("growth_stage"),
        "weather_at_scan": scan_data.get("weather_at_scan"),
        "location_lat": scan_data.get("location_lat"),
        "location_lng": scan_data.get("location_lng"),
    }

    response = await _run_io(db.table("scans").insert(row).execute)
    rows = _extract_rows(response)
    if not rows:
        raise RuntimeError("Failed to insert scan row into Supabase.")
    return rows[0]


async def get_user_scans(user_id: str, limit: int = 20, offset: int = 0) -> list[dict]:
    db = get_db()
    end = offset + max(limit, 1) - 1
    response = await _run_io(
        db.table("scans")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .range(offset, end)
        .execute
    )
    return _extract_rows(response)


async def update_scan_feedback(
    scan_id: str,
    user_id: str,
    feedback: str,
    corrected_class: str | None,
) -> dict:
    db = get_db()
    payload: dict = {"feedback": feedback, "corrected_class": corrected_class}

    response = await _run_io(
        db.table("scans")
        .update(payload)
        .eq("id", scan_id)
        .eq("user_id", user_id)
        .execute
    )
    rows = _extract_rows(response)
    if not rows:
        raise LookupError("Scan not found for this user.")
    return rows[0]
