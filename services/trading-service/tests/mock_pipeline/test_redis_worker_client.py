import importlib
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

from tests.mock_pipeline.test_mock_analysis_pipeline import install_fake_tradingagents_modules


class RedisWorkerClientTest(unittest.TestCase):
    def setUp(self) -> None:
        install_fake_tradingagents_modules()
        sys.modules.pop("trading_service", None)
        self.trading_service = importlib.import_module("trading_service")
        self.trading_service.reset_redis_clients()

    def tearDown(self) -> None:
        self.trading_service.reset_redis_clients()
        sys.modules.pop("trading_service", None)

    def test_worker_client_uses_no_socket_timeout(self) -> None:
        clients = []

        def fake_redis(*args, **kwargs):
            client = MagicMock()
            client.kwargs = kwargs
            clients.append(client)
            return client

        with patch.object(self.trading_service, "Redis", side_effect=fake_redis):
            request_client = self.trading_service.get_redis_client()
            worker_client = self.trading_service.get_worker_redis_client()

        self.assertIsNot(request_client, worker_client)
        self.assertEqual(request_client.kwargs["socket_timeout"], self.trading_service.REDIS_SOCKET_TIMEOUT_SECONDS)
        self.assertIsNone(worker_client.kwargs["socket_timeout"])
        self.assertEqual(request_client.ping.call_count, 1)
        self.assertEqual(worker_client.ping.call_count, 1)

    def test_worker_client_reuses_cached_instance(self) -> None:
        client = MagicMock()
        client.ping = MagicMock()

        with patch.object(self.trading_service, "build_redis_client", return_value=client) as build_client:
            first = self.trading_service.get_worker_redis_client()
            second = self.trading_service.get_worker_redis_client()

        self.assertIs(first, second)
        build_client.assert_called_once_with(socket_timeout=None)
        client.ping.assert_called_once()

    def test_resolve_redis_connection_config_reads_redis_addr(self) -> None:
        with patch.dict(
            os.environ,
            {
                "REDIS_ADDR": "redis.example.com:6380",
                "REDIS_PASSWORD": "secret",
                "REDIS_DB": "2",
            },
            clear=False,
        ):
            config = self.trading_service.resolve_redis_connection_config()

        self.assertEqual(config["host"], "redis.example.com")
        self.assertEqual(config["port"], 6380)
        self.assertEqual(config["password"], "secret")
        self.assertEqual(config["db"], 2)
        self.assertTrue(config["decode_responses"])


if __name__ == "__main__":
    unittest.main()
