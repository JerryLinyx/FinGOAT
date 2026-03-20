import sys
from pathlib import Path


TESTS_DIR = Path(__file__).resolve().parent
SERVICE_DIR = TESTS_DIR.parent
SERVICES_DIR = SERVICE_DIR.parent
PYTHON_COMMON_DIR = SERVICES_DIR / "python-common"

for path in (str(SERVICE_DIR), str(PYTHON_COMMON_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)
