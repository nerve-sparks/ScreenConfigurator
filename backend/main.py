"""FastAPI app + routes: the one shared backend.

POST /generate -- plain-text description in, validated manifest out.
Validation is the gate (Step 4): nothing invalid is ever returned.
The backend knows only the manifest contract; it never branches on
any specific agent name or type.
"""

from contextlib import asynccontextmanager
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo.errors import PyMongoError

from db import ensure_indexes, get_manifest, save_manifest, slugify
from llm import generate_schema
from manifest_migrations import upgrade_legacy_layout
from validation import validate_manifest

# Vite dev server origins allowed to call this API.
FRONTEND_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Step 5: ensure the registry's indexes exist before serving. The
    # unique {agent_id, version} index enforces "no duplicate versions",
    # so we fail fast (with a clear message) rather than run without it.
    try:
        ensure_indexes()
    except PyMongoError as exc:
        raise RuntimeError(
            f"Could not reach MongoDB at startup ({exc}). Check MONGODB_URI "
            "in backend/.env and make sure MongoDB is running."
        ) from exc
    yield


app = FastAPI(title="Agent Screen Generator", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    description: str


@app.post("/generate")
def generate(request: GenerateRequest) -> dict:
    """Turn a plain-text agent description into a manifest."""
    description = request.description.strip()
    if not description:
        raise HTTPException(status_code=422, detail="description must not be empty")

    try:
        manifest = generate_schema(description)
    except Exception as exc:
        # llm.py raises clear, descriptive errors (missing config, LLM/network
        # failure, unparseable response). Surface the message instead of an
        # opaque 500 so the frontend can show what actually went wrong.
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    ok, errors = validate_manifest(manifest)
    if not ok:
        # Validation is the gate: return the error list instead of a form.
        # (Auto-retrying the LLM with these errors is deliberately deferred.)
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Generated manifest failed validation.",
                "errors": errors,
            },
        )
    return manifest


class SaveScreenRequest(BaseModel):
    manifest: dict
    description: str = ""
    name: str = ""
    source: Literal["llm", "manual"] = "llm"


@app.post("/screens")
def save_screen(request: SaveScreenRequest) -> dict:
    """Validate, then save as a new immutable version.

    The validation gate applies to storage exactly as it does to
    generation: nothing invalid is ever stored.
    """
    manifest = upgrade_legacy_layout(request.manifest)
    ok, errors = validate_manifest(manifest)
    if not ok:
        raise HTTPException(
            status_code=422,
            detail={"message": "Manifest failed validation.", "errors": errors},
        )

    agent_id = slugify(request.name) or slugify(request.description)
    if not agent_id:
        raise HTTPException(
            status_code=422,
            detail="Could not derive an agent_id: provide a short name or a description.",
        )

    try:
        version = save_manifest(
            agent_id, manifest, request.description, request.source
        )
    except (PyMongoError, RuntimeError) as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc

    return {"agent_id": agent_id, "version": version}


@app.get("/screens/{agent_id}")
def get_screen(agent_id: str, version: Optional[int] = None) -> dict:
    """Return a saved screen document -- the latest version unless one is
    given. No LLM involved: reloading a saved screen never calls it.
    """
    try:
        document = get_manifest(agent_id, version)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc

    if document is None:
        raise HTTPException(
            status_code=404,
            detail=f"No saved screen found for agent_id '{agent_id}'.",
        )
    document["manifest"] = upgrade_legacy_layout(document["manifest"])
    return document
