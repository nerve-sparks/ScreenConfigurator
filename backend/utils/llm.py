"""Description -> manifest: the LLM call, in isolation.

Turns a plain-text agent description into a manifest of the form:

    {
        "input_schema": {...},
        "ui_hints": {
            "mode": "single" | "wizard",
            "field_order": [...],
            "blocks": [...],
        },
    }

No UI, no web route -- just the core transformation (Step 2).
"""

import json
import logging
import math
import os
import re
import sys
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from typing import Iterator

import json_repair
from dotenv import load_dotenv
from litellm import Router, Timeout as LiteLLMTimeout, completion
from litellm import supports_response_schema

from .content_manifest import CONTENT_META_SCHEMA, validate_content_manifest
from .meta_schema import MAX_INPUT_FIELDS, META_SCHEMA
from .validation import validate_manifest

try:
    from langfuse import get_client as get_langfuse_client
except ImportError:  # pragma: no cover - dependency guard for partial installs
    get_langfuse_client = None

# Load backend/.env regardless of the current working directory.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logger = logging.getLogger(__name__)

_GATEWAY_ALIAS = "manifest-generator"
_GATEWAY_MODEL_SETTINGS = {
    "gemini": "LITE_LLM_MODEL_GEMINI",
    "openai": "LITE_LLM_MODEL_OPENAI",
}
_MAX_TOKENS = 8000
_DEFAULT_TIMEOUT_SECONDS = 45.0
_MIN_TIMEOUT_SECONDS = 1.0
_MAX_TIMEOUT_SECONDS = 120.0
_MAX_GENERATION_ATTEMPTS = 2
_MAX_RETRY_OUTPUT_CHARS = 12_000
_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off", ""}
PROMPT_VERSION = "3"
SCREEN_PLAN_PROMPT_VERSION = "1"
CONTENT_PROMPT_VERSION = "1"

_router: Router | None = None


class LLMConfigurationError(RuntimeError):
    """The application cannot call its configured LLM route."""


class LLMProviderError(RuntimeError):
    """The provider request failed without exposing provider internals."""


class LLMTimeoutError(LLMProviderError):
    """The provider did not finish within the configured deadline."""


class LLMOutputError(ValueError):
    """The provider returned an invalid manifest twice."""

SYSTEM_PROMPT = """\
You convert a plain-text description of an AI agent into the specification
of an input form for that agent.

From the description, decide which inputs must be collected from the user,
then design a clear, safe layout and return exactly one JSON object. For a
single-screen form, use this shape:

{"input_schema": { ... }, "ui_hints": {"mode": "single", "field_order": [ ... ], "blocks": [ ... ]}}

For a multi-screen wizard, use this shape:

{"input_schema": { ... }, "ui_hints": {"mode": "wizard", "field_order": [ ... ], "groups": [{"id": "group-id", "title": "Group title", "description": "What this step collects", "fields": [ ... ], "blocks": [ ... ]}]}}

Rules:
- "input_schema" must be a valid JSON Schema (draft 2020-12) with
  "type": "object", a "properties" map, and a "required" array. It describes
  ONLY the inputs to collect from the user -- never the agent's outputs,
  results, or internal logic.
- Every property must have a "type" and a short human-friendly "title".
  Use only the field types "string", "number", "integer", and "boolean".
  Add only a supported string format when it applies: "email", "uri", "date",
  "date-time", "time", or "data-url".
  Use the string format "data-url" when the user must upload a file.
- Generate no more than {max_fields} input fields. Prefer the smallest set the
  agent genuinely needs.
- Field definitions may use only: type, title, description, format, enum,
  minLength, maxLength, minimum, maximum, multipleOf, and contentMediaType.
- Never emit $ref, $dynamicRef, $recursiveRef, remote schemas, custom widgets,
  uiSchema, HTML, scripts, event handlers, or javascript: URLs.
- Return only "input_schema" and "ui_hints" at the top level. Never invent
  agent IDs, screen IDs, database IDs, owners, roles, permissions, or access
  controls; the application owns all identity and authorization decisions.
- List a field in "required" only if the agent cannot work without it.
- "ui_hints.field_order" must contain every key of "properties" exactly
  once, in a sensible display order.
- Build the visual experience only from these safe block objects:
  * {"id":"unique-id","type":"field","field":"property_name"}
  * {"id":"unique-id","type":"heading","text":"Helpful heading","level":2}
  * {"id":"unique-id","type":"paragraph","text":"Helpful plain text"}
  * {"id":"unique-id","type":"divider"}
  * {"id":"unique-id","type":"callout","text":"Important plain text","tone":"information"}
  * {"id":"unique-id","type":"section","title":"Section title","description":"Optional explanation","children":[ ...non-section blocks... ]}
- Block IDs must be unique lowercase kebab-case identifiers no longer than 64
  characters. Heading levels may be only 2, 3, or 4. Callout tone may be only
  "information", "success", or "warning".
- Every input property must appear in exactly one field block. Field blocks
  must appear in the same visual order as "ui_hints.field_order".
- Use headings, paragraphs, sections, dividers, and callouts only when they
  materially improve comprehension. Keep copy concise. Do not emit empty
  decorative sections or put a section inside another section.
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
- In wizard mode, put each step's blocks in that group's "blocks" array and
  omit top-level "ui_hints.blocks". Each group's field-block order must exactly
  equal its "fields" array.
- In single mode, put all blocks in "ui_hints.blocks" and omit "groups".
- Return strict JSON only: no prose, no explanations, no markdown fences.
""".replace("{max_fields}", str(MAX_INPUT_FIELDS))


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
    raise LLMConfigurationError(
        "LITE_LLM_ENABLE must be one of: true, false, 1, 0, yes, no, on, off."
    )


def _required_gateway_setting(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise LLMConfigurationError(
            f"{name} is required when LITE_LLM_ENABLE is enabled. "
            "Add it to backend/.env."
        )
    return value


def _gateway_provider() -> str:
    """Return the application-wide gateway provider selected by the operator."""
    provider = os.getenv("LITE_LLM_PROVIDER", "gemini").strip().lower() or "gemini"
    if provider not in _GATEWAY_MODEL_SETTINGS:
        supported = ", ".join(sorted(_GATEWAY_MODEL_SETTINGS))
        raise LLMConfigurationError(
            f"LITE_LLM_PROVIDER must be one of: {supported}."
        )
    return provider


def _gateway_model() -> str:
    """Resolve the selected provider to its configured gateway model name."""
    return _required_gateway_setting(_GATEWAY_MODEL_SETTINGS[_gateway_provider()])


def gateway_generation_target() -> dict[str, str]:
    """Return safe gateway provenance without credentials or connection details."""
    return {
        "route": "litellm_gateway",
        "provider": _gateway_provider(),
        "model": _gateway_model(),
    }


def _openai_compatible_model(model: str) -> str:
    """LiteLLM gateways in this project use the OpenAI-compatible wire format."""
    return model if model.startswith("openai/") else f"openai/{model}"


def _get_router() -> Router:
    """Build the shared organization-gateway router once and reuse it."""
    global _router
    if _router is None:
        target = gateway_generation_target()
        logger.info(
            "Configuring LiteLLM gateway provider=%s model=%s",
            target["provider"],
            target["model"],
        )
        _router = Router(
            model_list=[
                {
                    "model_name": _GATEWAY_ALIAS,
                    "litellm_params": {
                        "model": _openai_compatible_model(target["model"]),
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
        raise LLMConfigurationError(
            "MODEL is not set. Add it to backend/.env, "
            "e.g. MODEL=vertex_ai/gemini-3.5-flash"
        )
    if model.startswith("gemini/") and not os.getenv("GEMINI_API_KEY"):
        raise LLMConfigurationError(
            "GEMINI_API_KEY is not set. Add it to backend/.env."
        )
    if model.startswith("vertex_ai/"):
        if not (os.getenv("VERTEXAI_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT")):
            raise LLMConfigurationError(
                "VERTEXAI_PROJECT is not set. Add your Google Cloud project ID "
                "to backend/.env."
            )
        if not (
            os.getenv("VERTEXAI_LOCATION") or os.getenv("GOOGLE_CLOUD_LOCATION")
        ):
            raise LLMConfigurationError(
                "VERTEXAI_LOCATION is not set. Add it to backend/.env, "
                "e.g. VERTEXAI_LOCATION=global."
            )
    return model


def _generation_timeout() -> float:
    """Return a bounded provider timeout configured in seconds."""
    raw = os.getenv(
        "LLM_GENERATION_TIMEOUT_SECONDS", str(_DEFAULT_TIMEOUT_SECONDS)
    ).strip()
    try:
        timeout = float(raw)
    except ValueError as exc:
        raise LLMConfigurationError(
            "LLM_GENERATION_TIMEOUT_SECONDS must be a number between "
            f"{_MIN_TIMEOUT_SECONDS:g} and {_MAX_TIMEOUT_SECONDS:g}."
        ) from exc
    if not math.isfinite(timeout) or not (
        _MIN_TIMEOUT_SECONDS <= timeout <= _MAX_TIMEOUT_SECONDS
    ):
        raise LLMConfigurationError(
            "LLM_GENERATION_TIMEOUT_SECONDS must be a number between "
            f"{_MIN_TIMEOUT_SECONDS:g} and {_MAX_TIMEOUT_SECONDS:g}."
        )
    return timeout


def _langfuse_configured() -> bool:
    """Tracing is optional locally and activates when both Langfuse keys exist."""
    return bool(
        os.getenv("LANGFUSE_PUBLIC_KEY", "").strip()
        and os.getenv("LANGFUSE_SECRET_KEY", "").strip()
    )


@contextmanager
def _generation_observation(
    *, name: str, model: str, user_prompt: str, attempt: int
) -> Iterator[object | None]:
    """Create a generation-level Langfuse observation when configured."""
    if not _langfuse_configured():
        yield None
        return
    if get_langfuse_client is None:
        raise LLMConfigurationError(
            "Langfuse credentials are configured but the langfuse package is not "
            "installed. Install backend/requirements.txt."
        )

    real_model = model.removeprefix("openai/").rsplit("/", 1)[-1]
    with get_langfuse_client().start_as_current_observation(
        name=name,
        as_type="generation",
        model=real_model,
        input=user_prompt,
        metadata={
            "prompt_version": PROMPT_VERSION,
            "attempt": attempt,
        },
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
            raise ValueError("LLM response is not valid JSON.") from repair_error
        if not isinstance(repaired, (dict, list)):
            raise ValueError("LLM response is not valid JSON.") from strict_error
        logger.warning("Repaired malformed JSON returned by the LLM: %s", strict_error)
        return repaired


def _is_gemini_model(model: str) -> bool:
    """Return whether a LiteLLM model identifier belongs to Gemini."""
    return "gemini" in model.strip().lower()


def _requires_application_validated_json(model: str) -> bool:
    """Return models that reject rules in the complete manifest meta-schema."""
    normalized = model.strip().lower()
    if _is_gemini_model(normalized):
        return True
    if normalized.startswith("openai/"):
        normalized = normalized.removeprefix("openai/")
    return normalized == "gpt-5.5"


def _response_format_for_model(
    model: str,
    schema: dict = META_SCHEMA,
    schema_name: str = "agent_screen_manifest",
) -> dict:
    """Choose a provider-compatible JSON response mode.

    Some providers support JSON output but reject parts of the application's
    full draft-2020-12 meta-schema. The backend remains the authoritative
    schema and safety validation gate.
    """
    if _requires_application_validated_json(model):
        logger.info(
            "Using JSON-object response mode for model %s; "
            "backend manifest validation remains authoritative.",
            model,
        )
        return {"type": "json_object"}

    try:
        schema_supported = supports_response_schema(model=model)
    except Exception:  # Defensive: capability detection must not block fallback.
        schema_supported = False
        logger.warning(
            "Could not detect response-schema support for model %s; using JSON mode.",
            model,
        )
    if not schema_supported:
        logger.info(
            "Using JSON-object response mode for model %s; "
            "response-schema support is unavailable.",
            model,
        )
        return {"type": "json_object"}
    logger.info("Using strict JSON-schema response mode for model %s.", model)
    return {
        "type": "json_schema",
        "json_schema": {
            "name": schema_name,
            "strict": True,
            "schema": deepcopy(schema),
        },
    }


def _initial_messages(description: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": description},
    ]


def _retry_messages(
    messages: list[dict[str, str]], raw: str, errors: list[str]
) -> list[dict[str, str]]:
    """Ask for one corrected object, grounded in backend validation errors."""
    previous_output = raw[:_MAX_RETRY_OUTPUT_CHARS]
    validation_feedback = json.dumps(errors[:20], ensure_ascii=True)
    return [
        *messages,
        {"role": "assistant", "content": previous_output},
        {
            "role": "user",
            "content": (
                "Your previous response failed the application's manifest "
                f"validation: {validation_feedback}. Return one corrected JSON "
                "object only. Follow the original contract and do not add any "
                "identifiers, permissions, widgets, HTML, or scripts."
            ),
        },
    ]


def _completion_response(
    description: str,
    messages: list[dict[str, str]],
    attempt: int,
    *,
    response_schema: dict = META_SCHEMA,
    schema_name: str = "agent_screen_manifest",
    observation_name: str = "manifest",
):
    gateway_enabled = _gateway_enabled()
    if gateway_enabled:
        target = gateway_generation_target()
        model = target["model"]
        logger.info(
            "Generating manifest through provider=%s model=%s",
            target["provider"],
            model,
        )
    else:
        model = _direct_model()
    common = {
        "messages": messages,
        "response_format": _response_format_for_model(
            model, response_schema, schema_name
        ),
        "max_tokens": _MAX_TOKENS,
        "timeout": _generation_timeout(),
    }
    if not (gateway_enabled and target["provider"] == "openai"):
        common["temperature"] = 0.1

    if gateway_enabled:
        with _generation_observation(
            name=f"litellm-gateway-{observation_name}",
            model=model,
            user_prompt=description,
            attempt=attempt,
        ) as generation:
            response = _get_router().completion(model=_GATEWAY_ALIAS, **common)
            raw = response.choices[0].message.content or "{}"
            _update_observation(generation, response, raw)
        route = "organization gateway"
    else:
        model = _direct_model()
        with _generation_observation(
            name=f"litellm-direct-{observation_name}",
            model=model,
            user_prompt=description,
            attempt=attempt,
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
    """Generate and validate a manifest, correcting invalid output once.

    Raises:
        LLMConfigurationError: if required configuration is missing.
        LLMTimeoutError: if the provider exceeds the configured timeout.
        LLMProviderError: if the provider request fails.
        LLMOutputError: if both model responses violate the manifest contract.
    """
    messages = _initial_messages(description)
    errors: list[str] = []

    for attempt in range(1, _MAX_GENERATION_ATTEMPTS + 1):
        try:
            raw = _completion_response(description, messages, attempt)
            print(raw)
        except LLMConfigurationError:
            raise
        except (LiteLLMTimeout, TimeoutError) as exc:
            logger.warning("LiteLLM generation timed out on attempt %s.", attempt)
            raise LLMTimeoutError("LLM generation timed out.") from exc
        except Exception as exc:
            logger.error(
                "LiteLLM provider request failed on attempt %s (%s).",
                attempt,
                type(exc).__name__,
            )
            raise LLMProviderError("LLM provider request failed.") from exc

        try:
            parsed = _loads_llm_json(raw)
            if not isinstance(parsed, dict):
                raise ValueError(
                    f"LLM returned a JSON {type(parsed).__name__}, expected an object."
                )
            valid, errors = validate_manifest(parsed)
        except ValueError as exc:
            valid = False
            errors = [str(exc)]

        if valid:
            return parsed
        if attempt < _MAX_GENERATION_ATTEMPTS:
            logger.info("Retrying invalid LLM output once with validation feedback.")
            messages = _retry_messages(messages, raw, errors)
            continue

    summary = "; ".join(errors[:5]) or "manifest validation failed"
    raise LLMOutputError(
        "LLM returned an invalid manifest after one correction attempt: " + summary
    )


SCREEN_PLAN_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "screens": {
            "type": "array",
            "minItems": 1,
            "maxItems": 20,
            "items": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 80,
                    },
                    "screen_type": {
                        "type": "string",
                        "enum": ["form", "content"],
                    },
                    "purpose": {
                        "type": "string",
                        "enum": [
                            "intake",
                            "settings",
                            "information",
                            "confirmation",
                        ],
                    },
                    "description": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 500,
                    },
                },
                "required": ["name", "screen_type", "purpose", "description"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["screens"],
    "additionalProperties": False,
}

SCREEN_PLAN_PROMPT = """\
You plan the safe published user interface for one AI agent application.
Return one JSON object with a "screens" array. Propose only screens that help
the published user provide information or understand the ordered experience.

Every screen must contain:
- "name": a short human-readable name.
- "screen_type": "form" or "content".
- "purpose": "intake" or "settings" for form screens; "information" or
  "confirmation" for content screens.
- "description": a concise generation brief for that one screen.

Use the smallest useful collection, normally two to six screens and never more
than twenty. Put screens in the order the user should experience them. Do not
invent IDs, routes, permissions, credentials, tools, dashboards, chat, result
history, database bindings, HTML, scripts, CSS, or conditional navigation.
Return strict JSON only.
"""

CONTENT_SCREEN_PROMPT = """\
You create one safe, non-interactive content screen for an AI agent.
Return exactly one JSON object with a "blocks" array.

Allowed blocks:
- {"id":"unique-id","type":"heading","text":"Heading","level":2}
- {"id":"unique-id","type":"paragraph","text":"Plain text"}
- {"id":"unique-id","type":"divider"}
- {"id":"unique-id","type":"callout","text":"Important text","tone":"information"}
- {"id":"unique-id","type":"section","title":"Title","description":"Optional",
   "children":[...heading, paragraph, divider, or callout blocks...]}

Block IDs must be unique lowercase kebab-case and no longer than 64 characters.
Heading levels may be 2, 3, or 4. Callout tones may be information, success, or
warning. Keep copy concise. Do not emit fields, forms, nested sections, HTML,
Markdown, scripts, CSS, remote content, IDs outside block IDs, permissions, or
credentials. Return strict JSON only.
"""


def _screen_plan_errors(value) -> list[str]:
    from jsonschema import Draft202012Validator

    structural = [
        f"structural: {error.json_path}: {error.message}"
        for error in sorted(
            Draft202012Validator(SCREEN_PLAN_SCHEMA).iter_errors(value),
            key=lambda error: error.json_path,
        )
    ]
    if structural:
        return structural
    errors: list[str] = []
    seen_names: set[str] = set()
    for index, screen in enumerate(value["screens"]):
        normalized = re.sub(
            r"[^a-z0-9]+", "-", screen["name"].strip().lower()
        ).strip("-")
        if not normalized:
            errors.append(f"screens[{index}].name must contain letters or digits")
        if normalized in seen_names:
            errors.append(
                f"screens[{index}].name creates duplicate identifier '{normalized}'"
            )
        seen_names.add(normalized)
        valid_purposes = (
            {"intake", "settings"}
            if screen["screen_type"] == "form"
            else {"information", "confirmation"}
        )
        if screen["purpose"] not in valid_purposes:
            errors.append(
                f"screens[{index}].purpose is not valid for "
                f"{screen['screen_type']} screens"
            )
    return errors


def _generate_contract(
    *,
    description: str,
    system_prompt: str,
    response_schema: dict,
    schema_name: str,
    observation_name: str,
    validator,
) -> dict:
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": description},
    ]
    errors: list[str] = []
    for attempt in range(1, _MAX_GENERATION_ATTEMPTS + 1):
        try:
            raw = _completion_response(
                description,
                messages,
                attempt,
                response_schema=response_schema,
                schema_name=schema_name,
                observation_name=observation_name,
            )
        except LLMConfigurationError:
            raise
        except (LiteLLMTimeout, TimeoutError) as exc:
            raise LLMTimeoutError("LLM generation timed out.") from exc
        except Exception as exc:
            logger.error(
                "LiteLLM provider request failed for %s on attempt %s (%s).",
                observation_name,
                attempt,
                type(exc).__name__,
            )
            raise LLMProviderError("LLM provider request failed.") from exc

        try:
            parsed = _loads_llm_json(raw)
            if not isinstance(parsed, dict):
                raise ValueError("LLM response must be one JSON object.")
            errors = validator(parsed)
        except ValueError as exc:
            errors = [str(exc)]

        if not errors:
            return parsed
        if attempt < _MAX_GENERATION_ATTEMPTS:
            messages = _retry_messages(messages, raw, errors)
    summary = "; ".join(errors[:5]) or "validation failed"
    raise LLMOutputError(
        f"LLM returned invalid {observation_name} output after one correction "
        f"attempt: {summary}"
    )


def generate_screen_plan(description: str, existing_screens: list[dict]) -> dict:
    """Generate a validated, identifier-free screen plan."""
    context = {
        "agent_description": description,
        "existing_screens": [
            {
                "name": screen.get("name", ""),
                "screen_type": screen.get("screen_type", "form"),
                "purpose": screen.get("purpose", "intake"),
                "description": screen.get("description", ""),
            }
            for screen in existing_screens
        ],
    }
    return _generate_contract(
        description=json.dumps(context, ensure_ascii=True),
        system_prompt=SCREEN_PLAN_PROMPT,
        response_schema=SCREEN_PLAN_SCHEMA,
        schema_name="agent_screen_plan",
        observation_name="screen-plan",
        validator=_screen_plan_errors,
    )


def generate_content_schema(description: str) -> dict:
    """Generate and strictly validate one safe content manifest."""

    def content_errors(value) -> list[str]:
        valid, errors = validate_content_manifest(value)
        return [] if valid else errors

    return _generate_contract(
        description=description,
        system_prompt=CONTENT_SCREEN_PROMPT,
        response_schema=CONTENT_META_SCHEMA,
        schema_name="agent_content_manifest",
        observation_name="content-manifest",
        validator=content_errors,
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print('Usage: python llm.py "<agent description>"', file=sys.stderr)
        sys.exit(1)
    result = generate_schema(" ".join(sys.argv[1:]))
    print(json.dumps(result, indent=2))
