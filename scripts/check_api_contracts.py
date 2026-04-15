#!/usr/bin/env python3
"""Non-blocking check that Go analysis structs cover documented shared fields."""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DOC_PATH = REPO_ROOT / "docs/devlog/appendix/api-contracts.md"
GO_PATH = REPO_ROOT / "backend/controllers/trading_runtime.go"

DOC_STRUCT_HEADINGS = {
    "AnalysisRequest": "AnalysisRequest",
    "LLMConfig": "LLMConfig",
    "DataVendorConfig": "DataVendorConfig",
    "StageResult": "AnalysisTaskStage",
}


def parse_doc_fields(doc_text: str) -> dict[str, set[str]]:
    sections: dict[str, set[str]] = {}
    current: str | None = None
    for raw_line in doc_text.splitlines():
        line = raw_line.strip()
        if line.startswith("## "):
            current = line.removeprefix("## ").strip()
            sections[current] = set()
            continue
        if current and line.startswith("- `") and line.count("`") >= 2:
            field = line.split("`", 2)[1].strip()
            if "->" not in line:
                sections[current].add(field)
    return sections


def parse_go_struct_fields(go_text: str, struct_name: str) -> set[str]:
    pattern = re.compile(rf"type {re.escape(struct_name)} struct \{{(.*?)\n\}}", re.S)
    match = pattern.search(go_text)
    if not match:
        return set()
    body = match.group(1)
    fields: set[str] = set()
    for field_match in re.finditer(r'json:"([^",]+)', body):
        fields.add(field_match.group(1))
    return fields


def main() -> int:
    doc_text = DOC_PATH.read_text(encoding="utf-8")
    go_text = GO_PATH.read_text(encoding="utf-8")

    doc_fields = parse_doc_fields(doc_text)
    warnings: list[str] = []

    for doc_heading, go_struct in DOC_STRUCT_HEADINGS.items():
        expected = doc_fields.get(doc_heading, set())
        actual = parse_go_struct_fields(go_text, go_struct)
        missing = sorted(expected - actual)
        if missing:
            warnings.append(f"{go_struct} is missing documented fields: {', '.join(missing)}")

    if warnings:
        print("API contract warnings:")
        for warning in warnings:
            print(f"- {warning}")
    else:
        print("API contracts look aligned.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
