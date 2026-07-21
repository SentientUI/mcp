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

Dashboard → Project → **Settings → API key → Server key** → Generate (requires Starter or Growth plan).

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

A sandboxed demo token is provisioned automatically — 10 calls/month, read-only (write tools require an account with an `sk_` key), no sign-up required. The token is cached in `~/.config/sentientui/mcp-anon.json`.

## Tools

| Tool | What it does |
|------|-------------|
| `list_projects` | List all projects in the account |
| `create_project` | Create a new project and return its `pk_` public key (account login required — not usable with an `sk_` project key or demo token) |
| `get_project_stats` | Events, sessions, agent calls, and health status |
| `list_components` | All adaptive components with variant counts |
| `get_variant_performance` | CVR, momentum, and impressions per variant (7d vs prior 7d) |
| `get_insights` | AI-generated narrator observations and advisor recommendations |
| `refresh_insights` | Trigger fresh AI insight generation |
| `get_persona_breakdown` | Visitor cluster distribution with reliability scores |
| `get_goal_funnel` | Goal hit counts and conversion rates per variant |
| `list_guardrail_events` | Variants auto-paused by the guardrail (last 24h) |
| `get_layout_stats` | Per-persona section layout rankings and reward weights |
| `get_integration_guide` | SentientUI adaptive-ladder setup guide (static — same for every project) |
| `get_test_brief` | What to test and how, for the project's current state |
| `get_variant_brief` | Insight-driven brief for writing a new **code-native** variant: performance, audience, insights, data-sufficiency (with a best-practice fallback when there's no data yet), and step-by-step code instructions |
| `create_variant` | Create a no-code (managed) text variant (Starter+) — fallback for text-only variants without a code change |
| `pause_variant` | Pause a variant to stop traffic assignment |

> **Code-native vs no-code variants.** Variants you declare in your app (`<Adaptive variants={{…}}>`) register automatically the first time the SDK requests an assignment after you deploy — they go live immediately and need **no** `create_variant` call. Use `create_variant` only for **no-code** variants whose content is stored in SentientUI and rendered without a code change; these start as drafts you activate from the dashboard.
>
> **Optimizing a component?** Call `get_variant_brief` first. It returns the component's performance, audience, insights, and a data-sufficiency assessment — then your AI assistant writes a new on-brand variant directly into your code (which auto-registers on deploy). When there's no data yet, the brief falls back to best-practice priors for your project's context type so the assistant still makes a sensible change.

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

The server key you provide is passed as a `Bearer` token on every call to the SentientUI management API. It is scoped to your account — all projects you own are accessible. Keys are never logged or stored by the MCP package; they exist only in the process environment.

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
