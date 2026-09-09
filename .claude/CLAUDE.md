# SentientUI MCP — agent notes

This repository is the source for [`@sentientui/mcp`](https://www.npmjs.com/package/@sentientui/mcp),
the Model Context Protocol server for [SentientUI](https://sentient-ui.com) — an
adaptive UI personalization platform.

## Using SentientUI from an assistant

- **Hosted (recommended):** connect to `https://api.sentient-ui.com/mcp` (Streamable
  HTTP, OAuth 2.1 — no key to paste). In Claude Code:
  `claude mcp add --transport http sentientui https://api.sentient-ui.com/mcp`.
- **Local:** `npx @sentientui/mcp` with `SENTIENTUI_API_KEY=sk_...` (or omit for
  read-only demo mode).
- Tools cover reading experiment data (variant performance, personas, goal funnels,
  insights, guardrail events) and managing projects/variants. See `README.md`.

## Developing this package

- Source is in `src/` (`server.ts` builds the server; `tools/*` register tools;
  `api-client.ts` calls the SentientUI management API).
- `pnpm build` (tsup), `pnpm test` (vitest), `pnpm typecheck`.
- Tools are pure wrappers over the public management API — no secrets live here.
- Keep tool descriptions accurate: every tool must map to a real management
  endpoint, and `create_variant`/`create_project` gates must be stated precisely.

## Do not

- Add secrets, keys, or customer data to this repo.
- Change a tool's public name without a changeset — clients depend on it.
