import json
from langchain_core.messages import HumanMessage

from json_safety import make_json_safe


def test_make_json_safe_serializes_langchain_messages() -> None:
    payload = {"messages": [HumanMessage(content="Continue")]}

    safe_payload = make_json_safe(payload)
    encoded = json.dumps(safe_payload)

    assert "HumanMessage" not in encoded
    assert safe_payload["messages"][0]["content"] == "Continue"
    assert safe_payload["messages"][0]["type"] == "human"
