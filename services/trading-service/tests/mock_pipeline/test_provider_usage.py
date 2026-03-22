import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


PYTHON_COMMON_DIR = Path(__file__).resolve().parents[3] / "python-common"
if str(PYTHON_COMMON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_COMMON_DIR))

from provider_usage import normalize_usage


class NormalizeUsageTest(unittest.TestCase):
    def test_prefers_usage_metadata(self):
        result = SimpleNamespace(
            usage_metadata={
                "input_tokens": 120,
                "output_tokens": 45,
                "total_tokens": 165,
            },
            response_metadata={"model_name": "gpt-4o-mini"},
        )

        usage = normalize_usage("openai", result)

        self.assertEqual(usage.prompt_tokens, 120)
        self.assertEqual(usage.completion_tokens, 45)
        self.assertEqual(usage.total_tokens, 165)
        self.assertEqual(usage.model, "gpt-4o-mini")

    def test_extracts_ollama_usage_from_response_metadata(self):
        result = SimpleNamespace(
            response_metadata={
                "model_name": "gemma3:1b",
                "prompt_eval_count": 88,
                "eval_count": 34,
            }
        )

        usage = normalize_usage("ollama", result)

        self.assertEqual(usage.prompt_tokens, 88)
        self.assertEqual(usage.completion_tokens, 34)
        self.assertEqual(usage.total_tokens, 122)
        self.assertEqual(usage.model, "gemma3:1b")

    def test_extracts_ollama_usage_from_generation_info(self):
        result = SimpleNamespace(
            generation_info={
                "prompt_eval_count": 50,
                "eval_count": 25,
                "model": "llama3.2",
            }
        )

        usage = normalize_usage("ollama", result)

        self.assertEqual(usage.prompt_tokens, 50)
        self.assertEqual(usage.completion_tokens, 25)
        self.assertEqual(usage.total_tokens, 75)
        self.assertEqual(usage.model, "llama3.2")


if __name__ == "__main__":
    unittest.main()
