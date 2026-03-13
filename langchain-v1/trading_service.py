"""
TradingAgents FastAPI Microservice

This service exposes health/config endpoints and runs a Redis-backed worker for
multi-agent trading analysis tasks.
"""

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

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from redis import Redis
from redis.exceptions import RedisError

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


class DataVendorConfig(BaseModel):
    core_stock_apis: str = Field(default="yfinance", description="Stock data provider")
    technical_indicators: str = Field(default="yfinance", description="Technical indicators provider")
    fundamental_data: str = Field(default="alpha_vantage", description="Fundamental data provider")
    news_data: str = Field(default="alpha_vantage", description="News data provider")


class AnalysisRequest(BaseModel):
    task_id: Optional[str] = Field(default=None, description="Optional externally supplied task id")
    ticker: str = Field(..., description="Stock ticker symbol", example="NVDA")
    date: str = Field(..., description="Analysis date in YYYY-MM-DD format", example="2024-05-10")
    llm_config: Optional[LLMConfig] = Field(default=None, description="LLM configuration")
    data_vendor_config: Optional[DataVendorConfig] = Field(default=None, description="Data vendor configuration")

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


class AnalysisResponse(BaseModel):
    task_id: str
    status: TaskStatus
    ticker: str
    date: str
    decision: Optional[TradingDecision] = None
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


def create_task_state(task_id: str, ticker: str, date: str) -> Dict[str, Any]:
    return {
        "task_id": task_id,
        "status": TaskStatus.PENDING.value,
        "cancel_requested": False,
        "ticker": ticker,
        "date": date,
        "decision": None,
        "analysis_report": None,
        "error": None,
        "created_at": utcnow_iso(),
        "completed_at": None,
        "processing_time_seconds": None,
    }


STAGE_ORDER = [
    "market_report",
    "sentiment_report",
    "news_report",
    "fundamentals_report",
    "investment_debate_state",
    "investment_plan",
    "trader_investment_plan",
    "risk_debate_state",
    "final_trade_decision",
]

STAGE_LABELS = {
    "market_report": "Technical",
    "sentiment_report": "Social Media",
    "news_report": "News",
    "fundamentals_report": "Fundamentals",
    "investment_debate_state": "Research Debate",
    "investment_plan": "Portfolio Manager",
    "trader_investment_plan": "Trader Plan",
    "risk_debate_state": "Risk Debate",
    "final_trade_decision": "Risk Management",
}

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


def extract_analysis_report(state: Any, total_elapsed: Optional[float] = None) -> Dict[str, Any]:
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
) -> bool:
    latest_state = load_task_state(task_state["task_id"])
    if latest_state and latest_state.get("status") == TaskStatus.CANCELLED.value:
        raise TaskCancelledError("analysis cancelled by user")

    elapsed = max((datetime.now(timezone.utc) - start_time).total_seconds(), 0.0)
    analysis_report = extract_analysis_report(state, elapsed)
    if not analysis_report:
        return False

    if task_state.get("analysis_report") == analysis_report:
        return False

    task_state.update(
        {
            "status": TaskStatus.PROCESSING.value,
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
    task_state = create_task_state(task_id, request.ticker, request.date)
    payload = model_dump_compat(request)
    payload["task_id"] = task_id

    save_task_state(task_state)
    register_recent_task(task_id)
    get_redis_client().lpush(QUEUE_KEY, json.dumps(payload))

    return task_state


def run_analysis(task_id: str, request: AnalysisRequest) -> None:
    task_state = load_task_state(task_id) or create_task_state(task_id, request.ticker, request.date)

    try:
        if task_state.get("status") == TaskStatus.CANCELLED.value:
            logger.info("Skipping cancelled analysis task %s before start", task_id)
            return

        logger.info("Starting analysis for task %s: %s on %s", task_id, request.ticker, request.date)

        task_state["status"] = TaskStatus.PROCESSING.value
        task_state["cancel_requested"] = False
        save_task_state(task_state)

        start_time = datetime.now(timezone.utc)

        config = build_config(request)
        trading_graph = TradingAgentsGraph(debug=False, config=config)
        state, decision = trading_graph.propagate(
            request.ticker,
            request.date,
            progress_callback=lambda snapshot: update_processing_checkpoint(task_state, snapshot, start_time),
        )

        latest_state = load_task_state(task_id)
        if latest_state and latest_state.get("status") == TaskStatus.CANCELLED.value:
            raise TaskCancelledError("analysis cancelled by user")

        end_time = datetime.now(timezone.utc)
        processing_time = (end_time - start_time).total_seconds()

        trading_decision = extract_decision_info(decision)
        analysis_report = extract_analysis_report(state, processing_time)

        task_state.update(
            {
                "status": TaskStatus.COMPLETED.value,
                "decision": model_dump_compat(trading_decision),
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
                "error": str(exc),
                "completed_at": utcnow_iso(),
            }
        )
        save_task_state(task_state)


def process_analysis_payload(payload: str) -> None:
    request_payload = json.loads(payload)
    request = AnalysisRequest(**request_payload)
    if not request.task_id:
        raise ValueError("queued request is missing task_id")

    current_state = load_task_state(request.task_id)
    if current_state and current_state.get("status") == TaskStatus.CANCELLED.value:
        logger.info("Skipping queued payload for cancelled task %s", request.task_id)
        return

    run_analysis(request.task_id, request)


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
                    if task_id:
                        task_state = load_task_state(task_id) or create_task_state(task_id, ticker, date)
                        task_state.update(
                            {
                                "status": TaskStatus.FAILED.value,
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


@app.on_event("startup")
def on_startup() -> None:
    global worker_thread

    get_redis_client()
    get_worker_redis_client()

    if worker_thread is None or not worker_thread.is_alive():
        worker_stop_event.clear()
        worker_thread = threading.Thread(target=analysis_worker_loop, name="analysis-worker", daemon=True)
        worker_thread.start()


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

    return HealthResponse(
        status=status_value,
        service="tradingagents-service",
        version="1.0.0",
        timestamp=utcnow_iso(),
    )


@app.post("/api/v1/analyze", response_model=AnalysisResponse, status_code=status.HTTP_202_ACCEPTED)
async def analyze_stock(request: AnalysisRequest) -> AnalysisResponse:
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
