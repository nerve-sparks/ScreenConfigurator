"""Description -> manifest: the LLM call, in isolation.

Turns a plain-text agent description into a manifest of the form:

    {
        "input_schema": {...},
        "ui_hints": {"mode": "single" | "wizard", "field_order": [...]},
    }

No UI, no web route -- just the core transformation (Step 2).
"""

import json
import logging
import os
import re
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import json_repair
from dotenv import load_dotenv
from litellm import Router, completion

try:
    from langfuse import get_client as get_langfuse_client
except ImportError:  # pragma: no cover - dependency guard for partial installs
    get_langfuse_client = None

# Load backend/.env regardless of the current working directory.
load_dotenv(Path(__file__).resolve().parent / ".env")

logger = logging.getLogger(__name__)

_GATEWAY_ALIAS = "gemini"
_MAX_TOKENS = 8000
_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off", ""}
PROMPT_VERSION = "1"

_router: Router | None = None

SYSTEM_PROMPT = """\
You convert a plain-text description of an AI agent into the specification
of an input form for that agent.

From the description, decide which inputs must be collected from the user,
then return exactly one JSON object. For a single-screen form, use this shape:

{"input_schema": { ... }, "ui_hints": {"mode": "single", "field_order": [ ... ]}}

For a multi-screen wizard, use this shape:

{"input_schema": { ... }, "ui_hints": {"mode": "wizard", "field_order": [ ... ], "groups": [{"id": "group-id", "title": "Group title", "description": "What this step collects", "fields": [ ... ]}]}}

Rules:
- "input_schema" must be a valid JSON Schema (draft 2020-12) with
  "type": "object", a "properties" map, and a "required" array. It describes
  ONLY the inputs to collect from the user -- never the agent's outputs,
  results, or internal logic.
- Every property must have a "type" and a short human-friendly "title".
  Add "format" where it applies (e.g. "email", "uri", "date").
  Use the string format "data-url" when the user must upload a file.
- List a field in "required" only if the agent cannot work without it.
- "ui_hints.field_order" must contain every key of "properties" exactly
  once, in a sensible display order.
- Choose "single" for a short, coherent form with six or fewer simple fields.
- Choose "wizard" when there are more than six fields OR when the inputs form
  two or more clearly distinct sections and separating them would materially
  improve comprehension. Do not create a wizard merely for visual effect.
- A wizard must have between two and five meaningful groups. Aim for three to
  five fields per group, but use fewer when a natural section is small.
- Every wizard group needs a stable lowercase kebab-case "id", a concise
  "title", a one-sentence "description", and a non-empty "fields" array.
- In wizard mode, every property must occur in exactly one group. Concatenating
  the groups' "fields" arrays must exactly equal "ui_hints.field_order".
- In single mode, omit "groups".
- Return strict JSON only: no prose, no explanations, no markdown fences.
"""


def _strip_code_fences(text: str) -> str:
    """Remove accidental markdown code fences (```...```) around model output."""
    cleaned = text.strip()
    fenced = re.match(r"^```[a-zA-Z0-9_-]*\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fenced:
        return fenced.group(1)
    return cleaned


def _gateway_enabled() -> bool:
    """Read LITE_LLM_ENABLE without treating values like "false" as truthy."""
    value = os.getenv("LITE_LLM_ENABLE", "").strip().lower()
    if value in _TRUE_VALUES:
        return True
    if value in _FALSE_VALUES:
        return False
    raise RuntimeError(
        "LITE_LLM_ENABLE must be one of: true, false, 1, 0, yes, no, on, off."
    )


def _required_gateway_setting(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(
            f"{name} is required when LITE_LLM_ENABLE is enabled. "
            "Add it to backend/.env."
        )
    return value


def _gateway_model() -> str:
    return _required_gateway_setting("LITE_LLM_MODEL_GEMINI")


def _openai_compatible_model(model: str) -> str:
    """LiteLLM gateways in this project use the OpenAI-compatible wire format."""
    return model if model.startswith("openai/") else f"openai/{model}"


def _get_router() -> Router:
    """Build the shared organization-gateway router once and reuse it."""
    global _router
    if _router is None:
        _router = Router(
            model_list=[
                {
                    "model_name": _GATEWAY_ALIAS,
                    "litellm_params": {
                        "model": _openai_compatible_model(_gateway_model()),
                        "api_base": _required_gateway_setting("LITE_LLM_BASE_URL"),
                        "api_key": _required_gateway_setting("LITE_LLM_KEY"),
                    },
                }
            ]
        )
    return _router


def _direct_model() -> str:
    """Return and validate the existing direct LiteLLM provider configuration."""
    model = os.getenv("MODEL", "").strip()
    if not model:
        raise RuntimeError(
            "MODEL is not set. Add it to backend/.env, "
            "e.g. MODEL=vertex_ai/gemini-3.5-flash"
        )
    if model.startswith("gemini/") and not os.getenv("GEMINI_API_KEY"):
        raise RuntimeError("GEMINI_API_KEY is not set. Add it to backend/.env.")
    if model.startswith("vertex_ai/"):
        if not (os.getenv("VERTEXAI_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT")):
            raise RuntimeError(
                "VERTEXAI_PROJECT is not set. Add your Google Cloud project ID "
                "to backend/.env."
            )
        if not (
            os.getenv("VERTEXAI_LOCATION") or os.getenv("GOOGLE_CLOUD_LOCATION")
        ):
            raise RuntimeError(
                "VERTEXAI_LOCATION is not set. Add it to backend/.env, "
                "e.g. VERTEXAI_LOCATION=global."
            )
    return model


def _langfuse_configured() -> bool:
    """Tracing is optional locally and activates when both Langfuse keys exist."""
    return bool(
        os.getenv("LANGFUSE_PUBLIC_KEY", "").strip()
        and os.getenv("LANGFUSE_SECRET_KEY", "").strip()
    )


@contextmanager
def _generation_observation(
    *, name: str, model: str, user_prompt: str
) -> Iterator[object | None]:
    """Create a generation-level Langfuse observation when configured."""
    if not _langfuse_configured():
        yield None
        return
    if get_langfuse_client is None:
        raise RuntimeError(
            "Langfuse credentials are configured but the langfuse package is not "
            "installed. Install backend/requirements.txt."
        )

    real_model = model.removeprefix("openai/").rsplit("/", 1)[-1]
    with get_langfuse_client().start_as_current_observation(
        name=name,
        as_type="generation",
        model=real_model,
        input=user_prompt,
    ) as generation:
        yield generation


def _update_observation(generation: object | None, response, raw: str) -> None:
    if generation is None:
        return
    usage = getattr(response, "usage", None)
    usage_details = None
    if usage is not None:
        usage_details = {
            "input": getattr(usage, "prompt_tokens", None) or 0,
            "output": getattr(usage, "completion_tokens", None) or 0,
        }
    try:
        generation.update(output=raw, usage_details=usage_details)
    except Exception as exc:  # Observability must not break screen generation.
        logger.warning("Could not update Langfuse generation: %s", exc)


def _loads_llm_json(raw: str):
    """Parse strict JSON first, then repair common truncated model output."""
    cleaned = _strip_code_fences(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as strict_error:
        try:
            repaired = json_repair.loads(cleaned)
        except Exception as repair_error:
            raise ValueError(
                f"LLM response is not valid JSON ({strict_error}).\n"
                f"--- raw response ---\n{raw}"
            ) from repair_error
        if not isinstance(repaired, (dict, list)):
            raise ValueError(
                f"LLM response is not valid JSON ({strict_error}).\n"
                f"--- raw response ---\n{raw}"
            ) from strict_error
        logger.warning("Repaired malformed JSON returned by the LLM: %s", strict_error)
        return repaired


def _completion_response(description: str):
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": description},
    ]
    common = {
        "messages": messages,
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
        "max_tokens": _MAX_TOKENS,
    }

    if _gateway_enabled():
        model = _gateway_model()
        with _generation_observation(
            name="litellm-gateway-manifest",
            model=model,
            user_prompt=description,
        ) as generation:
            response = _get_router().completion(model=_GATEWAY_ALIAS, **common)
            raw = response.choices[0].message.content or "{}"
            _update_observation(generation, response, raw)
        route = "organization gateway"
    else:
        model = _direct_model()
        with _generation_observation(
            name="litellm-direct-manifest",
            model=model,
            user_prompt=description,
        ) as generation:
            response = completion(model=model, **common)
            raw = response.choices[0].message.content or "{}"
            _update_observation(generation, response, raw)
        route = "direct provider"

    finish_reason = getattr(response.choices[0], "finish_reason", None)
    if finish_reason == "length":
        logger.warning(
            "LiteLLM %s response reached the %s-token limit; attempting JSON repair",
            route,
            _MAX_TOKENS,
        )
    usage = getattr(response, "usage", None)
    if usage is not None:
        logger.info(
            "LiteLLM %s output tokens used: %s/%s",
            route,
            getattr(usage, "completion_tokens", None),
            _MAX_TOKENS,
        )
    return raw


def generate_schema(description: str) -> dict:
    """Turn a plain-text agent description into a manifest dict.

    Raises:
        RuntimeError: if required configuration is missing.
        ValueError: if the LLM response cannot be parsed as a JSON object.
    """
    try:
        raw = _completion_response(description)
    except RuntimeError:
        raise
    except Exception as exc:
        route = "gateway" if _gateway_enabled() else "direct provider"
        raise RuntimeError(f"LiteLLM {route} call failed: {exc}") from exc

    manifest = _loads_llm_json(raw)

    if not isinstance(manifest, dict):
        raise ValueError(
            f"LLM returned a JSON {type(manifest).__name__}, expected an object.\n"
            f"--- raw response ---\n{raw}"
        )
    return manifest


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print('Usage: python llm.py "<agent description>"', file=sys.stderr)
        sys.exit(1)
    result = generate_schema(" ".join(sys.argv[1:]))
    print(json.dumps(result, indent=2))
