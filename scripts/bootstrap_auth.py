from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

DEFAULT_USERS = [
    {
        "email": "admin@aglen.local",
        "password": "Admin@12345!",
        "full_name": "Aglen Admin",
        "role": "admin",
        "location_state": "Karnataka",
    },
    {
        "email": "farmer@aglen.local",
        "password": "Farmer@12345!",
        "full_name": "Ravi Kumar",
        "role": "farmer",
        "location_state": "Karnataka",
    },
]


def _ensure_config() -> None:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")


def _request(method: str, path: str, body: dict | None = None) -> dict:
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        f"{SUPABASE_URL}{path}",
        data=payload,
        method=method,
        headers={
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
        },
    )

    with urllib.request.urlopen(req, timeout=15) as resp:
        if not resp.readable():
            return {}
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def _find_auth_user_by_email(email: str) -> dict | None:
    for path in (f"/auth/v1/admin/users?email={email}", "/auth/v1/admin/users?page=1&per_page=1000"):
        try:
            users = _request("GET", path)
        except urllib.error.HTTPError:
            continue

        if isinstance(users, dict):
            for item in users.get("users") or []:
                if item.get("email", "").lower() == email.lower():
                    return item
    return None


def _create_or_get_auth_user(email: str, password: str) -> dict:
    existing = _find_auth_user_by_email(email)
    if existing:
        return existing

    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,
    }
    return _request("POST", "/auth/v1/admin/users", payload)


def main() -> None:
    _ensure_config()
    db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    for account in DEFAULT_USERS:
        auth_user = _create_or_get_auth_user(account["email"], account["password"])
        user_id = auth_user.get("id")
        if not user_id:
            raise RuntimeError(f"Failed to create auth user for {account['email']}")

        row = {
            "id": user_id,
            "email": account["email"],
            "full_name": account["full_name"],
            "role": account["role"],
            "location_state": account["location_state"],
            "last_active_at": datetime.now(timezone.utc).isoformat(),
        }
        db.table("users").upsert(row).execute()
        print(f"Ready: {account['email']} ({account['role']})")

    print("\nCredentials created/verified:")
    for account in DEFAULT_USERS:
        print(f"- {account['email']} / {account['password']}")


if __name__ == "__main__":
    main()
