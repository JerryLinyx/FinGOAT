"""
TradingAgents FastAPI Microservice

This service exposes health/config endpoints and runs a Redis-backed worker for
multi-agent trading analysis tasks.
"""

import asyncio
import json
import logging
import os
import re
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from urllib import error as urllib_error
from urllib import request as urllib_request

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from redis import Redis
from redis.exceptions import RedisError
from sse_starlette.sse import EventSourceResponse

from json_safety import make_json_safe

# Add TradingAgents to path
TRADING_AGENTS_PATH = os.path.join(os.path.dirname(__file__), "..", "TradingAgents")
sys.path.insert(0, TRADING_AGENTS_PATH)

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.graph.trading_graph import TradingAgentsGraph

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="TradingAgents Microservice",
    description="Multi-agent LLM financial trading analysis service",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


RUNTIME_KEY_PREFIX = "trading:analysis:runtime:"
STREAM_KEY_PREFIX = "trading:stream"
STREAM_TTL_SECONDS = 3600
QUEUE_KEY = "trading:analysis:queue"
PROCESSING_QUEUE_KEY = "trading:analysis:processing"
RECENT_TASKS_KEY = "trading:analysis:recent"
TASK_RUNTIME_TTL_SECONDS = 24 * 60 * 60
RECENT_TASK_LIMIT = 200
REDIS_CONNECT_TIMEOUT_SECONDS = 5
REDIS_SOCKET_TIMEOUT_SECONDS = 5
WORKER_QUEUE_BLOCK_SECONDS = 5

redis_client: Optional[Redis] = None
worker_redis_client: Optional[Redis] = None
worker_thread: Optional[threading.Thread] = None
worker_stop_event = threading.Event()


class TaskStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ExecutionMode(str, Enum):
    DEFAULT = "default"
    OPENCLAW = "openclaw"


class TradingAction(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class LLMConfig(BaseModel):
    deep_think_llm: str = Field(default="gemma3:1b", description="Deep thinking LLM model")
    quick_think_llm: str = Field(default="gemma3:1b", description="Quick thinking LLM model")
    max_debate_rounds: int = Field(default=1, ge=1, le=5, description="Maximum debate rounds")
    max_risk_discuss_rounds: int = Field(default=1, ge=1, le=5, description="Maximum risk discussion rounds")
    provider: str = Field(default="ollama", description="LLM provider identifier")
    base_url: Optional[str] = Field(default=None, description="Override LLM base URL")
    api_key: Optional[str] = Field(default=None, description="Optional override for provider API key")

    @validator("provider")
    def normalize_provider(cls, value: str) -> str:
        if not value:
            return "ollama"
        normalized = value.lower()
        if normalized == "aliyun":
            return "dashscope"
        return normalized


class DataVendorConfig(BaseModel):
    core_stock_apis: str = Field(default="yfinance", description="Stock data provider")
    technical_indicators: str = Field(default="yfinance", description="Technical indicators provider")
    fundamental_data: str = Field(default="alpha_vantage", description="Fundamental data provider")
    news_data: str = Field(default="alpha_vantage", description="News data provider")


class AnalysisRequest(BaseModel):
    task_id: Optional[str] = Field(default=None, description="Optional externally supplied task id")
    user_id: Optional[int] = Field(default=None, description="Authenticated user id for per-user agent routing")
    ticker: str = Field(..., description="Stock ticker symbol", example="NVDA")
    date: str = Field(..., description="Analysis date in YYYY-MM-DD format", example="2024-05-10")
    execution_mode: ExecutionMode = Field(default=ExecutionMode.DEFAULT, description="Execution backend mode")
    llm_config: Optional[LLMConfig] = Field(default=None, description="LLM configuration")
    data_vendor_config: Optional[DataVendorConfig] = Field(default=None, description="Data vendor configuration")
    alpha_vantage_api_key: Optional[str] = Field(default=None, description="User's Alpha Vantage API key (injected by Go backend)")

    @validator("ticker")
    def validate_ticker(cls, value: str) -> str:
        if not value or len(value) > 10:
            raise ValueError("Ticker must be between 1 and 10 characters")
        return value.upper()

    @validator("date")
    def validate_date(cls, value: str) -> str:
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError("Date must be in YYYY-MM-DD format") from exc
        return value


class BatchAnalysisRequest(BaseModel):
    requests: List[AnalysisRequest] = Field(..., description="List of analysis requests")

    @validator("requests")
    def validate_batch_size(cls, value: List[AnalysisRequest]) -> List[AnalysisRequest]:
        if len(value) > 10:
            raise ValueError("Batch size cannot exceed 10 requests")
        return value


class DecisionReasoning(BaseModel):
    fundamental_analysis: Optional[Dict[str, Any]] = None
    sentiment_analysis: Optional[Dict[str, Any]] = None
    technical_analysis: Optional[Dict[str, Any]] = None
    news_analysis: Optional[Dict[str, Any]] = None
    risk_assessment: Optional[Dict[str, Any]] = None
    researcher_debate: Optional[Dict[str, Any]] = None


class TradingDecision(BaseModel):
    action: str = Field(..., description="Trading action: BUY, SELL, or HOLD")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score")
    position_size: Optional[int] = Field(default=None, description="Recommended position size")
    reasoning: Optional[DecisionReasoning] = None
    raw_decision: Optional[Dict[str, Any]] = None


class StageResult(BaseModel):
    stage_id: str
    label: str
    status: str
    backend: str
    summary: Optional[str] = None
    content: Optional[Any] = None
    agent_id: Optional[str] = None
    session_key: Optional[str] = None
    raw_output: Optional[Any] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_seconds: Optional[float] = None
    error: Optional[str] = None


class AnalysisResponse(BaseModel):
    task_id: str
    status: TaskStatus
    ticker: str
    date: str
    execution_mode: ExecutionMode = ExecutionMode.DEFAULT
    decision: Optional[TradingDecision] = None
    stages: List[StageResult] = Field(default_factory=list)
    analysis_report: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: str
    completed_at: Optional[str] = None
    processing_time_seconds: Optional[float] = None


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    timestamp: str
    worker_alive: bool
    openclaw_gateway: Dict[str, Any] = Field(default_factory=dict)


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def model_dump_compat(model: BaseModel) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="json", exclude_none=True)
    return model.dict(exclude_none=True)


def runtime_state_key(task_id: str) -> str:
    return f"{RUNTIME_KEY_PREFIX}{task_id}"


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


def build_redis_client(*, socket_timeout: Optional[int]) -> Redis:
    return Redis(
        **resolve_redis_connection_config(),
        socket_connect_timeout=REDIS_CONNECT_TIMEOUT_SECONDS,
        socket_timeout=socket_timeout,
    )


def get_redis_client() -> Redis:
    global redis_client

    if redis_client is not None:
        return redis_client

    redis_client = build_redis_client(socket_timeout=REDIS_SOCKET_TIMEOUT_SECONDS)
    redis_client.ping()
    return redis_client


def get_worker_redis_client() -> Redis:
    global worker_redis_client

    if worker_redis_client is not None:
        return worker_redis_client

    # Blocking queue reads should not inherit the short request socket timeout.
    worker_redis_client = build_redis_client(socket_timeout=None)
    worker_redis_client.ping()
    return worker_redis_client


def reset_redis_clients() -> None:
    global redis_client, worker_redis_client
    redis_client = None
    worker_redis_client = None


def close_redis_clients() -> None:
    global redis_client, worker_redis_client

    for client in (worker_redis_client, redis_client):
        if client is None:
            continue
        try:
            client.close()
        except Exception:
            logger.warning("Failed to close Redis client cleanly", exc_info=True)

    reset_redis_clients()


def fetch_openclaw_gateway_health() -> Dict[str, Any]:
    gateway_url = os.getenv("OPENCLAW_GATEWAY_URL", "http://localhost:8011").rstrip("/")
    try:
        with urllib_request.urlopen(f"{gateway_url}/health", timeout=3) as response:
            payload = response.read().decode("utf-8")
        return json.loads(payload)
    except (urllib_error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        return {
            "status": "unavailable",
            "error": f"openclaw_gateway_unavailable: {exc}",
            "url": gateway_url,
        }


def save_task_state(task_state: Dict[str, Any]) -> None:
    client = get_redis_client()
    client.set(
        runtime_state_key(task_state["task_id"]),
        json.dumps(task_state),
        ex=TASK_RUNTIME_TTL_SECONDS,
    )


def load_task_state(task_id: str) -> Optional[Dict[str, Any]]:
    client = get_redis_client()
    payload = client.get(runtime_state_key(task_id))
    if payload is None:
        return None
    return json.loads(payload)


def register_recent_task(task_id: str) -> None:
    client = get_redis_client()
    client.lrem(RECENT_TASKS_KEY, 0, task_id)
    client.lpush(RECENT_TASKS_KEY, task_id)
    client.ltrim(RECENT_TASKS_KEY, 0, RECENT_TASK_LIMIT-1)


def create_task_state(
    task_id: str,
    ticker: str,
    date: str,
    execution_mode: ExecutionMode = ExecutionMode.DEFAULT,
) -> Dict[str, Any]:
    return {
        "task_id": task_id,
        "status": TaskStatus.PENDING.value,
        "cancel_requested": False,
        "ticker": ticker,
        "date": date,
        "execution_mode": execution_mode.value,
        "decision": None,
        "stages": [],
        "analysis_report": None,
        "error": None,
        "created_at": utcnow_iso(),
        "completed_at": None,
        "processing_time_seconds": None,
    }


STAGE_DEFINITIONS = [
    {"stage_id": "market", "report_key": "market_report", "label": "Technical"},
    {"stage_id": "social", "report_key": "sentiment_report", "label": "Social Media"},
    {"stage_id": "news", "report_key": "news_report", "label": "News"},
    {"stage_id": "fundamentals", "report_key": "fundamentals_report", "label": "Fundamentals"},
    {"stage_id": "research_debate", "report_key": "investment_debate_state", "label": "Research Debate"},
    {"stage_id": "portfolio_manager", "report_key": "investment_plan", "label": "Portfolio Manager"},
    {"stage_id": "trader_plan", "report_key": "trader_investment_plan", "label": "Trader Plan"},
    {"stage_id": "risk_debate", "report_key": "risk_debate_state", "label": "Risk Debate"},
    {"stage_id": "risk_management", "report_key": "final_trade_decision", "label": "Risk Management"},
]

STAGE_ORDER = [stage["report_key"] for stage in STAGE_DEFINITIONS]
STAGE_LABELS = {stage["report_key"]: stage["label"] for stage in STAGE_DEFINITIONS}
STAGE_IDS_BY_REPORT_KEY = {stage["report_key"]: stage["stage_id"] for stage in STAGE_DEFINITIONS}

NODE_STAGE_MAP = {
    "Market Analyst": "market_report",
    "Social Analyst": "sentiment_report",
    "News Analyst": "news_report",
    "Fundamentals Analyst": "fundamentals_report",
    "Bull Researcher": "investment_debate_state",
    "Bear Researcher": "investment_debate_state",
    "Research Manager": "investment_plan",
    "Trader": "trader_investment_plan",
    "Risky Analyst": "risk_debate_state",
    "Neutral Analyst": "risk_debate_state",
    "Safe Analyst": "risk_debate_state",
    "Risk Judge": "final_trade_decision",
}


def build_config(request: AnalysisRequest) -> Dict[str, Any]:
    config = DEFAULT_CONFIG.copy()
    config["execution_mode"] = request.execution_mode.value
    config["task_id"] = request.task_id
    config["user_id"] = request.user_id
    config["openclaw_gateway_url"] = os.getenv("OPENCLAW_GATEWAY_URL", "http://localhost:8011").rstrip("/")

    if request.llm_config:
        config["deep_think_llm"] = request.llm_config.deep_think_llm
        config["quick_think_llm"] = request.llm_config.quick_think_llm
        config["max_debate_rounds"] = request.llm_config.max_debate_rounds
        config["max_risk_discuss_rounds"] = request.llm_config.max_risk_discuss_rounds
        config["llm_provider"] = request.llm_config.provider
        if request.llm_config.base_url:
            config["backend_url"] = request.llm_config.base_url
        if request.llm_config.api_key:
            config["llm_api_key"] = request.llm_config.api_key

    if request.data_vendor_config:
        config["data_vendors"] = {
            "core_stock_apis": request.data_vendor_config.core_stock_apis,
            "technical_indicators": request.data_vendor_config.technical_indicators,
            "fundamental_data": request.data_vendor_config.fundamental_data,
            "news_data": request.data_vendor_config.news_data,
        }

    if request.alpha_vantage_api_key:
        config["alpha_vantage_api_key"] = request.alpha_vantage_api_key

    return config


def extract_decision_info(decision_data: Any) -> TradingDecision:
    if isinstance(decision_data, str):
        decision_text = decision_data.upper()

        if "BUY" in decision_text:
            action = TradingAction.BUY.value
        elif "SELL" in decision_text:
            action = TradingAction.SELL.value
        elif "HOLD" in decision_text:
            action = TradingAction.HOLD.value
        else:
            action = TradingAction.HOLD.value

        confidence = 0.7
        if any(word in decision_text for word in ["STRONG", "HIGHLY", "VERY", "COMPELLING"]):
            confidence = 0.9
        elif any(word in decision_text for word in ["WEAK", "CAUTIOUS", "UNCERTAIN"]):
            confidence = 0.5

        return TradingDecision(
            action=action,
            confidence=confidence,
            raw_decision={"decision_text": decision_data},
        )

    if isinstance(decision_data, dict):
        action = decision_data.get("action", TradingAction.HOLD.value)
        confidence = decision_data.get("confidence", 0.5)
        reasoning = decision_data.get("reasoning")
        raw_decision = decision_data.get("raw_decision")

        return TradingDecision(
            action=action,
            confidence=confidence,
            position_size=decision_data.get("position_size"),
            reasoning=reasoning,
            raw_decision=raw_decision or decision_data,
        )

    logger.warning("Unexpected decision format: %s", type(decision_data))
    return TradingDecision(
        action=TradingAction.HOLD.value,
        confidence=0.0,
        raw_decision={"raw": str(decision_data)},
    )


def _has_meaningful_content(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, list):
        return any(_has_meaningful_content(item) for item in value)
    if isinstance(value, dict):
        return any(_has_meaningful_content(item) for item in value.values())
    return True


def _normalize_summary_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        for candidate_key in ("judge_decision", "current_response", "summary", "thesis", "plan", "explanation"):
            if candidate_key in value and _has_meaningful_content(value[candidate_key]):
                return _normalize_summary_text(value[candidate_key])
        try:
            value = json.dumps(value, ensure_ascii=False)
        except Exception:
            value = str(value)
    elif isinstance(value, list):
        value = " ".join(_normalize_summary_text(item) for item in value if _has_meaningful_content(item))
    else:
        value = str(value)

    text = re.sub(r"\s+", " ", value).strip()
    if len(text) <= 220:
        return text
    return text[:219] + "..."


def extract_stage_times(state: Dict[str, Any], total_elapsed: Optional[float] = None) -> Dict[str, float]:
    stage_starts: Dict[str, float] = {}
    stage_ends: Dict[str, float] = {}

    for key, value in state.items():
        if not isinstance(key, str):
            continue

        if key.startswith("__stage_starts."):
            node = key.split(".", 1)[1]
            stage = NODE_STAGE_MAP.get(node)
            if stage and isinstance(value, (int, float)):
                if stage not in stage_starts or value < stage_starts[stage]:
                    stage_starts[stage] = float(value)
        elif key.startswith("__stage_ends."):
            node = key.split(".", 1)[1]
            stage = NODE_STAGE_MAP.get(node)
            if stage and isinstance(value, (int, float)):
                if stage not in stage_ends or value > stage_ends[stage]:
                    stage_ends[stage] = float(value)

    stage_times: Dict[str, float] = {}
    for stage_key in STAGE_ORDER:
        if stage_key in stage_starts and stage_key in stage_ends:
            stage_times[stage_key] = max(stage_ends[stage_key] - stage_starts[stage_key], 0.0)
        elif total_elapsed is not None and stage_key in stage_starts:
            stage_times[stage_key] = max(total_elapsed - stage_starts[stage_key], 0.0)

    return stage_times


def extract_key_outputs(report: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    key_outputs: Dict[str, Dict[str, Any]] = {}

    for stage_key in STAGE_ORDER:
        content = report.get(stage_key)
        if not _has_meaningful_content(content):
            continue

        summary = _normalize_summary_text(content)
        if not summary:
            continue

        key_outputs[stage_key] = {
            "label": STAGE_LABELS.get(stage_key, stage_key),
            "summary": summary,
        }

    return key_outputs


def extract_stage_metadata(state: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    metadata: Dict[str, Dict[str, Any]] = {}
    field_prefixes = {
        "__stage_backend.": "backend",
        "__stage_agent_id.": "agent_id",
        "__stage_session_key.": "session_key",
        "__stage_raw_output.": "raw_output",
        "__stage_summary.": "summary",
        "__stage_started_at.": "started_at",
        "__stage_completed_at.": "completed_at",
        "__stage_error.": "error",
    }

    for key, value in state.items():
        if not isinstance(key, str):
            continue
        for prefix, field_name in field_prefixes.items():
            if not key.startswith(prefix):
                continue
            stage_key = key[len(prefix):]
            metadata.setdefault(stage_key, {})[field_name] = make_json_safe(value)
            break

    return metadata


def build_stage_results(
    state: Dict[str, Any],
    *,
    task_status: str,
    total_elapsed: Optional[float] = None,
    execution_mode: str = ExecutionMode.DEFAULT.value,
    task_error: Optional[str] = None,
) -> List[Dict[str, Any]]:
    stage_times = extract_stage_times(state, total_elapsed)
    stage_meta = extract_stage_metadata(state)
    content_by_stage = {stage["report_key"]: state.get(stage["report_key"]) for stage in STAGE_DEFINITIONS}
    first_missing_index = next(
        (index for index, stage in enumerate(STAGE_DEFINITIONS) if not _has_meaningful_content(content_by_stage[stage["report_key"]])),
        -1,
    )

    results: List[Dict[str, Any]] = []
    for index, stage in enumerate(STAGE_DEFINITIONS):
        report_key = stage["report_key"]
        content = make_json_safe(content_by_stage[report_key])
        has_content = _has_meaningful_content(content_by_stage[report_key])
        meta = stage_meta.get(report_key, {})

        stage_status = TaskStatus.PENDING.value
        if task_status == TaskStatus.FAILED.value:
            active_index = len(STAGE_DEFINITIONS) - 1 if first_missing_index == -1 else first_missing_index
            stage_status = TaskStatus.COMPLETED.value if has_content else (
                TaskStatus.FAILED.value if index == active_index else TaskStatus.PENDING.value
            )
        elif task_status == TaskStatus.CANCELLED.value:
            active_index = len(STAGE_DEFINITIONS) - 1 if first_missing_index == -1 else first_missing_index
            stage_status = TaskStatus.COMPLETED.value if has_content else (
                TaskStatus.CANCELLED.value if index == active_index else TaskStatus.PENDING.value
            )
        elif has_content:
            stage_status = TaskStatus.COMPLETED.value
        elif task_status == TaskStatus.PROCESSING.value:
            active_index = len(STAGE_DEFINITIONS) - 1 if first_missing_index == -1 else first_missing_index
            stage_status = TaskStatus.PROCESSING.value if index == active_index else TaskStatus.PENDING.value

        results.append(
            {
                "stage_id": stage["stage_id"],
                "label": stage["label"],
                "status": stage_status,
                "backend": meta.get("backend") or (
                    ExecutionMode.OPENCLAW.value if execution_mode == ExecutionMode.OPENCLAW.value and stage["stage_id"] in {"market", "social", "news", "fundamentals"}
                    else ExecutionMode.DEFAULT.value
                ),
                "summary": meta.get("summary") or _normalize_summary_text(content),
                "content": content if content is not None else None,
                "agent_id": meta.get("agent_id"),
                "session_key": meta.get("session_key"),
                "raw_output": meta.get("raw_output"),
                "started_at": meta.get("started_at"),
                "completed_at": meta.get("completed_at"),
                "duration_seconds": stage_times.get(report_key),
                "error": meta.get("error") if meta.get("error") else (task_error if stage_status in {TaskStatus.FAILED.value, TaskStatus.CANCELLED.value} else None),
            }
        )

    return results


def extract_analysis_report(
    state: Any,
    total_elapsed: Optional[float] = None,
    *,
    task_status: str = TaskStatus.PROCESSING.value,
    execution_mode: str = ExecutionMode.DEFAULT.value,
    task_error: Optional[str] = None,
) -> Dict[str, Any]:
    report: Dict[str, Any] = {}

    try:
        if isinstance(state, dict):
            report = {
                "market_report": state.get("market_report"),
                "sentiment_report": state.get("sentiment_report"),
                "news_report": state.get("news_report"),
                "fundamentals_report": state.get("fundamentals_report"),
                "investment_debate_state": state.get("investment_debate_state"),
                "investment_plan": state.get("investment_plan"),
                "trader_investment_plan": state.get("trader_investment_plan"),
                "risk_debate_state": state.get("risk_debate_state"),
                "final_trade_decision": state.get("final_trade_decision"),
                "messages": make_json_safe(state.get("messages")),
                "raw_state": make_json_safe(state),
            }
            report = {
                key: make_json_safe(value) for key, value in report.items() if value is not None
            }
            stage_times = extract_stage_times(state, total_elapsed)
            if stage_times:
                report["__stage_times"] = stage_times
            if total_elapsed is not None:
                report["__total_elapsed"] = total_elapsed
            key_outputs = extract_key_outputs(report)
            if key_outputs:
                report["__key_outputs"] = key_outputs
            report["__stages"] = build_stage_results(
                state,
                task_status=task_status,
                total_elapsed=total_elapsed,
                execution_mode=execution_mode,
                task_error=task_error,
            )
        else:
            report = {"raw_state": make_json_safe(state)}
    except Exception as exc:
        logger.error("Error extracting analysis report: %s", exc)
        report = {"error": str(exc), "raw_state": str(state)}

    return report


def update_processing_checkpoint(
    task_state: Dict[str, Any],
    state: Dict[str, Any],
    start_time: datetime,
    execution_mode: str,
) -> bool:
    latest_state = load_task_state(task_state["task_id"])
    if latest_state and latest_state.get("status") == TaskStatus.CANCELLED.value:
        raise TaskCancelledError("analysis cancelled by user")

    elapsed = max((datetime.now(timezone.utc) - start_time).total_seconds(), 0.0)
    analysis_report = extract_analysis_report(
        state,
        elapsed,
        task_status=TaskStatus.PROCESSING.value,
        execution_mode=execution_mode,
    )
    if not analysis_report:
        return False

    if task_state.get("analysis_report") == analysis_report:
        return False

    task_state.update(
        {
            "status": TaskStatus.PROCESSING.value,
            "execution_mode": execution_mode,
            "stages": analysis_report.get("__stages", []),
            "analysis_report": analysis_report,
            "processing_time_seconds": elapsed,
            "error": None,
        }
    )
    save_task_state(task_state)
    return True


class TaskCancelledError(RuntimeError):
    """Raised when a task has been cooperatively cancelled."""


def enqueue_analysis_request(request: AnalysisRequest) -> Dict[str, Any]:
    task_id = request.task_id or str(uuid.uuid4())
    task_state = create_task_state(task_id, request.ticker, request.date, request.execution_mode)
    payload = model_dump_compat(request)
    payload["task_id"] = task_id

    save_task_state(task_state)
    register_recent_task(task_id)
    get_redis_client().lpush(QUEUE_KEY, json.dumps(payload))

    return task_state


def run_analysis(task_id: str, request: AnalysisRequest) -> None:
    task_state = load_task_state(task_id) or create_task_state(
        task_id,
        request.ticker,
        request.date,
        request.execution_mode,
    )

    try:
        if task_state.get("status") == TaskStatus.CANCELLED.value:
            logger.info("Skipping cancelled analysis task %s before start", task_id)
            return

        logger.info("Starting analysis for task %s: %s on %s", task_id, request.ticker, request.date)

        task_state["status"] = TaskStatus.PROCESSING.value
        task_state["cancel_requested"] = False
        task_state["execution_mode"] = request.execution_mode.value
        save_task_state(task_state)

        start_time = datetime.now(timezone.utc)

        config = build_config(request)
        av_key = config.get("alpha_vantage_api_key", "")
        if av_key:
            os.environ["ALPHA_VANTAGE_API_KEY"] = av_key
        trading_graph = TradingAgentsGraph(debug=False, config=config)
        state, decision = trading_graph.propagate(
            request.ticker,
            request.date,
            progress_callback=lambda snapshot: update_processing_checkpoint(
                task_state,
                snapshot,
                start_time,
                request.execution_mode.value,
            ),
        )

        latest_state = load_task_state(task_id)
        if latest_state and latest_state.get("status") == TaskStatus.CANCELLED.value:
            raise TaskCancelledError("analysis cancelled by user")

        end_time = datetime.now(timezone.utc)
        processing_time = (end_time - start_time).total_seconds()

        trading_decision = extract_decision_info(decision)
        analysis_report = extract_analysis_report(
            state,
            processing_time,
            task_status=TaskStatus.COMPLETED.value,
            execution_mode=request.execution_mode.value,
        )

        task_state.update(
            {
                "status": TaskStatus.COMPLETED.value,
                "execution_mode": request.execution_mode.value,
                "decision": model_dump_compat(trading_decision),
                "stages": analysis_report.get("__stages", []),
                "analysis_report": analysis_report,
                "completed_at": end_time.isoformat(),
                "processing_time_seconds": processing_time,
                "error": None,
            }
        )
        save_task_state(task_state)

        logger.info("Completed analysis for task %s in %.2fs", task_id, processing_time)
    except TaskCancelledError as exc:
        logger.info("Cancelled analysis task %s: %s", task_id, exc)
        latest_state = load_task_state(task_id) or task_state
        latest_state.update(
            {
                "status": TaskStatus.CANCELLED.value,
                "cancel_requested": True,
                "execution_mode": request.execution_mode.value,
                "error": str(exc),
                "completed_at": utcnow_iso(),
            }
        )
        save_task_state(latest_state)
    except Exception as exc:
        logger.error("Error in analysis task %s: %s", task_id, exc, exc_info=True)
        task_state.update(
            {
                "status": TaskStatus.FAILED.value,
                "execution_mode": request.execution_mode.value,
                "stages": task_state.get("stages", []),
                "error": str(exc),
                "completed_at": utcnow_iso(),
            }
        )
        save_task_state(task_state)


async def _run_streaming_analysis_async(task_id: str, request: AnalysisRequest) -> None:
    """Async core of run_streaming_analysis: calls propagate_streaming and pushes events to Redis Stream."""
    task_state = load_task_state(task_id) or create_task_state(
        task_id, request.ticker, request.date, request.execution_mode
    )
    stream_key = f"{STREAM_KEY_PREFIX}:{task_id}"
    client = get_redis_client()

    if task_state.get("status") == TaskStatus.CANCELLED.value:
        logger.info("Skipping cancelled streaming task %s before start", task_id)
        return

    task_state["status"] = TaskStatus.PROCESSING.value
    task_state["cancel_requested"] = False
    task_state["execution_mode"] = request.execution_mode.value
    save_task_state(task_state)

    start_time = datetime.now(timezone.utc)

    async def token_cb(stage_id: str, node: str, token: str) -> None:
        try:
            client.xadd(
                stream_key,
                {"type": "token", "stage_id": stage_id, "node": node, "t": token},
                maxlen=200_000,
            )
        except Exception as exc:
            logger.warning("xadd token failed: %s", exc)

    async def stage_end_cb(stage_id: str, state_snapshot: Dict[str, Any]) -> None:
        try:
            # Check cancellation
            latest = load_task_state(task_id)
            if latest and latest.get("status") == TaskStatus.CANCELLED.value:
                raise TaskCancelledError("analysis cancelled by user")

            update_processing_checkpoint(task_state, state_snapshot, start_time, request.execution_mode.value)
            # find the stage data we just updated
            stage_rows = task_state.get("stages", [])
            stage_data = next((s for s in stage_rows if s.get("stage_id") == stage_id), {})
            client.xadd(
                stream_key,
                {"type": "stage_end", "stage_id": stage_id, "data": json.dumps(stage_data, default=str)},
                maxlen=200_000,
            )
        except TaskCancelledError:
            raise
        except Exception as exc:
            logger.warning("stage_end_cb failed for %s: %s", stage_id, exc)

    try:
        config = build_config(request)
        # If a per-user Alpha Vantage key was injected by the Go backend, apply it
        # to the process environment so TradingAgents dataflows can pick it up.
        # Safe because analyses are processed sequentially by a single worker thread.
        av_key = config.get("alpha_vantage_api_key", "")
        if av_key:
            os.environ["ALPHA_VANTAGE_API_KEY"] = av_key
        trading_graph = TradingAgentsGraph(debug=False, config=config)
        final_state = await trading_graph.propagate_streaming(
            request.ticker,
            request.date,
            token_callback=token_cb,
            stage_end_callback=stage_end_cb,
        )

        # check cancellation one last time
        latest = load_task_state(task_id)
        if latest and latest.get("status") == TaskStatus.CANCELLED.value:
            raise TaskCancelledError("analysis cancelled by user")

        end_time = datetime.now(timezone.utc)
        processing_time = (end_time - start_time).total_seconds()

        decision = trading_graph.process_signal(final_state.get("final_trade_decision", "HOLD"))
        trading_decision = extract_decision_info(decision)
        analysis_report = extract_analysis_report(
            final_state,
            processing_time,
            task_status=TaskStatus.COMPLETED.value,
            execution_mode=request.execution_mode.value,
        )

        task_state.update({
            "status": TaskStatus.COMPLETED.value,
            "execution_mode": request.execution_mode.value,
            "decision": model_dump_compat(trading_decision),
            "stages": analysis_report.get("__stages", []),
            "analysis_report": analysis_report,
            "completed_at": end_time.isoformat(),
            "processing_time_seconds": processing_time,
            "error": None,
        })
        save_task_state(task_state)

        client.xadd(stream_key, {"type": "task_complete", "status": "completed"})
        logger.info("Streaming analysis completed for task %s in %.2fs", task_id, processing_time)

    except TaskCancelledError as exc:
        logger.info("Streaming task %s cancelled: %s", task_id, exc)
        latest = load_task_state(task_id) or task_state
        latest.update({
            "status": TaskStatus.CANCELLED.value,
            "cancel_requested": True,
            "execution_mode": request.execution_mode.value,
            "error": str(exc),
            "completed_at": utcnow_iso(),
        })
        save_task_state(latest)
        try:
            client.xadd(stream_key, {"type": "task_error", "error": str(exc)})
        except Exception:
            pass

    except Exception as exc:
        logger.error("Streaming analysis task %s failed: %s", task_id, exc, exc_info=True)
        task_state.update({
            "status": TaskStatus.FAILED.value,
            "execution_mode": request.execution_mode.value,
            "stages": task_state.get("stages", []),
            "error": str(exc),
            "completed_at": utcnow_iso(),
        })
        save_task_state(task_state)
        try:
            client.xadd(stream_key, {"type": "task_error", "error": str(exc)})
        except Exception:
            pass

    finally:
        try:
            client.expire(stream_key, STREAM_TTL_SECONDS)
        except Exception:
            pass


def run_streaming_analysis(task_id: str, request: AnalysisRequest) -> None:
    """Synchronous wrapper for the streaming analysis — called from the worker thread."""
    asyncio.run(_run_streaming_analysis_async(task_id, request))


def process_analysis_payload(payload: str) -> None:
    request_payload = json.loads(payload)
    request = AnalysisRequest(**request_payload)
    if not request.task_id:
        raise ValueError("queued request is missing task_id")

    current_state = load_task_state(request.task_id)
    if current_state and current_state.get("status") == TaskStatus.CANCELLED.value:
        logger.info("Skipping queued payload for cancelled task %s", request.task_id)
        return

    run_streaming_analysis(request.task_id, request)


def recover_processing_queue() -> None:
    client = get_worker_redis_client()
    while True:
        payload = client.rpoplpush(PROCESSING_QUEUE_KEY, QUEUE_KEY)
        if payload is None:
            return
        logger.warning("Recovered analysis payload from processing queue")


def analysis_worker_loop() -> None:
    logger.info("Starting analysis worker loop")
    recover_processing_queue()
    client = get_worker_redis_client()

    while not worker_stop_event.is_set():
        payload = None
        try:
            payload = client.brpoplpush(QUEUE_KEY, PROCESSING_QUEUE_KEY, timeout=WORKER_QUEUE_BLOCK_SECONDS)
            if payload is None:
                continue

            process_analysis_payload(payload)
        except RedisError as exc:
            logger.error("Redis worker error: %s", exc, exc_info=True)
            time.sleep(1)
        except Exception as exc:
            logger.error("Worker processing error: %s", exc, exc_info=True)
            try:
                if payload is not None:
                    maybe_payload = json.loads(payload)
                    task_id = maybe_payload.get("task_id")
                    ticker = maybe_payload.get("ticker", "")
                    date = maybe_payload.get("date", "")
                    execution_mode_raw = maybe_payload.get("execution_mode", ExecutionMode.DEFAULT.value)
                    execution_mode = (
                        execution_mode_raw
                        if execution_mode_raw in {mode.value for mode in ExecutionMode}
                        else ExecutionMode.DEFAULT.value
                    )
                    if task_id:
                        task_state = load_task_state(task_id) or create_task_state(
                            task_id,
                            ticker,
                            date,
                            ExecutionMode(execution_mode),
                        )
                        task_state.update(
                            {
                                "status": TaskStatus.FAILED.value,
                                "execution_mode": execution_mode,
                                "error": str(exc),
                                "completed_at": utcnow_iso(),
                            }
                        )
                        save_task_state(task_state)
            except Exception:
                logger.error("Failed to persist worker failure state", exc_info=True)
        finally:
            if payload is not None:
                try:
                    client.lrem(PROCESSING_QUEUE_KEY, 1, payload)
                except RedisError:
                    logger.error("Failed to remove task from processing queue", exc_info=True)


def ensure_worker_thread_running() -> bool:
    global worker_thread

    if worker_thread is not None and worker_thread.is_alive():
        return False

    worker_stop_event.clear()
    worker_thread = threading.Thread(target=analysis_worker_loop, name="analysis-worker", daemon=True)
    worker_thread.start()
    logger.warning("Analysis worker thread was not running and has been restarted")
    return True


@app.on_event("startup")
def on_startup() -> None:
    get_redis_client()
    get_worker_redis_client()
    ensure_worker_thread_running()


@app.on_event("shutdown")
def on_shutdown() -> None:
    global worker_thread

    worker_stop_event.set()
    if worker_thread is not None and worker_thread.is_alive():
        worker_thread.join(timeout=WORKER_QUEUE_BLOCK_SECONDS + 1)
    close_redis_clients()


@app.get("/", response_model=Dict[str, str])
async def root() -> Dict[str, str]:
    return {
        "service": "TradingAgents Microservice",
        "version": "1.0.0",
        "docs": "/docs",
    }


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    status_value = "healthy"
    try:
        get_redis_client().ping()
    except Exception:
        status_value = "degraded"

    restarted = ensure_worker_thread_running()
    worker_alive = worker_thread is not None and worker_thread.is_alive()
    if restarted or not worker_alive:
        status_value = "degraded"

    openclaw_gateway = fetch_openclaw_gateway_health()
    if openclaw_gateway.get("status") not in {"healthy", "degraded"}:
        status_value = "degraded"

    return HealthResponse(
        status=status_value,
        service="tradingagents-service",
        version="1.0.0",
        timestamp=utcnow_iso(),
        worker_alive=worker_alive,
        openclaw_gateway=openclaw_gateway,
    )


@app.post("/api/v1/analyze", response_model=AnalysisResponse, status_code=status.HTTP_202_ACCEPTED)
async def analyze_stock(request: AnalysisRequest) -> AnalysisResponse:
    ensure_worker_thread_running()
    task_state = enqueue_analysis_request(request)
    return AnalysisResponse(**task_state)


@app.post("/api/v1/analyze/sync", response_model=AnalysisResponse)
async def analyze_stock_sync(request: AnalysisRequest) -> AnalysisResponse:
    task_id = request.task_id or str(uuid.uuid4())
    request.task_id = task_id

    task_state = create_task_state(task_id, request.ticker, request.date)
    save_task_state(task_state)
    register_recent_task(task_id)

    run_analysis(task_id, request)
    final_state = load_task_state(task_id)
    return AnalysisResponse(**final_state)


@app.get("/api/v1/analysis/{task_id}", response_model=AnalysisResponse)
async def get_analysis_result(task_id: str) -> AnalysisResponse:
    task_state = load_task_state(task_id)
    if task_state is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found",
        )

    return AnalysisResponse(**task_state)


@app.get("/api/v1/analysis/{task_id}/stream")
async def stream_analysis_events(task_id: str, request: Request):  # type: ignore[override]
    """SSE endpoint that streams token events and stage completions for a task."""
    stream_key = f"{STREAM_KEY_PREFIX}:{task_id}"
    loop = asyncio.get_event_loop()
    client = get_redis_client()

    async def event_gen():
        task_state = load_task_state(task_id)
        if not task_state:
            yield {"data": json.dumps({"type": "error", "error": f"task {task_id} not found"})}
            return

        # Always start from the beginning of the stream so nothing is missed
        last_id = "0"

        while True:
            if await request.is_disconnected():
                break

            current_last_id = last_id  # capture for thread-safe lambda

            try:
                results = await loop.run_in_executor(
                    None,
                    lambda lid=current_last_id: client.xread(
                        {stream_key: lid}, count=200, block=500
                    ),
                )
            except Exception as exc:
                logger.warning("xread error for task %s: %s", task_id, exc)
                await asyncio.sleep(0.5)
                continue

            if results:
                for _, entries in results:
                    for entry_id, fields in entries:
                        last_id = entry_id
                        yield {"data": json.dumps(fields)}
                        if fields.get("type") in ("task_complete", "task_error"):
                            return
            else:
                # No new stream messages — check if task already finished before stream was created
                ts = load_task_state(task_id)
                if ts and ts["status"] in (
                    TaskStatus.COMPLETED.value,
                    TaskStatus.FAILED.value,
                    TaskStatus.CANCELLED.value,
                ):
                    yield {"data": json.dumps({"type": "task_complete", "status": ts["status"]})}
                    return

    return EventSourceResponse(event_gen())


@app.get("/api/v1/tasks")
async def list_tasks(limit: int = 10) -> Dict[str, Any]:
    task_ids = get_redis_client().lrange(RECENT_TASKS_KEY, 0, max(limit, 1)-1)
    tasks: List[Dict[str, Any]] = []
    for task_id in task_ids:
        task_state = load_task_state(task_id)
        if task_state is not None:
            tasks.append(task_state)

    return {
        "tasks": tasks,
        "total": len(tasks),
    }


@app.delete("/api/v1/analysis/{task_id}")
async def delete_task(task_id: str) -> Dict[str, str]:
    task_state = load_task_state(task_id)
    if task_state is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found",
        )

    client = get_redis_client()
    client.delete(runtime_state_key(task_id))
    client.lrem(RECENT_TASKS_KEY, 0, task_id)

    return {"message": f"Task {task_id} deleted"}


@app.get("/api/v1/config", response_model=Dict[str, Any])
async def get_default_config() -> Dict[str, Any]:
    return {
        "llm_config": {
            "deep_think_llm": DEFAULT_CONFIG["deep_think_llm"],
            "quick_think_llm": DEFAULT_CONFIG["quick_think_llm"],
            "max_debate_rounds": DEFAULT_CONFIG["max_debate_rounds"],
            "max_risk_discuss_rounds": DEFAULT_CONFIG["max_risk_discuss_rounds"],
        },
        "data_vendors": DEFAULT_CONFIG["data_vendors"],
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("TRADING_SERVICE_PORT", "8001"))

    logger.info("Starting TradingAgents microservice on port %s", port)

    uvicorn.run(
        "trading_service:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="info",
    )
