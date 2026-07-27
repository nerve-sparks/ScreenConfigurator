# __AGENT_NAME__ frontend

This is the standalone frontend for `__AGENT_ID__`, published release
`__RELEASE_VERSION__`.

## Open immediately

Open `preview.html` in a modern browser. It is self-contained and does not
require Node.js, npm, a local server, or a backend connection.

## Edit the React source

Requirements:

- Node.js 20.19+ or 22.12+

```bash
npm ci
npm run dev
```

Create a production build with:

```bash
npm run build
```

The generated files are written to `dist/`.

## Agent definition

`src/agent-release.json` contains only the public, validated snapshot for this
agent release. React components render every form, content screen, and wizard
step from that definition.

## Collected answers

Answers stay in browser memory. At completion, users can download a local JSON
file containing:

```json
{
  "agent_id": "__AGENT_ID__",
  "release_version": __RELEASE_VERSION__,
  "values_by_screen": {}
}
```

Decorative layout content is never included in submitted values.

To connect the frontend to your own API, replace the implementation in
`src/submitAgent.js`. Do not place credentials in browser source or environment
variables prefixed with `VITE_`.
