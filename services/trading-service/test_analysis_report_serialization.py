import json
import sys
from pathlib import Path

from langchain_core.messages import HumanMessage

SERVICE_DIR = Path(__file__).resolve().parent
PYTHON_COMMON_DIR = SERVICE_DIR.parent / "python-common"
if str(PYTHON_COMMON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_COMMON_DIR))

from json_safety import make_json_safe


def test_make_json_safe_serializes_langchain_messages() -> None:
    payload = {"messages": [HumanMessage(content="Continue")]}

    safe_payload = make_json_safe(payload)
    encoded = json.dumps(safe_payload)

    assert "HumanMessage" not in encoded
    assert safe_payload["messages"][0]["content"] == "Continue"
    assert safe_payload["messages"][0]["type"] == "human"
