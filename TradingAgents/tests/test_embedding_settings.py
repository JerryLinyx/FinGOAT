import importlib.util
import os
import sys
import types
import unittest
from unittest.mock import patch


MODULE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "tradingagents", "agents", "utils", "memory.py")
)

chromadb_module = types.ModuleType("chromadb")
chromadb_module.Client = object
chromadb_config_module = types.ModuleType("chromadb.config")
chromadb_config_module.Settings = object
openai_module = types.ModuleType("openai")
openai_module.OpenAI = object

sys.modules.setdefault("chromadb", chromadb_module)
sys.modules.setdefault("chromadb.config", chromadb_config_module)
sys.modules.setdefault("openai", openai_module)

SPEC = importlib.util.spec_from_file_location("memory_under_test", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class EmbeddingSettingsTest(unittest.TestCase):
    def test_ollama_defaults_to_local_embedding_route(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            model, base_url, api_key = MODULE._resolve_embedding_settings(
                {"llm_provider": "ollama", "backend_url": "http://localhost:11434"}
            )

        self.assertEqual(model, "nomic-embed-text")
        self.assertEqual(base_url, "http://localhost:11434/v1")
        self.assertEqual(api_key, "ollama")

    def test_ollama_explicit_embed_base_url_wins(self) -> None:
        with patch.dict(
            os.environ,
            {
                "EMBED_MODEL": "custom-embed",
                "EMBED_BASE_URL": "http://ollama-host:11434/v1",
                "EMBED_API_KEY": "local-key",
            },
            clear=False,
        ):
            model, base_url, api_key = MODULE._resolve_embedding_settings(
                {"llm_provider": "ollama", "backend_url": "http://localhost:11434"}
            )

        self.assertEqual(model, "custom-embed")
        self.assertEqual(base_url, "http://ollama-host:11434/v1")
        self.assertEqual(api_key, "local-key")

    def test_dashscope_ignores_generic_embed_overrides(self) -> None:
        with patch.dict(os.environ, {"DASHSCOPE_API_KEY": "dash-key"}, clear=False):
            with patch.dict(
                os.environ,
                {
                    "EMBED_MODEL": "nomic-embed-text",
                    "EMBED_BASE_URL": "http://localhost:11434/v1",
                    "EMBED_API_KEY": "ollama",
                },
                clear=False,
            ):
                model, base_url, api_key = MODULE._resolve_embedding_settings({"llm_provider": "dashscope"})

        self.assertEqual(model, "text-embedding-v4")
        self.assertEqual(base_url, MODULE.DASHSCOPE_COMPAT_BASE_URL)
        self.assertEqual(api_key, "dash-key")

    def test_aliyun_alias_maps_to_dashscope_defaults(self) -> None:
        with patch.dict(os.environ, {"DASHSCOPE_API_KEY": "dash-key"}, clear=False):
            model, base_url, api_key = MODULE._resolve_embedding_settings({"llm_provider": "aliyun"})

        self.assertEqual(model, "text-embedding-v4")
        self.assertEqual(base_url, MODULE.DASHSCOPE_COMPAT_BASE_URL)
        self.assertEqual(api_key, "dash-key")


class MemoryDegradeTest(unittest.TestCase):
    def test_ollama_embedding_failure_returns_empty_memories(self) -> None:
        memory = MODULE.FinancialSituationMemory.__new__(MODULE.FinancialSituationMemory)
        memory.provider = "ollama"
        memory.get_embedding = lambda _text: (_ for _ in ()).throw(Exception('model "nomic-embed-text" not found'))

        result = MODULE.FinancialSituationMemory.get_memories(memory, "current situation", n_matches=2)

        self.assertEqual(result, [])

    def test_non_ollama_embedding_failure_still_raises(self) -> None:
        memory = MODULE.FinancialSituationMemory.__new__(MODULE.FinancialSituationMemory)
        memory.provider = "openai"
        memory.get_embedding = lambda _text: (_ for _ in ()).throw(Exception("unexpected embedding failure"))

        with self.assertRaises(Exception):
            MODULE.FinancialSituationMemory.get_memories(memory, "current situation", n_matches=2)


if __name__ == "__main__":
    unittest.main()
