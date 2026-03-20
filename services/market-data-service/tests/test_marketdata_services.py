import json
import sys
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch


SERVICE_DIR = Path(__file__).resolve().parents[1]
PYTHON_COMMON_DIR = SERVICE_DIR.parent / "python-common"
for path in (str(SERVICE_DIR), str(PYTHON_COMMON_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

from marketdata.normalize import build_indicator_payload
from marketdata.policies import read_cache, write_cache
from marketdata.services.quote_service import get_quote


class FakeRedis:
    def __init__(self) -> None:
        self._values: dict[str, str] = {}

    def get(self, key):
        return self._values.get(key)

    def set(self, key, value, ex=None):  # noqa: ARG002
        self._values[key] = value
        return True

    def delete(self, key):
        self._values.pop(key, None)
        return 1

    def incr(self, key):
        value = int(self._values.get(key, "0")) + 1
        self._values[key] = str(value)
        return value

    def expire(self, key, seconds):  # noqa: ARG002
        return True


class MarketDataServicesTest(unittest.TestCase):
    def test_quote_service_uses_yfinance_as_primary_source_and_caches_result(self):
        redis_client = FakeRedis()
        yfinance_payload = {
            "ticker": "600519",
            "name": "600519",
            "last_price": 1666.0,
            "change": 12.5,
            "change_pct": 0.76,
            "open": 1650.0,
            "high": 1672.0,
            "low": 1642.0,
            "prev_close": 1653.5,
            "volume": 1200000.0,
            "amount": None,
            "turnover_rate": None,
        }

        with patch("marketdata.services.quote_service.yfinance_raw.fetch_quote", return_value=yfinance_payload):
            payload = get_quote(redis_client, "600519", "cn")

        self.assertEqual(payload["source"], "yfinance")
        self.assertIsNone(payload["fallback_used"])
        self.assertEqual(payload["cache_status"], "miss")
        self.assertFalse(payload["stale"])
        self.assertEqual(payload["name"], "600519")

        cached_payload = get_quote(redis_client, "600519", "cn")
        self.assertEqual(cached_payload["cache_status"], "fresh")
        self.assertEqual(cached_payload["source"], "yfinance")

    def test_read_cache_returns_stale_payload_after_ttl(self):
        redis_client = FakeRedis()
        key = "market:test"
        payload = {"ticker": "600519", "market": "cn", "source": "akshare", "cache_status": "miss", "stale": False}
        write_cache(redis_client, key, payload, 600)

        envelope = json.loads(redis_client.get(key))
        envelope["_fetched_ts"] = time.time() - 30
        redis_client.set(key, json.dumps(envelope), ex=600)

        cached, cache_status = read_cache(redis_client, key, fresh_ttl_seconds=5)
        self.assertEqual(cache_status, "stale")
        self.assertIsNotNone(cached)
        self.assertTrue(cached["stale"])
        self.assertEqual(cached["cache_status"], "stale")

    def test_indicator_payload_is_sparse_and_macd_is_warmed_up(self):
        candles = []
        start = datetime(2026, 1, 1)
        for index in range(40):
            candles.append(
                {
                    "Date": (start + timedelta(days=index)).strftime("%Y-%m-%d"),
                    "Close": 10 + index,
                    "Volume": 1000 + index,
                }
            )

        import pandas as pd

        df = pd.DataFrame(candles)
        df["Date"] = pd.to_datetime(df["Date"])
        payload = build_indicator_payload(df)

        self.assertGreater(len(payload["ma"]["ma5"]), 0)
        self.assertGreater(len(payload["macd"]["dif"]), 0)
        self.assertLess(len(payload["macd"]["dif"]), len(candles))
        self.assertEqual(payload["macd"]["dif"][0]["date"], "2026-01-26")


if __name__ == "__main__":
    unittest.main()
