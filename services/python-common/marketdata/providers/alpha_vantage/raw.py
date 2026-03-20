from __future__ import annotations

from typing import Any

import requests


def fetch_series(symbol: str, function: str, api_key: str, outputsize: str | None = None) -> dict[str, Any]:
    if not api_key.strip():
        raise ValueError("Alpha Vantage API key not configured")

    params = {
        "function": function,
        "symbol": symbol,
        "apikey": api_key,
        "source": "market_data_service",
    }
    if outputsize:
        params["outputsize"] = outputsize

    response = requests.get("https://www.alphavantage.co/query", params=params, timeout=20)
    response.raise_for_status()
    payload = response.json()
    if isinstance(payload, dict):
        if payload.get("Information"):
            raise RuntimeError(str(payload["Information"]))
        if payload.get("Error Message"):
            raise RuntimeError(str(payload["Error Message"]))
        if payload.get("Note"):
            raise RuntimeError(str(payload["Note"]))
    return payload
