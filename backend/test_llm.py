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
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )


def configure_vertex(monkeypatch):
    monkeypatch.setenv("MODEL", "vertex_ai/gemini-test")
    monkeypatch.setenv("VERTEXAI_PROJECT", "test-project")
    monkeypatch.setenv("VERTEXAI_LOCATION", "global")


def test_prompt_defines_single_and_wizard_contracts():
    assert '"mode": "single"' in llm.SYSTEM_PROMPT
    assert '"mode": "wizard"' in llm.SYSTEM_PROMPT
    assert "exactly one group" in llm.SYSTEM_PROMPT
    assert "exactly equal" in llm.SYSTEM_PROMPT


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


def test_generate_schema_accepts_json_inside_code_fences(monkeypatch):
    configure_vertex(monkeypatch)
    content = f"```json\n{json.dumps(SINGLE_MANIFEST)}\n```"
    monkeypatch.setattr(llm, "completion", lambda **_: completion_response(content))

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
    monkeypatch.setenv("MODEL", "gemini/gemini-test")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        llm.generate_schema("test agent")
