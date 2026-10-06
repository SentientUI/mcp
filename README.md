# @sentientui/mcp

[![smithery badge](https://smithery.ai/badge/carlos-sanchez/sentientUI)](https://smithery.ai/servers/carlos-sanchez/sentientUI)

MCP server for [SentientUI](https://sentient-ui.com) — gives AI agents in Claude Code, Cursor, and Copilot direct access to your experiment data and management actions.

## Quick start

> **Prefer no key?** You can skip local install entirely and connect your assistant to the hosted endpoint by URL with an OAuth sign-in — this is the only way to use SentientUI from web/app assistants (claude.ai, ChatGPT):
> ```
> https://api.sentient-ui.com/mcp
> ```
> Claude Code: `claude mcp add --transport http sentientui https://api.sentient-ui.com/mcp`. For stdio-only clients: `npx mcp-remote https://api.sentient-ui.com/mcp`. The rest of this README covers the local, key-based install below.

**1. Get a server key**

Dashboard → Project → **Settings → API key → Server key** → Generate. Available on every plan, including Free. A server key belongs to **one project**: it can read and change only that project, and generating a new one revokes the previous key.

**2. Add to your AI assistant**

**Claude Code** — one command:
```bash
claude mcp add sentientui -e SENTIENTUI_API_KEY=sk_your_key_here -- npx -y @sentientui/mcp
```
Or check a project-scoped `.mcp.json` into your repo:
```json
{
  "mcpServers": {
    "sentientui": {
      "command": "npx",
      "args": ["-y", "@sentientui/mcp"],
      "env": {
        "SENTIENTUI_API_KEY": "sk_your_key_here"
      }
    }
  }
}
```

**Cursor** — `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "sentientui": {
      "command": "npx",
      "args": ["-y", "@sentientui/mcp"],
      "env": {
        "SENTIENTUI_API_KEY": "sk_your_key_here"
      }
    }
  }
}
```

**VS Code + Copilot** — `.vscode/mcp.json`:
```json
{
  "servers": {
    "sentientui": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@sentientui/mcp"],
      "env": {
        "SENTIENTUI_API_KEY": "sk_your_key_here"
      }
    }
  }
}
```

**3. Restart your IDE.** The server connects at startup.

## Demo mode

No account? Run without an API key:

```bash
npx @sentientui/mcp
```

A demo token is provisioned automatically — 10 calls/month, read-only (write tools require an account with an `sk_` key or an OAuth sign-in), no sign-up required. It points at an **empty** sandbox project with no fixture data, so the read tools return empty results: it shows the tool surface, not a populated example. The token is cached in `~/.config/sentientui/mcp-anon.json`.

## Tools

<!-- mcp-tools:start -->
| Tool | Access | What it does |
|------|--------|-------------|
| `list_projects` | read | List the projects this credential can see (an `sk_` key sees only its own project) |
| `create_project` | write | Create a project and return its `pk_` public key (account login only — not an `sk_` key or demo token) |
| `get_project_stats` | read | Ingestion health: status, 24h events and sessions, and calls to the `/v1/agent` API (`agentCalls` — not MCP tool calls) |
| `add_origin` | write | Allow-list a site origin so the SDK's events from it are accepted (idempotent) |
| `list_components` | read | Adaptive components with variant counts and impressions |
| `get_variant_performance` | read | Per-(component, variant) rates with their n and the server's evidence verdict vs the baseline (range 7d/30d/90d/all or from/to; default 7d; the verdict judges the windowed rate, with all-time reliability reported separately) |
| `get_variant_brief` | read | Evidence-driven brief for writing a new **code-native** variant: per-arm rates with n and evidence verdicts, audience, measured findings, an evidence state (with a best-practice fallback while nothing is decided), and step-by-step code instructions |
| `get_test_brief` | read | Ready-to-paste test code (RTL, mock server, Playwright/Cypress) that forces one of a component's real variants |
| `create_variant` | write | Create a no-code managed text variant as a draft — fallback for text-only variants without a code change |
| `update_variant` | write | Edit a managed variant's name or text, or activate a draft (`status: active` — it starts serving) / move it back to draft |
| `delete_variant_draft` | write | Delete a managed variant that is still a draft |
| `pause_variant` | write | Pause a variant so no new traffic is assigned to it (undo with `resume_variant`) |
| `resume_variant` | write | Resume a paused variant — manual or guardrail pause |
| `retire_variant` | write | Retire (archive) an active variant (undo with `restore_variant`; a promoted variant must be unpromoted first) |
| `restore_variant` | write | Bring a retired variant back to active (does not unpause it) |
| `get_goal_funnel` | read | Per-goal conversion summary (windowed; default 30d) with descriptive all-time per-variant rates — not a step funnel (use `get_funnel_report` for drop-off); the id is kept for compatibility |
| `list_goals` | read | Defined goals (id, role, event, status), including ones with no conversions yet |
| `define_goal` | write | Create a new goal (secondary or guardrail). Create-only: refuses an existing goal id and never sets or changes the primary goal |
| `list_funnels` | read | Defined multi-step funnels |
| `get_funnel_report` | read | Step-by-step funnel drop-off |
| `list_guardrail_events` | read | Every variant currently paused by a guardrail (pass `days` to see only pauses from the last N days) |
| `get_persona_breakdown` | read | Visitor clusters with session counts and reliability (all retained sessions) |
| `get_layout_stats` | read | Per-persona section order with bandit pulls and reward (cumulative state) |
| `get_insights` | read | Ranked measured findings with their sample (low samples flagged), plus AI narrations marked unmeasured |
| `refresh_insights` | write | Regenerate AI insights — needs Starter or higher and an editor/admin role (a paid model call); advisor recommendations are Growth+ |
| `get_cell_matrix` | read | The "Who sees what" matrix of generated versions per visitor type and region |
| `get_cell_detail` | read | One cell's generated version, why it was written, and how it performs |
| `generate_cell` | write | Queue AI generation for one cell — publishes automatically, or waits for approval when review mode is on (Free includes 5 generations/month) |
| `list_cell_reviews` | read | Generated versions waiting for approval (review mode) |
| `review_cell` | write | Approve (publish) or reject one generated version waiting for review |
| `get_agent_traffic` | read | Which AI crawlers, agentic browsers and agent API callers read the site (windowed; paid plans) |
| `get_agent_legibility` | read | Whether the pages agents read are machine-legible, with fixes (paid plans) |
| `get_integration_guide` | read | SDK setup guide (static — same for every project) |
<!-- mcp-tools:end -->

> **Write tools ask first.** Every write tool changes what real visitors see or what the project accepts, so an assistant should confirm with you before calling one. The common ones are reversible: `pause_variant` → `resume_variant`, `retire_variant` → `restore_variant`, `update_variant` `status: active` → `status: draft`.
>
> **Generated versions.** An `<Adaptive id="…">` that wraps your original as children (no `variants`) registers as a personalizable region once it is mounted and deployed. Its versions per visitor type are written in SentientUI — inspect and fill them with `get_cell_matrix`, `get_cell_detail`, and `generate_cell` — with no code change or redeploy. When the project has review mode on, a generated version waits in `list_cell_reviews` until `review_cell` approves it.
>
> **Code-native vs no-code variants.** Variants you declare in your app (`<Adaptive variants={{…}}>`) register automatically the first time the SDK requests an assignment after you deploy — they go live immediately and need **no** `create_variant` call. Use `create_variant` only for **no-code** variants whose content is stored in SentientUI and rendered without a code change; these start as drafts — activate one with `update_variant` (`status: active`) or from the dashboard.
>
> **Optimizing a component?** Call `get_variant_brief` first. It returns each variant's rate with its sample and the server's evidence verdict, the audience, measured findings, and an evidence-state assessment — then your AI assistant writes a new on-brand variant directly into your code (which auto-registers on deploy). While nothing is decided, the brief falls back to best-practice priors for your project's context type so the assistant still makes a sensible change.

## Example prompts

- *"What projects do I have?"*
- *"Show me the CVR trends for the hero banner this week"*
- *"Are any variants paused by the guardrail right now?"*
- *"What do the AI insights say about what changed this week?"*
- *"Refresh insights for project X"*
- *"Optimize my hero CTA — pull the brief and add a new variant in the code"*
- *"Create a new variant called 'short-copy' for the pricing CTA"*

## Configuration

| Environment variable | Default | Description |
|----------------------|---------|-------------|
| `SENTIENTUI_API_KEY` | — | Your `sk_...` server key. Required (or demo mode activates). |
| `SENTIENTUI_API_URL` | `https://api.sentient-ui.com` | Override for staging or a custom API endpoint. |

## Auth model

The server key you provide is passed as a `Bearer` token on every call to the SentientUI management API. It is scoped to **one project**: `list_projects` returns only that project, and calls naming any other project are refused. To work across several projects, connect by URL with an OAuth sign-in instead. Keys are never logged or stored by the MCP package; they exist only in the process environment.

Server keys start with `sk_` (not `pk_`). Public keys (`pk_`) are for the React SDK only and will be rejected by the management API.

## AI agent context

`AGENTS.md` (included in this package) gives your AI assistant deeper context about SentientUI concepts, tool ordering, and common pitfalls. Wire it up once and it applies to every conversation.

| Assistant | How to use |
|-----------|-----------|
| **Claude Code** | Copy to `~/.claude/skills/sentientui/SKILL.md` |
| **Cursor** | Copy to `.cursor/rules/sentientui.mdc` |
| **GitHub Copilot** | Append to `.github/copilot-instructions.md` |
| **Other** | Paste into your assistant's system prompt |

## Requirements

- Node.js 18+
- A SentientUI account (or use demo mode)
