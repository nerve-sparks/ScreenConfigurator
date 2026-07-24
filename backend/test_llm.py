"""Unit tests for provider-independent LLM response handling and prompting."""

import json
import os
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
        "blocks": [
            {
                "id": "research-heading",
                "type": "heading",
                "text": "Research request",
                "level": 2,
            },
            {"id": "field-topic", "type": "field", "field": "topic"},
        ],
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
    monkeypatch.delenv("LITE_LLM_PROVIDER", raising=False)
    monkeypatch.delenv("LITE_LLM_MODEL_GEMINI", raising=False)
    monkeypatch.delenv("LITE_LLM_MODEL_OPENAI", raising=False)
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    monkeypatch.delenv("LLM_GENERATION_TIMEOUT_SECONDS", raising=False)


def configure_vertex(monkeypatch):
    clear_gateway(monkeypatch)
    monkeypatch.setenv("MODEL", "vertex_ai/gemini-test")
    monkeypatch.setenv("VERTEXAI_PROJECT", "test-project")
    monkeypatch.setenv("VERTEXAI_LOCATION", "global")
    monkeypatch.setattr(llm, "supports_response_schema", lambda **_: False)


def configure_gateway(monkeypatch):
    clear_gateway(monkeypatch)
    monkeypatch.setenv("LITE_LLM_ENABLE", "true")
    monkeypatch.setenv("LITE_LLM_BASE_URL", "https://gateway.example.test")
    monkeypatch.setenv("LITE_LLM_KEY", "test-gateway-key")
    monkeypatch.setenv("LITE_LLM_MODEL_GEMINI", "gemini-test")
    monkeypatch.setattr(llm, "supports_response_schema", lambda **_: False)


def configure_openai_gateway(monkeypatch):
    configure_gateway(monkeypatch)
    monkeypatch.setenv("LITE_LLM_PROVIDER", "openai")
    monkeypatch.setenv("LITE_LLM_MODEL_OPENAI", "gpt-5.5")
    monkeypatch.setattr(llm, "supports_response_schema", lambda **_: True)


def test_prompt_defines_single_and_wizard_contracts():
    assert '"mode": "single"' in llm.SYSTEM_PROMPT
    assert '"mode": "wizard"' in llm.SYSTEM_PROMPT
    assert "exactly one group" in llm.SYSTEM_PROMPT
    assert "exactly equal" in llm.SYSTEM_PROMPT
    assert 'format "data-url"' in llm.SYSTEM_PROMPT
    assert "no more than 30 input fields" in llm.SYSTEM_PROMPT
    assert "Never emit $ref" in llm.SYSTEM_PROMPT
    assert "Never invent" in llm.SYSTEM_PROMPT
    assert "permissions" in llm.SYSTEM_PROMPT
    assert '"type":"section"' in llm.SYSTEM_PROMPT
    assert "Every input property must appear in exactly one field block" in llm.SYSTEM_PROMPT
    assert "put each step's blocks in that group's" in llm.SYSTEM_PROMPT


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
    assert captured["timeout"] == 45.0


def test_generate_schema_uses_json_schema_when_non_gemini_model_supports_it(
    monkeypatch,
):
    configure_vertex(monkeypatch)
    monkeypatch.setenv("MODEL", "openai/gpt-test")
    monkeypatch.setattr(llm, "supports_response_schema", lambda **_: True)
    captured = {}

    def fake_completion(**kwargs):
        captured.update(kwargs)
        return completion_response(json.dumps(SINGLE_MANIFEST))

    monkeypatch.setattr(llm, "completion", fake_completion)

    assert llm.generate_schema("a structured research agent") == SINGLE_MANIFEST
    assert captured["response_format"] == {
        "type": "json_schema",
        "json_schema": {
            "name": "agent_screen_manifest",
            "strict": True,
            "schema": llm.META_SCHEMA,
        },
    }


@pytest.mark.parametrize(
    "model",
    [
        "gemini/gemini-3.5-flash",
        "vertex_ai/gemini-3.5-flash",
        "openai/gemini-proxy",
        "gemini-test",
    ],
)
def test_gemini_always_uses_json_object_mode(monkeypatch, caplog, model):
    monkeypatch.setattr(
        llm,
        "supports_response_schema",
        lambda **_: pytest.fail(
            "Gemini must bypass the provider's incomplete schema capability check"
        ),
    )

    with caplog.at_level("INFO"):
        response_format = llm._response_format_for_model(model)

    assert response_format == {"type": "json_object"}
    assert "backend manifest validation remains authoritative" in caplog.text


def test_generate_schema_uses_configured_timeout(monkeypatch):
    configure_vertex(monkeypatch)
    monkeypatch.setenv("LLM_GENERATION_TIMEOUT_SECONDS", "12.5")
    captured = {}

    def fake_completion(**kwargs):
        captured.update(kwargs)
        return completion_response(json.dumps(SINGLE_MANIFEST))

    monkeypatch.setattr(llm, "completion", fake_completion)

    llm.generate_schema("a time-bounded agent")
    assert captured["timeout"] == 12.5


@pytest.mark.parametrize("value", ["zero", "0", "121", "nan", "inf"])
def test_invalid_generation_timeout_is_rejected(monkeypatch, value):
    configure_vertex(monkeypatch)
    monkeypatch.setenv("LLM_GENERATION_TIMEOUT_SECONDS", value)
    monkeypatch.setattr(
        llm,
        "completion",
        lambda **_: pytest.fail("provider must not be called"),
    )

    with pytest.raises(llm.LLMConfigurationError, match="between 1 and 120"):
        llm.generate_schema("test agent")


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
    assert captured["model"] == "manifest-generator"
    assert captured["response_format"] == {"type": "json_object"}
    assert captured["messages"][1]["content"] == "a gateway-backed research agent"


def test_gpt_5_5_gateway_uses_application_validated_json(monkeypatch):
    configure_openai_gateway(monkeypatch)
    monkeypatch.setattr(
        llm,
        "supports_response_schema",
        lambda **_: pytest.fail(
            "GPT-5.5 must bypass its incomplete full-schema capability"
        ),
    )
    captured = {}

    class FakeRouter:
        def completion(self, **kwargs):
            captured.update(kwargs)
            return completion_response(json.dumps(SINGLE_MANIFEST))

    monkeypatch.setattr(llm, "_get_router", lambda: FakeRouter())

    assert llm.generate_schema("an OpenAI-backed agent") == SINGLE_MANIFEST
    assert captured["model"] == "manifest-generator"
    assert captured["response_format"] == {"type": "json_object"}
    assert "temperature" not in captured


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
            "model_name": "manifest-generator",
            "litellm_params": {
                "model": "openai/gemini-test",
                "api_base": "https://gateway.example.test",
                "api_key": "test-gateway-key",
            },
        }
    ]


def test_openai_gateway_router_uses_only_the_openai_model(monkeypatch):
    configure_openai_gateway(monkeypatch)
    captured = {}

    class FakeRouter:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(llm, "Router", FakeRouter)

    llm._get_router()

    assert captured["model_list"] == [
        {
            "model_name": "manifest-generator",
            "litellm_params": {
                "model": "openai/gpt-5.5",
                "api_base": "https://gateway.example.test",
                "api_key": "test-gateway-key",
            },
        }
    ]
    assert "gemini-test" not in str(captured["model_list"])


@pytest.mark.parametrize(
    ("provider", "expected_model"),
    [
        ("gemini", "gemini-test"),
        ("openai", "gpt-5.5"),
    ],
)
def test_gateway_provider_selects_only_its_model(monkeypatch, provider, expected_model):
    configure_gateway(monkeypatch)
    monkeypatch.setenv("LITE_LLM_PROVIDER", provider)
    monkeypatch.setenv("LITE_LLM_MODEL_OPENAI", "gpt-5.5")

    target = llm.gateway_generation_target()

    assert target == {
        "route": "litellm_gateway",
        "provider": provider,
        "model": expected_model,
    }


def test_gateway_provider_defaults_to_gemini(monkeypatch):
    configure_gateway(monkeypatch)
    monkeypatch.delenv("LITE_LLM_PROVIDER", raising=False)
    monkeypatch.setenv("LITE_LLM_MODEL_OPENAI", "gpt-5.5")

    assert llm.gateway_generation_target()["provider"] == "gemini"
    assert llm.gateway_generation_target()["model"] == "gemini-test"


def test_invalid_gateway_provider_is_rejected_before_calling_model(monkeypatch):
    configure_gateway(monkeypatch)
    monkeypatch.setenv("LITE_LLM_PROVIDER", "automatic")
    monkeypatch.setattr(
        llm,
        "completion",
        lambda **_: pytest.fail("provider must not be called"),
    )

    with pytest.raises(llm.LLMConfigurationError, match="LITE_LLM_PROVIDER"):
        llm.generate_schema("test agent")


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


def test_openai_gateway_requires_its_selected_model(monkeypatch):
    configure_openai_gateway(monkeypatch)
    monkeypatch.delenv("LITE_LLM_MODEL_OPENAI")

    with pytest.raises(llm.LLMConfigurationError, match="LITE_LLM_MODEL_OPENAI"):
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
        "metadata": {"prompt_version": "3", "attempt": 1},
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


def test_generate_schema_retries_invalid_manifest_once(monkeypatch):
    configure_vertex(monkeypatch)
    invalid = {
        **SINGLE_MANIFEST,
        "ui_hints": {"mode": "single", "field_order": ["missing"]},
    }
    responses = iter([invalid, SINGLE_MANIFEST])
    calls = []

    def fake_completion(**kwargs):
        calls.append(kwargs)
        return completion_response(json.dumps(next(responses)))

    monkeypatch.setattr(llm, "completion", fake_completion)

    assert llm.generate_schema("test agent") == SINGLE_MANIFEST
    assert len(calls) == 2
    assert len(calls[1]["messages"]) == 4
    assert "failed the application's manifest validation" in calls[1]["messages"][-1][
        "content"
    ]
    assert "missing" in calls[1]["messages"][-1]["content"]


def test_generate_schema_retries_malformed_json_once(monkeypatch):
    configure_vertex(monkeypatch)
    responses = iter(["not json", json.dumps(SINGLE_MANIFEST)])
    calls = []

    def fake_completion(**kwargs):
        calls.append(kwargs)
        return completion_response(next(responses))

    monkeypatch.setattr(llm, "completion", fake_completion)

    assert llm.generate_schema("test agent") == SINGLE_MANIFEST
    assert len(calls) == 2
    assert "not valid JSON" in calls[1]["messages"][-1]["content"]


def test_generate_schema_stops_after_one_correction_attempt(monkeypatch):
    configure_vertex(monkeypatch)
    calls = []

    def fake_completion(**kwargs):
        calls.append(kwargs)
        return completion_response("[]")

    monkeypatch.setattr(llm, "completion", fake_completion)

    with pytest.raises(llm.LLMOutputError, match="one correction attempt"):
        llm.generate_schema("test agent")
    assert len(calls) == 2


def test_generate_schema_does_not_retry_provider_failure_or_expose_secret(
    monkeypatch,
):
    configure_vertex(monkeypatch)
    calls = []

    def fake_completion(**kwargs):
        calls.append(kwargs)
        raise ConnectionError("provider failed with api_key=super-secret")

    monkeypatch.setattr(llm, "completion", fake_completion)

    with pytest.raises(llm.LLMProviderError) as raised:
        llm.generate_schema("test agent")
    assert "super-secret" not in str(raised.value)
    assert len(calls) == 1


def test_generate_schema_reports_timeout_without_retry(monkeypatch):
    configure_vertex(monkeypatch)
    calls = []

    def fake_completion(**kwargs):
        calls.append(kwargs)
        raise TimeoutError("provider timeout details")

    monkeypatch.setattr(llm, "completion", fake_completion)

    with pytest.raises(llm.LLMTimeoutError, match="timed out"):
        llm.generate_schema("test agent")
    assert len(calls) == 1


def test_direct_gemini_route_requires_api_key(monkeypatch):
    clear_gateway(monkeypatch)
    monkeypatch.setenv("MODEL", "gemini/gemini-test")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        llm.generate_schema("test agent")


@pytest.mark.skipif(
    os.getenv("RUN_VERTEX_AI_SMOKE_TEST", "").strip().lower() not in llm._TRUE_VALUES,
    reason="Set RUN_VERTEX_AI_SMOKE_TEST=true to call the real Vertex AI model.",
)
def test_optional_real_vertex_ai_smoke(monkeypatch):
    """Opt-in local integration test; normal CI always uses provider mocks."""
    clear_gateway(monkeypatch)
    monkeypatch.setenv("LITE_LLM_ENABLE", "false")
    monkeypatch.setenv(
        "MODEL",
        os.getenv("VERTEX_SMOKE_MODEL", "vertex_ai/gemini-3.5-flash"),
    )

    manifest = llm.generate_schema(
        "A research agent that needs a required topic and an optional source URL."
    )
    valid, errors = llm.validate_manifest(manifest)
    assert valid, errors
