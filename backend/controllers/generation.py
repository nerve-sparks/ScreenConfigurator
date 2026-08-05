"""Generation & validation controllers."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from utils.llm import (
    LLMConfigurationError,
    LLMOutputError,
    LLMProviderError,
    LLMTimeoutError,
    generate_schema,
)
from utils.manifest_migrations import upgrade_legacy_layout
from models.schemas import GenerateRequest, ValidateManifestRequest
from services import common

logger = logging.getLogger(__name__)
router = APIRouter(tags=["generation"])


@router.post("/generate")
def generate(request: GenerateRequest) -> dict:
    """Turn a plain-text agent description into a manifest."""
    description = request.description.strip()
    if not description:
        raise HTTPException(status_code=422, detail="description must not be empty")

    try:
        manifest = generate_schema(description)
    except LLMConfigurationError as exc:
        logger.error("LLM generation is not configured (%s).", type(exc).__name__)
        raise HTTPException(
            status_code=503,
            detail=(
                "AI generation is not configured. Contact the application "
                "administrator."
            ),
        ) from exc
    except LLMTimeoutError as exc:
        raise HTTPException(
            status_code=504,
            detail="AI generation timed out. Please try again.",
        ) from exc
    except LLMOutputError as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "AI provider returned an invalid screen definition after one "
                "correction attempt. Please try again."
            ),
        ) from exc
    except LLMProviderError as exc:
        raise HTTPException(
            status_code=502,
            detail="AI provider request failed. Please try again.",
        ) from exc
    except Exception as exc:
        logger.error("Unexpected AI generation failure (%s).", type(exc).__name__)
        raise HTTPException(
            status_code=500,
            detail="AI generation failed unexpectedly. Please try again.",
        ) from exc

    # Defense in depth: llm.py already validates and retries once, but the
    # route still refuses an invalid value if generation is mocked or changed.
    return common._ensure_valid_manifest(manifest, "Generated manifest failed validation.")

@router.post("/validate")
def validate_screen(request: ValidateManifestRequest) -> dict:
    """Validate a human-reviewed draft before it reaches preview or storage."""
    manifest = upgrade_legacy_layout(request.manifest)
    common._ensure_valid_manifest(manifest, "Manifest failed validation.")
    return {"valid": True, "manifest": manifest}
