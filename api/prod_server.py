"""Production Uvicorn launcher for Aglen API."""

from __future__ import annotations

import os

import uvicorn


def main() -> None:
    host = os.getenv("UVICORN_HOST", "0.0.0.0")
    port = int(os.getenv("UVICORN_PORT", "8000"))
    workers = int(os.getenv("UVICORN_WORKERS", "2"))
    log_level = os.getenv("UVICORN_LOG_LEVEL", "info")

    uvicorn.run(
        "api.main:app",
        host=host,
        port=port,
        workers=workers,
        log_level=log_level,
        proxy_headers=True,
    )


if __name__ == "__main__":
    main()
