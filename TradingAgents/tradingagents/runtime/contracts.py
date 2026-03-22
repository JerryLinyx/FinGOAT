from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, Optional, Protocol


@dataclass
class StageRequest:
    task_id: str
    user_id: Optional[int]
    stage_id: str
    ticker: str
    analysis_date: str
    market: str
    upstream_outputs: Dict[str, Any]
    llm_config: Dict[str, Any]
    data_vendor_config: Dict[str, Any]
    execution_context: Dict[str, Any]
    instructions: str


@dataclass
class StageResult:
    stage_id: str
    label: str
    status: str
    backend: str
    provider: str
    summary: Optional[str] = None
    content: Optional[Any] = None
    raw_output: Optional[Any] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_seconds: Optional[float] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    llm_calls: Optional[int] = None
    failed_calls: Optional[int] = None
    latency_ms: Optional[int] = None
    error: Optional[str] = None
    agent_id: Optional[str] = None
    session_key: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stage_id": self.stage_id,
            "label": self.label,
            "status": self.status,
            "backend": self.backend,
            "provider": self.provider,
            "summary": self.summary,
            "content": self.content,
            "raw_output": self.raw_output,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "duration_seconds": self.duration_seconds,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "llm_calls": self.llm_calls,
            "failed_calls": self.failed_calls,
            "latency_ms": self.latency_ms,
            "error": self.error,
            "agent_id": self.agent_id,
            "session_key": self.session_key,
        }


@dataclass
class StageEvent:
    type: str
    stage_id: str
    payload: Dict[str, Any] = field(default_factory=dict)


class ExecutionBackend(Protocol):
    def run_stage(self, request: StageRequest) -> StageResult: ...

    def stream_stage(self, request: StageRequest) -> Iterable[StageEvent]: ...

    def cancel_stage(self, run_id: str) -> None: ...
