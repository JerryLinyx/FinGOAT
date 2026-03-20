from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel


def model_dump_compat(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="json", exclude_none=True)
    return model.dict(exclude_none=True)


def make_json_safe(value: Any, seen: Optional[set[int]] = None) -> Any:
    if seen is None:
        seen = set()

    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, Enum):
        return value.value

    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, BaseModel):
        return make_json_safe(model_dump_compat(value), seen)

    if isinstance(value, dict):
        obj_id = id(value)
        if obj_id in seen:
            return "<recursive-dict>"
        seen.add(obj_id)
        return {str(key): make_json_safe(item, seen) for key, item in value.items()}

    if isinstance(value, (list, tuple, set)):
        obj_id = id(value)
        if obj_id in seen:
            return ["<recursive-sequence>"]
        seen.add(obj_id)
        return [make_json_safe(item, seen) for item in value]

    if hasattr(value, "content") and hasattr(value, "type"):
        message_payload = {
            "type": getattr(value, "type", value.__class__.__name__),
            "content": make_json_safe(getattr(value, "content", None), seen),
        }
        for attr in ("name", "id", "tool_call_id"):
            attr_value = getattr(value, attr, None)
            if attr_value is not None:
                message_payload[attr] = make_json_safe(attr_value, seen)
        for attr in ("additional_kwargs", "response_metadata", "tool_calls", "invalid_tool_calls"):
            attr_value = getattr(value, attr, None)
            if attr_value not in (None, {}, []):
                message_payload[attr] = make_json_safe(attr_value, seen)
        return message_payload

    if hasattr(value, "model_dump"):
        try:
            return make_json_safe(value.model_dump(mode="json"), seen)
        except Exception:
            pass

    if hasattr(value, "dict"):
        try:
            return make_json_safe(value.dict(), seen)
        except Exception:
            pass

    if hasattr(value, "__dict__"):
        try:
            return make_json_safe(vars(value), seen)
        except Exception:
            pass

    return str(value)
