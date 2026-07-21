"""Unit tests for provider-independent LLM response handling and prompting."""

import json
from types import SimpleNamespace

import pytest

import llm


SINGLE_MANIFEST = {
    "input_schema": {
        "type": "object",
        "properties": {
            "topic": {"type": "string", "title": "Topic"},
        },
        "required": ["topic"],
    },
    "ui_hints": {
        "mode": "single",
        "field_order": ["topic"],
    },
}


def completion_response(content: str):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content),
                finish_reason="stop",
            )
        ],
        usage=SimpleNamespace(prompt_tokens=100, completion_tokens=50),
    )


def clear_gateway(monkeypatch):
    monkeypatch.setattr(llm, "_router", None)
    monkeypatch.delenv("LITE_LLM_ENABLE", raising=False)
    monkeypatch.delenv("LITE_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LITE_LLM_KEY", raising=False)
    monkeypatch.delenv("LITE_LLM_MODEL_GEMINI", raising=False)
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)


def configure_vertex(monkeypatch):
    clear_gateway(monkeypatch)
    monkeypatch.setenv("MODEL", "vertex_ai/gemini-test")
    monkeypatch.setenv("VERTEXAI_PROJECT", "test-project")
    monkeypatch.setenv("VERTEXAI_LOCATION", "global")


def configure_gateway(monkeypatch):
    clear_gateway(monkeypatch)
    monkeypatch.setenv("LITE_LLM_ENABLE", "true")
    monkeypatch.setenv("LITE_LLM_BASE_URL", "https://gateway.example.test")
    monkeypatch.setenv("LITE_LLM_KEY", "test-gateway-key")
    monkeypatch.setenv("LITE_LLM_MODEL_GEMINI", "gemini-test")


def test_prompt_defines_single_and_wizard_contracts():
    assert '"mode": "single"' in llm.SYSTEM_PROMPT
    assert '"mode": "wizard"' in llm.SYSTEM_PROMPT
    assert "exactly one group" in llm.SYSTEM_PROMPT
    assert "exactly equal" in llm.SYSTEM_PROMPT
    assert 'format "data-url"' in llm.SYSTEM_PROMPT


def test_generate_schema_uses_layout_prompt_and_parses_json(monkeypatch):
    configure_vertex(monkeypatch)
    captured = {}

    def fake_completion(**kwargs):
        captured.update(kwargs)
        return completion_response(json.dumps(SINGLE_MANIFEST))

    monkeypatch.setattr(llm, "completion", fake_completion)

    result = llm.generate_schema("an agent that researches a topic")

    assert result == SINGLE_MANIFEST
    assert captured["messages"][0] == {
        "role": "system",
        "content": llm.SYSTEM_PROMPT,
    }
    assert captured["messages"][1] == {
        "role": "user",
        "content": "an agent that researches a topic",
    }
    assert captured["response_format"] == {"type": "json_object"}
    assert captured["temperature"] == 0.1
    assert captured["max_tokens"] == 8000


def test_generate_schema_routes_through_gateway_when_enabled(monkeypatch):
    configure_gateway(monkeypatch)
    captured = {}

    class FakeRouter:
        def completion(self, **kwargs):
            captured.update(kwargs)
            return completion_response(json.dumps(SINGLE_MANIFEST))

    monkeypatch.setattr(llm, "_get_router", lambda: FakeRouter())
    monkeypatch.setattr(
        llm,
        "completion",
        lambda **_: pytest.fail("direct completion must not be used"),
    )

    result = llm.generate_schema("a gateway-backed research agent")

    assert result == SINGLE_MANIFEST
    assert captured["model"] == "gemini"
    assert captured["response_format"] == {"type": "json_object"}
    assert captured["messages"][1]["content"] == "a gateway-backed research agent"


def test_gateway_router_uses_openai_compatible_configuration(monkeypatch):
    configure_gateway(monkeypatch)
    captured = {}

    class FakeRouter:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(llm, "Router", FakeRouter)

    first = llm._get_router()
    second = llm._get_router()

    assert first is second
    assert captured["model_list"] == [
        {
            "model_name": "gemini",
            "litellm_params": {
                "model": "openai/gemini-test",
                "api_base": "https://gateway.example.test",
                "api_key": "test-gateway-key",
            },
        }
    ]


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on"])
def test_gateway_truthy_values_are_supported(monkeypatch, value):
    monkeypatch.setenv("LITE_LLM_ENABLE", value)
    assert llm._gateway_enabled() is True


@pytest.mark.parametrize("value", ["", "0", "false", "FALSE", "no", "off"])
def test_gateway_falsey_values_are_supported(monkeypatch, value):
    monkeypatch.setenv("LITE_LLM_ENABLE", value)
    assert llm._gateway_enabled() is False


def test_invalid_gateway_flag_is_rejected(monkeypatch):
    monkeypatch.setenv("LITE_LLM_ENABLE", "sometimes")
    with pytest.raises(RuntimeError, match="LITE_LLM_ENABLE must be one of"):
        llm.generate_schema("test agent")


@pytest.mark.parametrize(
    "missing_setting",
    ["LITE_LLM_BASE_URL", "LITE_LLM_KEY", "LITE_LLM_MODEL_GEMINI"],
)
def test_gateway_requires_all_configuration(monkeypatch, missing_setting):
    configure_gateway(monkeypatch)
    monkeypatch.delenv(missing_setting)

    with pytest.raises(RuntimeError, match=missing_setting):
        llm.generate_schema("test agent")


def test_gateway_completion_is_traced_when_langfuse_is_configured(monkeypatch):
    configure_gateway(monkeypatch)
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "test-public-key")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "test-secret-key")
    captured = {}

    class FakeGeneration:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def update(self, **kwargs):
            captured["update"] = kwargs

    class FakeLangfuseClient:
        def start_as_current_observation(self, **kwargs):
            captured["observation"] = kwargs
            return FakeGeneration()

    class FakeRouter:
        def completion(self, **_):
            return completion_response(json.dumps(SINGLE_MANIFEST))

    monkeypatch.setattr(llm, "get_langfuse_client", lambda: FakeLangfuseClient())
    monkeypatch.setattr(llm, "_get_router", lambda: FakeRouter())

    assert llm.generate_schema("a traced agent") == SINGLE_MANIFEST
    assert captured["observation"] == {
        "name": "litellm-gateway-manifest",
        "as_type": "generation",
        "model": "gemini-test",
        "input": "a traced agent",
    }
    assert captured["update"]["output"] == json.dumps(SINGLE_MANIFEST)
    assert captured["update"]["usage_details"] == {"input": 100, "output": 50}


def test_generate_schema_accepts_json_inside_code_fences(monkeypatch):
    configure_vertex(monkeypatch)
    content = f"```json\n{json.dumps(SINGLE_MANIFEST)}\n```"
    monkeypatch.setattr(llm, "completion", lambda **_: completion_response(content))

    assert llm.generate_schema("test agent") == SINGLE_MANIFEST


def test_generate_schema_repairs_truncated_json(monkeypatch):
    configure_vertex(monkeypatch)
    truncated = json.dumps(SINGLE_MANIFEST)[:-1]
    monkeypatch.setattr(llm, "completion", lambda **_: completion_response(truncated))

    assert llm.generate_schema("test agent") == SINGLE_MANIFEST


def test_generate_schema_rejects_non_json_response(monkeypatch):
    configure_vertex(monkeypatch)
    monkeypatch.setattr(
        llm,
        "completion",
        lambda **_: completion_response("Here is the form you requested."),
    )

    with pytest.raises(ValueError, match="not valid JSON"):
        llm.generate_schema("test agent")


def test_generate_schema_rejects_json_array(monkeypatch):
    configure_vertex(monkeypatch)
    monkeypatch.setattr(llm, "completion", lambda **_: completion_response("[]"))

    with pytest.raises(ValueError, match="expected an object"):
        llm.generate_schema("test agent")


def test_direct_gemini_route_requires_api_key(monkeypatch):
    clear_gateway(monkeypatch)
    monkeypatch.setenv("MODEL", "gemini/gemini-test")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        llm.generate_schema("test agent")
