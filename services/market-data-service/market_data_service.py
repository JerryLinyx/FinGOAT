from __future__ import annotations

import os
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional
import sys

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from redis import Redis

SERVICE_DIR = Path(__file__).resolve().parent
SERVICES_DIR = SERVICE_DIR.parent
PYTHON_COMMON_PATH = SERVICES_DIR / "python-common"
if str(PYTHON_COMMON_PATH) not in sys.path:
    sys.path.insert(0, str(PYTHON_COMMON_PATH))

from marketdata.services.candles_service import get_chart_payload
from marketdata.services.quote_service import get_quote
from marketdata.services.snapshot_service import get_terminal_snapshot

REDIS_CONNECT_TIMEOUT_SECONDS = 5
REDIS_SOCKET_TIMEOUT_SECONDS = 5

redis_client: Optional[Redis] = None


class MarketMode(str, Enum):
    US = "us"
    CN = "cn"


class TerminalPeriod(str, Enum):
    DAY = "day"
    WEEK = "week"
    MONTH = "month"


class ChartPoint(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class ChartResponse(BaseModel):
    ticker: str
    market: MarketMode
    range: str
    data: List[ChartPoint]
    source: str = "unknown"
    fallback_used: Optional[str] = None
    cache_status: str = "miss"
    stale: bool = False
    fetched_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class IndicatorPoint(BaseModel):
    date: str
    value: float


class TerminalMAResponse(BaseModel):
    ma5: List[IndicatorPoint] = Field(default_factory=list)
    ma10: List[IndicatorPoint] = Field(default_factory=list)
    ma20: List[IndicatorPoint] = Field(default_factory=list)
    ma60: List[IndicatorPoint] = Field(default_factory=list)


class TerminalMACDResponse(BaseModel):
    dif: List[IndicatorPoint] = Field(default_factory=list)
    dea: List[IndicatorPoint] = Field(default_factory=list)
    hist: List[IndicatorPoint] = Field(default_factory=list)


class TerminalIndicatorsResponse(BaseModel):
    ma: TerminalMAResponse = Field(default_factory=TerminalMAResponse)
    macd: TerminalMACDResponse = Field(default_factory=TerminalMACDResponse)


class TerminalMetric(BaseModel):
    label: str
    value: str


class TerminalNotice(BaseModel):
    title: str
    date: str
    type: Optional[str] = None
    source: str
    url: Optional[str] = None


class TerminalSidebarResponse(BaseModel):
    metrics: List[TerminalMetric] = Field(default_factory=list)
    notices: List[TerminalNotice] = Field(default_factory=list)


class TerminalCapabilitiesResponse(BaseModel):
    chart: bool = True
    intraday: bool = False
    ma: bool = True
    macd: bool = True
    notices: bool = True
    terminal_sidebar: bool = True
    quote_polling: bool = True


class QuoteResponse(BaseModel):
    ticker: str
    market: MarketMode
    name: str
    updated_at: str
    last_price: Optional[float] = None
    change: Optional[float] = None
    change_pct: Optional[float] = None
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    prev_close: Optional[float] = None
    volume: Optional[float] = None
    amount: Optional[float] = None
    turnover_rate: Optional[float] = None
    source: str = "unknown"
    fallback_used: Optional[str] = None
    cache_status: str = "miss"
    stale: bool = False
    fetched_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class TerminalResponse(BaseModel):
    ticker: str
    market: MarketMode
    name: str
    period: TerminalPeriod
    updated_at: str
    chart: List[ChartPoint] = Field(default_factory=list)
    indicators: TerminalIndicatorsResponse = Field(default_factory=TerminalIndicatorsResponse)
    sidebar: TerminalSidebarResponse = Field(default_factory=TerminalSidebarResponse)
    capabilities: TerminalCapabilitiesResponse = Field(default_factory=TerminalCapabilitiesResponse)
    partial: bool = False
    has_more_left: bool = False
    oldest_date: Optional[str] = None
    newest_date: Optional[str] = None
    source: str = "unknown"
    fallback_used: Optional[str] = None
    cache_status: str = "miss"
    stale: bool = False
    fetched_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


def resolve_redis_connection_config() -> Dict[str, Any]:
    redis_addr = os.getenv("REDIS_ADDR", "").strip()
    if redis_addr:
        if ":" in redis_addr:
            host, port_str = redis_addr.rsplit(":", 1)
            port = int(port_str)
        else:
            host = redis_addr
            port = 6379
    else:
        host = os.getenv("REDIS_HOST", "localhost")
        port = int(os.getenv("REDIS_PORT", "6379"))

    password = os.getenv("REDIS_PASSWORD", "")
    db = int(os.getenv("REDIS_DB", "0"))

    return {
        "host": host,
        "port": port,
        "password": password or None,
        "db": db,
        "decode_responses": True,
    }


def get_redis_client() -> Redis:
    global redis_client
    if redis_client is not None:
        return redis_client
    redis_client = Redis(
        **resolve_redis_connection_config(),
        socket_connect_timeout=REDIS_CONNECT_TIMEOUT_SECONDS,
        socket_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
    )
    redis_client.ping()
    return redis_client


app = FastAPI(
    title="FinGOAT Market Data Service",
    # ADR-032 splits chart/quote/terminal aggregation into a dedicated internal service.
    description="Unified market data service for chart terminal payloads",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

_cors_origins_raw = os.getenv("FRONTEND_ORIGINS", "http://localhost:8080,http://localhost:5173")
_cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]
_cors_allow_creds = not (_cors_origins == ["*"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_cors_allow_creds,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_alpha_vantage_key(market: MarketMode, header_value: Optional[str]) -> Optional[str]:
    if market == MarketMode.US:
        api_key = (header_value or "").strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="Alpha Vantage API key is required for US chart data")
        return api_key
    return None


@app.get("/health")
async def health_check() -> dict[str, Any]:
    try:
        get_redis_client().ping()
        redis_status = "healthy"
    except Exception as exc:
        redis_status = f"unavailable: {exc}"
    return {
        "status": "healthy",
        "service": "market-data-service",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "redis": redis_status,
    }


@app.get("/api/v1/chart", response_model=ChartResponse)
async def chart_endpoint(
    ticker: str = Query(...),
    market: MarketMode = Query(default=MarketMode.US),
    range: str = Query(default="3m"),
    alpha_vantage_key: Optional[str] = Header(default=None, alias="X-Alpha-Vantage-Key"),
) -> ChartResponse:
    api_key = _require_alpha_vantage_key(market, alpha_vantage_key)
    try:
        payload = get_chart_payload(get_redis_client(), ticker, market.value, range, api_key=api_key)
        return ChartResponse(**payload)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/v1/quote", response_model=QuoteResponse)
async def quote_endpoint(
    ticker: str = Query(...),
    market: MarketMode = Query(default=MarketMode.US),
    alpha_vantage_key: Optional[str] = Header(default=None, alias="X-Alpha-Vantage-Key"),
) -> QuoteResponse:
    api_key = _require_alpha_vantage_key(market, alpha_vantage_key)
    try:
        payload = get_quote(get_redis_client(), ticker, market.value, api_key=api_key)
        return QuoteResponse(**payload)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/v1/terminal", response_model=TerminalResponse)
async def terminal_endpoint(
    ticker: str = Query(...),
    market: MarketMode = Query(default=MarketMode.US),
    period: TerminalPeriod = Query(default=TerminalPeriod.DAY),
    before: Optional[str] = Query(default=None),
    alpha_vantage_key: Optional[str] = Header(default=None, alias="X-Alpha-Vantage-Key"),
) -> TerminalResponse:
    api_key = _require_alpha_vantage_key(market, alpha_vantage_key)
    try:
        payload = get_terminal_snapshot(
            get_redis_client(),
            ticker,
            market.value,
            period.value,
            before=before,
            api_key=api_key,
        )
        return TerminalResponse(**payload)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
