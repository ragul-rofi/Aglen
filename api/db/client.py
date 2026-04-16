from __future__ import annotations

import os

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

_db: Client | None = None
_init_error: str | None = None

if not SUPABASE_URL:
    _init_error = "SUPABASE_URL is not set."
elif not SUPABASE_SERVICE_KEY:
    _init_error = "SUPABASE_SERVICE_KEY is not set."
else:
    try:
        # Service key is required for server-side writes and privileged operations.
        _db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    except Exception as exc:
        _init_error = f"Failed to initialize Supabase client: {exc}"


def get_db() -> Client:
    if _db is None:
        raise RuntimeError(f"Supabase client unavailable. {_init_error or ''}".strip())
    return _db
