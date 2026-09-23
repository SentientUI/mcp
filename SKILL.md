---
name: sentientui
description: Use when working with SentientUI — an adaptive UI personalization platform — from an AI agent. Covers connecting to the SentientUI MCP server, reading experiment data (variant performance, personas, goal funnels, AI insights, guardrail events), creating and pausing variants, and integrating the @sentientui/react SDK into a codebase.
---

# Working with SentientUI

SentientUI adapts a website per visitor type (personas are the keys your app declares, e.g. `admin` or `evaluator`, or that discovery proposes; `unknown` until then), learning from real conversions with a Thompson-Sampling bandit. Decisions are locked per session: Visit 1 learns, Visit 2 converts.

## Connect to the MCP server

- **Hosted (recommended):** `https://api.sentient-ui.com/mcp` — Streamable HTTP, OAuth 2.1, no key to paste.
  In Claude Code: `claude mcp add --transport http sentientui https://api.sentient-ui.com/mcp`
- **Local:** `npx @sentientui/mcp` with `SENTIENTUI_API_KEY=sk_...` (omit for a read-only demo).

Discovery (`initialize`, `tools/list`) is public; tool calls require auth.

## What the tools do

**Read:** `list_projects`, `get_project_stats`, `list_components`, `get_variant_performance` (CVR + momentum), `get_persona_breakdown`, `get_goal_funnel`, `get_layout_stats`, `get_insights`, `list_guardrail_events`. Every tool declares an `outputSchema` and returns `structuredContent`, so responses are type-checkable.

**Act:** `refresh_insights`, `create_variant` (no-code managed text), `pause_variant`.

**Author variants in code:** `get_variant_brief` returns an insight-driven, data-sufficiency-aware brief for writing a new code-native variant; `get_test_brief` returns paste-ready deterministic tests; `get_integration_guide` returns the full setup ladder.

## Typical flows

- **Check performance:** `list_projects` → `get_variant_performance` / `get_goal_funnel` → `get_insights`.
- **Improve a component:** `get_variant_brief` for the component, write the new variant in code (it auto-registers on deploy), then `get_test_brief` to lock it in tests.
- **Integrate SentientUI:** `get_integration_guide`, then wrap components with `<Adaptive>` from `@sentientui/react`. `<Adaptive>` fills a region two ways and they are not interchangeable: with **children** (no `variants`) it registers a region SentientUI writes versions for per visitor type, and it appears as a column in the dashboard's "Who sees what" — start here. With **`variants`** it runs an A/B test between versions you wrote yourself, and it never appears there (`useAdaptive` is the hook form of this second one). Either way `goal` is required, and it should be a **named string** (`goal="signup_click"`): an object config like `{ type: 'click', selector: 'a' }` is unnamed and reports under the bare type `click`.

Learn more: https://sentient-ui.com/docs
