from __future__ import annotations

import json
import urllib.error
import urllib.request

from fastapi import Header, HTTPException

from api.db.client import SUPABASE_SERVICE_KEY, SUPABASE_URL, get_db


def _parse_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header is required.")

    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="Authorization must be a Bearer token.")

    token = authorization[len(prefix) :].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Bearer token is empty.")
    return token


def _resolve_auth_user(token: str) -> dict:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(
            status_code=503,
            detail="Supabase auth validation unavailable. Configure SUPABASE_URL and SUPABASE_SERVICE_KEY.",
        )

    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {token}",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            if not isinstance(payload, dict) or not payload.get("id"):
                raise HTTPException(status_code=401, detail="Invalid authentication token.")
            return payload
    except urllib.error.HTTPError as exc:
        if exc.code in {401, 403}:
            raise HTTPException(status_code=401, detail="Invalid or expired access token.")
        raise HTTPException(status_code=503, detail="Unable to validate auth token with Supabase.")
    except urllib.error.URLError:
        raise HTTPException(status_code=503, detail="Unable to reach Supabase auth service.")


def require_admin_user(authorization: str | None = Header(default=None, alias="Authorization")) -> dict:
    token = _parse_bearer_token(authorization)
    auth_user = _resolve_auth_user(token)

    user_id = auth_user.get("id")
    try:
        db = get_db()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    try:
        row = db.table("users").select("id, role, full_name, email").eq("id", user_id).single().execute()
        profile = row.data
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load user profile: {exc}")

    if not profile or profile.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges are required.")

    return {
        "id": profile.get("id"),
        "email": profile.get("email") or auth_user.get("email"),
        "full_name": profile.get("full_name"),
        "role": profile.get("role"),
    }
