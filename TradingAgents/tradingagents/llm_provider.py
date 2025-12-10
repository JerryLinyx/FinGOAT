"""LLM provider factory to support multiple backends with a common interface."""

import os
from typing import Any, Dict

from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI

try:
    from langchain_community.chat_models import ChatOllama
except Exception:  # pragma: no cover - optional dependency
    ChatOllama = None


def _common_kwargs(config: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "temperature": config.get("llm_temperature", 0.2),
        "timeout": config.get("llm_timeout", 60),
    }


def _resolve_api_key(provider: str, config: Dict[str, Any]) -> str:
    # Explicit config value wins
    if config.get("llm_api_key"):
        return config["llm_api_key"]
    # General override
    if os.getenv("LLM_API_KEY"):
        return os.getenv("LLM_API_KEY", "")

    provider = provider.lower()
    if provider in {"openai", "openai-compatible", "vllm"}:
        return os.getenv("OPENAI_API_KEY", "")
    if provider == "openrouter":
        return os.getenv("OPENROUTER_API_KEY", "") or os.getenv("OPENAI_API_KEY", "")
    if provider == "deepseek":
        return os.getenv("DEEPSEEK_API_KEY", "") or os.getenv("OPENAI_API_KEY", "")
    if provider == "aliyun":
        return os.getenv("DASHSCOPE_API_KEY", "")
    if provider == "anthropic":
        return os.getenv("CLAUDE_API_KEY", "") or os.getenv("ANTHROPIC_API_KEY", "")
    if provider == "google":
        return os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")
    if provider == "ollama":
        return os.getenv("OLLAMA_API_KEY", "")  # optional, often blank
    # Fallback
    return os.getenv("OPENAI_API_KEY", "")


def build_llm(config: Dict[str, Any], which: str = "quick"):
    """Build a chat model based on provider and requested tier.

    which: "quick" or "deep"
    """
    provider = config.get("llm_provider", "openai").lower()
    base_url = config.get("backend_url")
    model = config["deep_think_llm"] if which == "deep" else config["quick_think_llm"]
    api_key = _resolve_api_key(provider, config)

    # OpenAI-compatible (OpenAI, OpenRouter, DeepSeek OpenAI API, vLLM)
    if provider in {"openai", "openrouter", "openai-compatible", "vllm", "deepseek"}:
        return ChatOpenAI(model=model, base_url=base_url, api_key=api_key, **_common_kwargs(config))

    if provider == "aliyun":
        # Aliyun DashScope OpenAI-compatible endpoint
        if not base_url:
            base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
        if not api_key:
            api_key = os.getenv("DASHSCOPE_API_KEY", "")
        return ChatOpenAI(model=model, base_url=base_url, api_key=api_key, **_common_kwargs(config))

    if provider == "anthropic":
        return ChatAnthropic(model=model, base_url=base_url, api_key=api_key, **_common_kwargs(config))

    if provider == "google":
        return ChatGoogleGenerativeAI(model=model, api_key=api_key, **_common_kwargs(config))

    if provider == "ollama":
        if ChatOllama is None:
            raise ImportError("ChatOllama not installed; add langchain-ollama/langchain-community")
        return ChatOllama(model=model, base_url=base_url or "http://localhost:11434", api_key=api_key or None, **_common_kwargs(config))

    raise ValueError(f"Unsupported LLM provider: {provider}")
