"""Description -> manifest: the LLM call, in isolation.

Turns a plain-text agent description into a manifest of the form:

    {
        "input_schema": {...},
        "ui_hints": {"mode": "single" | "wizard", "field_order": [...]},
    }

No UI, no web route -- just the core transformation (Step 2).
"""

import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from litellm import completion

# Load backend/.env regardless of the current working directory.
load_dotenv(Path(__file__).resolve().parent / ".env")

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


def generate_schema(description: str) -> dict:
    """Turn a plain-text agent description into a manifest dict.

    Raises:
        RuntimeError: if required configuration is missing.
        ValueError: if the LLM response cannot be parsed as a JSON object.
    """
    model = os.getenv("MODEL")
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
        if not (os.getenv("VERTEXAI_LOCATION") or os.getenv("GOOGLE_CLOUD_LOCATION")):
            raise RuntimeError(
                "VERTEXAI_LOCATION is not set. Add it to backend/.env, "
                "e.g. VERTEXAI_LOCATION=global."
            )

    response = completion(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": description},
        ],
        temperature=0,
    )
    raw = response.choices[0].message.content or ""

    try:
        manifest = json.loads(_strip_code_fences(raw))
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"LLM response is not valid JSON ({exc}).\n"
            f"--- raw response ---\n{raw}"
        ) from exc

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
