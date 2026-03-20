#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
RECORDS_DIR = ROOT / "docs/devlog/records"
README_PATH = RECORDS_DIR / "README.md"

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
FIELD_RE = re.compile(r"^([A-Za-z_]+):\s*(.*)$")


def parse_frontmatter(text: str) -> dict[str, str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        raise ValueError("missing frontmatter")
    data: dict[str, str] = {}
    for raw_line in match.group(1).splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        field = FIELD_RE.match(line)
        if not field:
            continue
        key, value = field.groups()
        data[key] = value.strip()
    return data


def require_fields(path: Path, data: dict[str, str]) -> None:
    required = ["id", "kind", "title", "date", "status"]
    missing = [key for key in required if not data.get(key)]
    if missing:
        raise ValueError(f"missing fields: {', '.join(missing)}")


def render_index(rows: list[dict[str, str]]) -> str:
    grouped = {"decision": [], "requirement": [], "review": []}
    for row in rows:
        grouped.setdefault(row["kind"], []).append(row)

    lines = [
        "# Records",
        "",
        "Active project records use stable `ADR-XXX` identifiers and are grouped by `kind`.",
        "",
        "Frontmatter minimum:",
        "",
        "- `id`, `kind`, `title`, `date`, `status`",
        "- optional directional links such as `supersedes`, `superseded_by`, `implements`, `verified_by`",
        "",
        "Commit messages should reference the stable ADR ID when implementation work lands.",
        "",
    ]

    kind_titles = {
        "decision": "Decisions",
        "requirement": "Requirements",
        "review": "Reviews",
    }

    for kind in ["decision", "requirement", "review"]:
        lines.append(f"## {kind_titles[kind]}")
        lines.append("")
        lines.append("| ID | Date | Kind | Title | Status |")
        lines.append("| --- | --- | --- | --- | --- |")
        for row in sorted(grouped.get(kind, []), key=lambda item: item["id"]):
            lines.append(
                f"| [{row['id']}](./{row['filename']}) | {row['date']} | {row['kind']} | {row['title']} | {row['status']} |"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    rows: list[dict[str, str]] = []
    seen_ids: dict[str, Path] = {}

    for path in sorted(RECORDS_DIR.glob("ADR-*.md")):
        data = parse_frontmatter(path.read_text())
        require_fields(path, data)
        record_id = data["id"]
        if record_id in seen_ids:
            raise ValueError(f"duplicate id {record_id}: {seen_ids[record_id]} and {path}")
        seen_ids[record_id] = path
        rows.append(
            {
                "id": record_id,
                "kind": data["kind"],
                "title": data["title"],
                "date": data["date"],
                "status": data["status"],
                "filename": path.name,
            }
        )

    README_PATH.write_text(render_index(rows))
    print(f"updated {README_PATH.relative_to(ROOT)} with {len(rows)} records")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
