# Agent Screen Studio — What This Application Does

**Agent Screen Studio** (this repository: ScreenConfigurator) helps teams turn a plain-language description of an AI agent into a **safe, multi-screen user experience**—then publish that experience and connect it to real agent backends.

In short: it designs and ships the **input journey** people use before (and while) an agent runs.

---

## The problem it solves

AI agents need structured inputs: topics, URLs, settings, files, and so on. Building those forms by hand for every agent is slow, inconsistent, and easy to get wrong.

This application:

1. **Proposes** the screens an agent needs (with AI help).
2. Lets a human **review and approve** every field and layout.
3. **Publishes** a clean, versioned experience users can open in a browser.
4. Optionally **forwards** collected answers to one or more real agent APIs.

Creators stay in control. End users get a clear, branded journey instead of a raw API or chat dump.

---

## Who it’s for

| Audience | How they use it |
| --- | --- |
| **Product / ops teams** | Describe an agent, approve screens, publish a release |
| **Engineers** | Attach endpoint URLs, auth, and scorecard contracts; export frontends |
| **End users** | Open a published agent link and complete the guided screens |

---

## What you can build

- **Form screens** — validated fields (text, email, URL, file upload, and more)
- **Content screens** — welcome, instructions, confirmations (safe blocks only; no raw HTML/JS)
- **Multi-step journeys** — ordered screens with a sidebar/nav and Back/Continue flow
- **Branded presentation** — name, icon, accent, welcome copy, submit labels
- **One or many agent backends** — shared auth plus a catalog of endpoints

### Multiple endpoints

A single Studio project can talk to **several agent APIs** (for example Settings + Document Generator).

Creators choose how screens are organized:

- **One shared journey** — fields for all endpoints collected across shared screens  
- **Separate screens per endpoint** — each endpoint gets its own screen group so fields don’t mix (e.g. a free-text topic never lands in a scrape `url` field)

On finish, Studio calls enabled endpoints in order. In “separate” mode, each endpoint only receives values from its own screens.

---

## How the creator workflow works

```text
Describe agent + auth + endpoints
        ↓
AI proposes a screen plan  →  human edits the plan
        ↓
Generate each screen       →  approve fields & layout
        ↓
Preview the full journey
        ↓
Publish an immutable release
        ↓
Users open /agents/{id}  (or download a standalone frontend ZIP)
```

### Studio steps (wizard)

1. **Describe** — Name, brief, shared authentication, endpoints (URL + scorecard JSON), and screen grouping.
2. **Plan** — AI suggests screens; you rename, reorder, or remove them.
3. **Approve** — Review generated forms/content; approve before publish.
4. **Publish** — Snapshot becomes a numbered, immutable release.

You can also test a **single endpoint** from the configure UI before (or after) publishing.

---

## What end users experience

Users open a published agent (for example `/agents/my-agent`) and see:

- A **sidebar** of screen names  
- One screen at a time (forms or informational content)  
- Validation before continuing on forms  
- On finish, answers sent to the configured agent endpoint(s), with responses shown when available  

No Studio chrome—just the agent experience.

---

## Safety and quality principles

The product is intentionally strict:

- Manifests are **validated** (structure + semantics) before preview/publish  
- Content is **allowlisted blocks** only (no arbitrary HTML, scripts, or CSS)  
- Secrets stay in **server-side runtime auth**, not in scorecard JSON shown to the browser  
- Releases are **immutable**; older versions can be restored into new drafts without rewriting history  
- Humans **approve** AI-suggested fields and layouts before they go live  

---

## What this application does *not* do

It is not a full agent runtime or LLM host for the customer’s agent logic.

It does **not**:

- Replace your agent-builder / pipeline platform  
- Invent credentials UIs or store secrets in exported ZIP packages by default  
- Generate “result dashboards” from an agent’s `output_schema`  
- Bypass validation to ship unapproved screens  

It **does** generate the UI contract, collect the inputs, and forward them to the backends you configure.

---

## Main pieces of the product

| Area | Purpose |
| --- | --- |
| **Agent Library** | Search, open, duplicate, and archive agent projects |
| **Agent Wizard / Studio** | Describe → plan → approve → publish |
| **Screen builders** | Edit individual form or content screens |
| **Published agent page** | Live user-facing journey for a release |
| **Frontend export** | Download a self-contained React app + `preview.html` for a release |
| **API backend** | Generation, validation, drafts, releases, endpoint run/test |

---

## Technology (high level)

- **Frontend:** React, Vite, React JSON Schema Form, Tailwind-based dashboard chrome  
- **Backend:** FastAPI, MongoDB (drafts + immutable releases)  
- **AI:** LiteLLM (e.g. Gemini / gateway) for plan and screen generation  
- **Auth:** JWT login against the org auth gateway for Studio access  

For install, env vars, and API details, see the main [README.md](README.md).

---

## One-sentence pitch

**Agent Screen Studio turns “what should users fill in for this agent?” into an approved, versioned, multi-screen experience that can call your real agent endpoints.**
