#!/usr/bin/env bash
# check-boundaries.sh
#
# Enforces the architecture rule: the frontend must NEVER call the Python trading
# service (port 8001) directly. All requests must go via the Go backend (/api/).
#
# Run from project root:
#   bash scripts/check-boundaries.sh
#
# Exit 0 = clean; Exit 1 = violation found.

set -euo pipefail

# Look for fetch calls that use a bare /trading/ path (without the /api prefix)
VIOLATIONS=$(grep -Prn "fetch\([^)]*['\"]\/trading\/" frontend/src/ 2>/dev/null || true)

if [ -n "$VIOLATIONS" ]; then
    echo "❌ BOUNDARY VIOLATION: Direct call to Python backend detected in frontend:"
    echo ""
    echo "$VIOLATIONS"
    echo ""
    echo "All frontend API calls must go through /api/ (Go backend, port 3000)."
    echo "The Python trading service (port 8001) is an internal worker — not a public API."
    exit 1
fi

echo "✅ Boundary check passed — no direct frontend→Python calls found."
exit 0
