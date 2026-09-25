# SentientUI — AI Agent Guide

SentientUI is a UI personalization platform that assigns visitors to variant components and reorders page sections per persona. The MCP gives agents read + limited write access to project data.

## Key Concepts

**Persona / Cluster** — visitors are clustered by behavior into labeled groups. A `reliability_score` (0–1) measures confidence in the assignment. Low reliability means the engine won't personalize for that session even if a cluster is assigned.

**Variant** — a version of an adaptive component. There are **two kinds**, and the difference matters:

- **Code-native variants** are declared in the customer's code (`<Adaptive variants={{…}}>`). They **register automatically** the first time the SDK requests an assignment after deploy, and they go **live immediately** — there is no draft step and no `create_variant` call. Their content lives in the repo, not in SentientUI.
- **No-code / managed variants** have no code; their content is stored on the SentientUI API (dashboard WYSIWYG, `<AdaptiveText>`, or `create_variant`). These start as **draft** after `create_variant` and must be activated from the dashboard before traffic is assigned. There is no MCP tool to activate or resume variants.

Only call `create_variant` for the no-code path. If the user is writing (or you are writing) the variant in code, do **not** call `create_variant` — deploying the code registers it.

**Guardrail** — automatic safety circuit that pauses variants whose CVR drops below threshold. `list_guardrail_events` shows what's been paused. Pausing via `pause_variant` is irreversible via MCP (no resume tool).

**Shadow mode** — project-level flag (toggled in dashboard settings). When ON: personalization is computed and logged but visitors receive the default layout/variant. Use it to validate the algorithm before committing to live changes.

**Insights** — AI-generated. Two tiers: narrator observations (generation requires Starter+; Free plans can only view already-stored bullets) + advisor recommendations (Growth tier). Insights go stale after 6 hours. Always check `isStale` before presenting them.

**Layout stats** — per-persona section ordering driven by a bandit algorithm. `pulls` = times a layout was applied, `avgReward` = normalized conversion signal (not raw CVR).

## Auth

Server keys start with `sk_` — required for the management API. Public keys (`pk_`) are for the React SDK only and will be rejected. Key is scoped to the account; all owned projects are accessible.

## Tool Quick Reference

| Tool | Notes |
|------|-------|
| `list_projects` | Start here to get project IDs |
| `create_project` | Onboard a new user: creates a project + returns its `pk_` key. Needs an account login (OAuth) — refuses `sk_` project keys and demo tokens. Follow with `get_integration_guide` |
| `get_project_stats` | Health status + 24h event/session volume |
| `list_components` | Components + variant counts + impression totals |
| `get_variant_performance` | Per-(component, variant) rate with its n (converting / exposed sessions, range/from/to; default 7d), plus the server's evidence verdict on that windowed rate vs the component's baseline (`verdict`: ahead / behind / unclear; `verdictBasis` says window, or all_time on older APIs) and the all-time verdict as reliability (`evidenceState`, `reliabilityVerdict`). Only ahead/behind is a result; the preceding-window change is an untested descriptor |
| `get_persona_breakdown` | Cluster distribution + avg reliability per cluster |
| `get_goal_funnel` | Goal hit counts + per-variant all-time completion rates, each with its n and a low-sample flag (descriptive — no verdict) |
| `list_guardrail_events` | Auto-paused variants (last 24h) |
| `get_layout_stats` | Per-persona layout order + bandit pulls/reward |
| `get_insights` | Ranked measured findings (tier + sample, low-sample flagged; `limit`, default 10) + (Growth) AI narrations, which are unmeasured |
| `refresh_insights` | Async trigger — wait ~15s then call `get_insights` |
| `get_variant_brief` | **Start here to optimize a component.** Evidence-driven brief for writing a new CODE-NATIVE variant: each arm's rate with n and server evidence verdict, audience, measured findings for the component, evidence state (EMPTY / COLLECTING / DIRECTIONAL / DECIDED) + best-practice fallback, and code instructions |
| `create_variant` | Creates a no-code **managed text** DRAFT — user must activate in dashboard. Fallback only; not for code-native variants |
| `pause_variant` | Stops traffic; no MCP resume |
| `get_cell_matrix` | "Who sees what": per-(visitor type, region) generation state + traffic share. A missing cell = they see the original |
| `get_cell_detail` | One cell's generated option, its stored rationale, and a plain-language performance verdict |
| `generate_cell` | Queues async AI generation for one cell (also retries failed ones). Paid plan; check `get_cell_matrix` for progress |

## Canonical Workflows

**Diagnose a conversion drop**
1. `get_project_stats` — confirm events are flowing
2. `get_goal_funnel` — find which goals/variants are down
3. `get_variant_performance` — check each arm's rate with its n and the server's evidence verdict
4. `list_guardrail_events` — see if the guardrail fired
5. `refresh_insights` → wait 15s → `get_insights` — read AI summary

**Optimize a component with a new variant (code-native — recommended)**
1. `list_components` — confirm the component ID
2. `get_variant_brief` — pull per-arm evidence, audience, measured findings, evidence state, best-practice priors, and code instructions for that component
3. Find `<Adaptive id="...">` in the repo and add a new on-brand variant key to its `variants` map (and to the `AdaptiveRoot` `components` list if SSR). Match the project's existing components and design system.
4. Do **not** call `create_variant`. Commit, push, deploy — the variant auto-registers on the first assignment and goes live.
5. Optional: enable shadow mode (project-level, in dashboard settings — it applies to the whole project, not a single component) first to validate before serving.

The evidence state (from the brief) drives the change. It is keyed on the server's evidence tiers, never on a traffic count: only **DECIDED** (an arm reliably ahead of or behind the baseline, at the multiple-comparison-corrected strong bar) is a result to build on. **DIRECTIONAL** (early/moderate/inconclusive signals), **COLLECTING** (below the 100-visit floor per arm) and **EMPTY** all mean: apply the best-practice priors for the project's context type and make one conservative change. Never call an arm better or worse from its raw rate.

**Add a no-code managed text variant (fallback — text only, less powerful)**
1. `list_components` — confirm the component ID
2. `create_variant` with `content` — creates a managed text draft (generate the copy from `get_variant_brief` context)
3. Tell the user to activate it from the dashboard

**Understand the audience**
1. `get_persona_breakdown` — cluster sizes + reliability
2. `get_layout_stats` — what layout order each persona gets
3. `get_insights` — AI narrative on what changed

**Validate before going live (shadow mode)**
- Shadow mode is enabled/disabled in the dashboard (Project Settings)
- When ON: personalization runs silently, no live impact
- When confident: turn OFF to start serving personalized experiences

## Common Mistakes

- Presenting stale insights without checking `isStale` — always check, and offer to `refresh_insights`
- Assuming `create_variant` is live — it's always a draft
- Calling `create_variant` for a variant that's being written in code — it creates an empty managed draft, not your code variant. Code-native variants auto-register on deploy; only use `create_variant` for no-code/managed variants whose content lives in SentientUI
- Optimizing a component without calling `get_variant_brief` first — it gives you the per-arm evidence, audience, findings, and evidence-state fallback you need to write a variant that actually makes sense (and the right steps when there is no data yet)
- Ranking variants by raw conversion rate — a rate on 10 sessions is noise. Only a server `verdict` of ahead/behind is a comparison; every rate carries its n for this reason
- Calling `pause_variant` without warning the user it's irreversible via MCP
- Using a `pk_` key instead of `sk_` — it will be rejected
- Interpreting `avgReward` in layout stats as a conversion rate — it's a bandit reward signal, not CVR
