---
name: sentientui
description: Use when working with SentientUI — an adaptive UI personalization platform — from an AI agent. Covers connecting to the SentientUI MCP server, reading experiment data (variant performance, personas, goal funnels, AI insights, guardrail events), creating and pausing variants, and integrating the @sentientui/react SDK into a codebase.
---

# Working with SentientUI

SentientUI adapts a website per visitor type (personas: buyer, researcher, deal_seeker, browser, unknown), learning from real conversions with a Thompson-Sampling bandit. Decisions are locked per session: Visit 1 learns, Visit 2 converts.

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
- **Integrate SentientUI:** `get_integration_guide`, then wrap components with `<Adaptive>` / `useAdaptive` from `@sentientui/react`.

Learn more: https://sentient-ui.com/docs
