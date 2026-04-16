from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from api.db.client import get_db


async def _run_io(fn, *args, **kwargs):
    return await asyncio.to_thread(fn, *args, **kwargs)


def _extract_rows(response) -> list[dict]:
    data = getattr(response, "data", None)
    return data if isinstance(data, list) else []


def _severity_for_count(case_count: int) -> str:
    if case_count >= 50:
        return "critical"
    if case_count >= 25:
        return "high"
    if case_count >= 10:
        return "medium"
    return "low"


async def create_alert(payload: dict) -> dict:
    db = get_db()
    response = await _run_io(db.table("disease_alerts").insert(payload).execute)
    rows = _extract_rows(response)
    if not rows:
        raise RuntimeError("Failed to insert disease alert.")
    return rows[0]


async def list_alerts(
    state: str | None = None,
    severity: str | None = None,
    is_active: bool | None = True,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    db = get_db()
    end = offset + max(limit, 1) - 1

    query = db.table("disease_alerts").select("*")
    if state:
        query = query.eq("affected_state", state)
    if severity:
        query = query.eq("severity", severity)
    if is_active is not None:
        query = query.eq("is_active", is_active)

    response = await _run_io(
        query
        .order("severity", desc=True)
        .order("last_updated_at", desc=True)
        .range(offset, end)
        .execute
    )
    rows = _extract_rows(response)

    rank = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    rows.sort(
        key=lambda item: (
            rank.get(item.get("severity"), 0),
            item.get("last_updated_at") or "",
        ),
        reverse=True,
    )
    return rows


async def auto_detect_outbreaks() -> dict:
    db = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    scans_resp = await _run_io(
        db.table("scans")
        .select("predicted_class, weather_at_scan, created_at")
        .gte("created_at", cutoff)
        .execute
    )
    scans = _extract_rows(scans_resp)

    grouped: dict[tuple[str, str, str | None], int] = defaultdict(int)
    for scan in scans:
        disease_class = scan.get("predicted_class")
        weather = scan.get("weather_at_scan") or {}
        if not isinstance(weather, dict):
            weather = {}

        state = weather.get("state") or weather.get("affected_state") or "Unknown"
        district = weather.get("district")

        if not disease_class:
            continue

        grouped[(disease_class, state, district)] += 1

    created = 0
    updated = 0

    for (disease_class, state, district), case_count in grouped.items():
        if case_count < 10:
            continue

        severity = _severity_for_count(case_count)
        advisory = (
            f"Elevated detection trend for {disease_class.replace('_', ' ')} in {state}. "
            f"Recent 7-day count: {case_count}."
        )

        existing_query = (
            db.table("disease_alerts")
            .select("id")
            .eq("disease_class", disease_class)
            .eq("affected_state", state)
            .eq("is_active", True)
        )
        if district is None:
            existing_query = existing_query.is_("affected_district", "null")
        else:
            existing_query = existing_query.eq("affected_district", district)

        existing_resp = await _run_io(
            existing_query.order("last_updated_at", desc=True).limit(1).execute
        )
        existing_rows = _extract_rows(existing_resp)

        payload = {
            "disease_class": disease_class,
            "severity": severity,
            "affected_state": state,
            "affected_district": district,
            "case_count": case_count,
            "last_updated_at": datetime.now(timezone.utc).isoformat(),
            "is_active": True,
            "advisory_text": advisory,
        }

        if existing_rows:
            await _run_io(
                db.table("disease_alerts")
                .update(payload)
                .eq("id", existing_rows[0]["id"])
                .execute
            )
            updated += 1
        else:
            payload["first_detected_at"] = datetime.now(timezone.utc).isoformat()
            await _run_io(db.table("disease_alerts").insert(payload).execute)
            created += 1

    return {
        "window_days": 7,
        "scans_considered": len(scans),
        "candidate_clusters": len(grouped),
        "alerts_created": created,
        "alerts_updated": updated,
    }
