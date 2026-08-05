# Screen Configurator — Upgrade Plan

This plan upgrades Agent Screen Studio from a human-gated **input-screen designer** into a useful **agent experience builder** that can connect cleanly to an existing agent backend when one is available.

## Current state

Today the product:

1. Takes an agent name + description
2. Proposes an ordered multi-screen plan
3. Generates form/content manifests (JSON Schema + safe layout blocks)
4. Lets creators review, approve, publish, and export a frontend

It deliberately does **not** run the agent or POST form answers to an agent API. Export ships a local stub (`submitAgent.js`) that returns collected values without networking.

## Goals

| Goal | Outcome |
| --- | --- |
| Better creator UX | Faster plan → generate → approve loop with clear progress |
| Better published UX | Device-correct height/width, internal scroll, no clipped controls |
| Useful agent loop | Screens collect the payload an agent actually needs |
| Backend-ready | One stable submit contract that works with or without an agent API |
| Safe by default | Human approval, validated manifests, no injected credentials |

---

## Phase 0 — UX foundation (done / in progress)

- Viewport-bounded device preview with internal scrolling
- Softer empty-state min-heights (less forced page scroll)
- Create-page tips + example briefs
- Auto-open AI plan after agent create
- Parallel screen generation with progress
- Plan reorder (up/down) before generate
- Surface agent brief on the plan tab

---

## Phase 1 — Make generation more useful

### 1.1 Conversational refine
- Add “Refine this screen” chat on Builder / Content Builder
- Examples: “fewer fields”, “add phone + email”, “make this a wizard”, “shorter copy”
- Call a new endpoint: `POST /agents/{id}/screens/{screenId}/refine`
- Keep human approval; never auto-publish refined drafts

### 1.2 Cross-screen awareness
- When generating screen N, pass approved field names from screens 1…N-1
- Avoid duplicate contact fields across the journey
- Suggest continuity (“reuse email collected on Welcome”)

### 1.3 Outcome-oriented previews
- Show **payload shape** beside the live canvas (`valuesByScreen` JSON)
- Mock panel: “Agent would receive…” without executing an agent
- Export this shape as OpenAPI / JSON Schema artifact per release

### 1.4 Template library
- Seed common patterns: inbound calling, research intake, support triage, onboarding
- Plan generator can prefer a template when the brief matches

---

## Phase 2 — Agent backend connection contract

Design principle: the Screen Configurator owns **inputs + journey**. The agent backend owns **execution + results**.

### 2.1 Canonical submit payload

Extend the export adapter beyond the local stub:

```json
{
  "agent_id": "inbound-calling-agent",
  "release_version": 3,
  "started_at": "2026-08-05T07:00:00Z",
  "completed_at": "2026-08-05T07:02:11Z",
  "values_by_screen": {
    "caller-details": {
      "full_name": "Ada Lovelace",
      "callback_number": "+1…"
    },
    "issue-category": {
      "category": "billing"
    }
  },
  "flat_values": {
    "full_name": "Ada Lovelace",
    "callback_number": "+1…",
    "category": "billing"
  },
  "metadata": {
    "source": "published-agent-ui",
    "locale": "en-US"
  }
}
```

### 2.2 Integration modes

| Mode | When | Behavior |
| --- | --- | --- |
| `local` | Default / offline | Current stub; keep values in browser memory |
| `webhook` | Generic backends | `POST` to configured URL with HMAC signature |
| `agent_api` | First-party agent runtime exists | Call `POST {AGENT_API_BASE}/v1/agents/{agent_id}/runs` |
| `custom` | Enterprise | Injected `submitAgent` module at export time |

### 2.3 Backend endpoints to add (Screen Configurator)

```
GET  /agents/{id}/integration
PUT  /agents/{id}/integration
POST /agents/{id}/integration/test
```

Stored (encrypted at rest) settings:

- `mode`, `endpoint_url`, `auth_type` (`none` | `bearer` | `hmac` | `adc`)
- `headers` allowlist
- `timeout_ms`, `retry_policy`
- `result_screen_mode` (`none` | `static` | `poll_run`)

Never embed raw secrets in exported frontends. Prefer:

1. Browser → Screen Configurator proxy → Agent backend, **or**
2. Short-lived signed upload URL issued at publish time

### 2.4 Agent backend API expectations (if it exists)

Minimum contract the agent runtime should expose:

```
POST /v1/agents/{agent_id}/runs
  body: canonical submit payload
  → { run_id, status: "queued"|"running"|"succeeded"|"failed", result_url? }

GET  /v1/runs/{run_id}
  → { status, result?, error? }
```

Optional later:

```
POST /v1/agents/{agent_id}/runs/{run_id}/cancel
GET  /v1/agents/{agent_id}/input-schema   # validate parity with published manifest
```

### 2.5 Export packaging changes

- Replace stub `submitAgent.js` with generated client selected by integration mode
- Include `.env.example` for `VITE_AGENT_SUBMIT_URL` / proxy path
- Document mapping from `values_by_screen` → agent tool/function args
- Add release metadata file: `agent-release.json` (id, version, screen order, field catalog)

---

## Phase 3 — Result / output screens

Today only **input** screens exist. Add optional post-submit experience:

1. **Static confirmation** (no backend) — already partially covered by content screens
2. **Waiting state** — poll run status with timeout + retry UX
3. **Result screen** — render allowlisted result blocks (summary, links, download)
4. **Failure screen** — actionable errors without leaking internals

Manifest extension (additive, versioned):

```json
{
  "result_hints": {
    "mode": "poll_run",
    "blocks": [
      { "id": "summary", "type": "heading", "text": "Your request is ready", "level": 2 }
    ]
  }
}
```

Keep the same safety model: no arbitrary HTML/scripts.

---

## Phase 4 — Studio productivity

- Deep-link “Open first failed screen” after partial plan generation
- Field library / reuse across agents
- Diff view between draft and last approved release
- Role-aware publish checklist (validation, accessibility, payload review)
- Analytics on drop-off per screen (privacy-preserving)

---

## Phase 5 — Hardening for production agents

- Contract tests: published manifest schema ↔ agent input schema
- Signing + replay protection for webhook mode
- PII classification on fields (`email`, `phone`, file uploads)
- Retention policy for stored draft answers / run proxies
- Multi-environment publish (`dev` / `staging` / `prod` endpoints)

---

## Suggested implementation order

1. **Now** — Layout/scroll polish + plan UX (this iteration)
2. **Next** — Canonical submit payload + webhook/proxy mode + export client
3. **Then** — Refine endpoint + cross-screen field reuse
4. **Then** — Run polling + result screens when an agent API is present
5. **Finally** — Template library, contract tests, multi-env

## Success metrics

- Time from create → first approved multi-screen draft under 10 minutes
- Zero clipped controls in desktop/tablet/mobile preview
- Exported UI can submit to a real agent backend with only env/config changes
- Human approval remains required before publish
- Manifest validation rejection rate stays visible and actionable

## Non-goals (remain out of scope unless explicitly pulled in)

- Hosting arbitrary agent runtimes inside this app
- Letting the LLM invent routes, credentials, or database IDs
- Generating unrestricted HTML/JS widgets
- Replacing the customer’s agent orchestration platform
