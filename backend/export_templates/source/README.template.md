# __AGENT_NAME__ frontend

Standalone React frontend for `__AGENT_ID__`, published release
`__RELEASE_VERSION__`.

## Layout

```text
src/
  App.jsx
  main.jsx
  styles.css
  data/
    agent-release.json   # screens + scorecard.connection.url
  lib/
    api.js               # posts answers to the agent backend
    releaseLoader.js
    presentation.js
    layoutBlocks.js
    manifestLayout.js
  components/            # screens, forms, wizard, flow
  pages/
    AgentPage.jsx        # published agent experience
```

## Open immediately

Open `preview.html` in a modern browser. It is self-contained and does not
require Node.js or a local server.

## Run the React app

Requirements: Node.js 20.19+ or 22.12+

```bash
npm ci
cp .env.example .env   # set VITE_AGENT_API_KEY if the agent needs auth
npm run dev
```

Production build:

```bash
npm run build
```

## Agent backend connection

`src/data/agent-release.json` includes the public scorecard snapshot. When
`scorecard.connection.url` is set, finishing the journey calls that URL through
`src/lib/api.js` (JSON by default; multipart for agent-builder `/pipeline`
URLs).

Secrets are never shipped in the zip. If the agent expects
`Authorization: Bearer <JWT>`, put it in `.env`:

```bash
VITE_AGENT_API_KEY=Bearer your-access-token
```

Then restart `npm run dev`.

## Collected answers

Without a connection URL, answers stay in the browser and can be downloaded as
JSON. With a URL, the agent response is shown on the completion screen.
