# SentientUI — AI Agent Guide

SentientUI is a UI personalization platform that assigns visitors to variant components and reorders page sections per persona. The MCP gives agents read + limited write access to project data.

## Key Concepts

**Persona / Cluster** — visitors are clustered by behavior into labeled groups. A `reliability_score` (0–1) measures confidence in the assignment. Low reliability means the engine won't personalize for that session even if a cluster is assigned.

**Variant** — a version of an adaptive component. There are **two kinds**, and the difference matters:

- **Code-native variants** are declared in the customer's code (`<Adaptive variants={{…}}>`). They **register automatically** the first time the SDK requests an assignment after deploy, and they go **live immediately** — there is no draft step and no `create_variant` call. Their content lives in the repo, not in SentientUI.
- **No-code / managed variants** have no code; their content is stored on the SentientUI API (dashboard WYSIWYG, `<AdaptiveText>`, or `create_variant`). These start as **draft** after `create_variant`; no traffic is assigned until one is activated — with `update_variant` (`status: active`) or from the dashboard. `update_variant` `status: draft` takes it back out of serving, and `delete_variant_draft` removes a draft entirely.

Only call `create_variant` for the no-code path. If the user is writing (or you are writing) the variant in code, do **not** call `create_variant` — deploying the code registers it.

**Guardrail** — automatic safety circuit that pauses a variant once its CVR is shown (anytime-valid bounds, checked every 5 minutes) to be more than the configured threshold below the best variant's. `list_guardrail_events` lists every variant a guardrail has paused that is still paused (`days` narrows it to recent pauses). `resume_variant` clears a pause — a guardrail pause or one from `pause_variant` — so check why the guardrail fired before resuming.

**Shadow mode** — project-level flag (toggled in dashboard settings). When ON: personalization is computed and logged but visitors receive the default layout/variant. Use it to validate the algorithm before committing to live changes.

**Insights** — AI-generated. Two tiers: narrator observations (`refresh_insights` needs Starter or higher and an editor/admin role, since each refresh is a paid model call; Free plans can only view already-stored bullets) + advisor recommendations (Growth tier). Insights go stale after 6 hours. Always check `isStale` before presenting them.

**Review mode** — project-level setting (dashboard). When ON, `generate_cell` output does not publish on its own: it waits in `list_cell_reviews` until `review_cell` approves (publishes) or rejects it. When OFF, a generated version publishes automatically once the worker writes it — `generate_cell` tells you which applies.

**Layout stats** — per-persona section ordering driven by a bandit algorithm. `pulls` = times a layout was applied, `avgReward` = normalized conversion signal (not raw CVR).

## Auth

Server keys start with `sk_` — required for the management API, available on every plan including Free. Public keys (`pk_`) are for the React SDK only and will be rejected. An `sk_` key is scoped to **one project**: `list_projects` returns only that project and other project ids are refused. For several projects, connect by URL with an OAuth sign-in. `create_project` needs that OAuth login.

## Tool Quick Reference

Every write tool changes what real visitors see or what the project accepts — confirm with the user before calling one.

<!-- mcp-tools:start -->
| Tool | Access | Notes |
|------|--------|-------|
| `list_projects` | read | Start here to get project IDs (an `sk_` key sees only its own project) |
| `create_project` | write | Onboard a new user: creates a project + returns its `pk_` key. Needs an account login (OAuth) — refuses `sk_` project keys and demo tokens. Follow with `get_integration_guide` |
| `get_project_stats` | read | Health status + 24h event/session volume. `agentCalls` counts calls to the `/v1/agent` API (all retained history) — not MCP tool calls |
| `add_origin` | write | Allow-list a site origin so the SDK's events from it are accepted. Idempotent |
| `list_components` | read | Components + variant counts + impression totals |
| `get_variant_performance` | read | Per-(component, variant) rate with its n (converting / exposed sessions, range/from/to; default 7d), plus the server's evidence verdict on that windowed rate vs the component's baseline (`verdict`: ahead / behind / unclear; `verdictBasis` says window, or all_time on older APIs) and the all-time verdict as reliability (`evidenceState`, `reliabilityVerdict`). Only ahead/behind is a result; the preceding-window change is an untested descriptor |
| `get_variant_brief` | read | **Start here to optimize a component.** Evidence-driven brief for writing a new CODE-NATIVE variant: each arm's rate with n and server evidence verdict, audience, measured findings for the component, evidence state (EMPTY / COLLECTING / DIRECTIONAL / DECIDED) + best-practice fallback, and code instructions |
| `get_test_brief` | read | Ready-to-paste test code that forces one of a component's real variants |
| `create_variant` | write | Creates a no-code **managed text** DRAFT. Fallback only; not for code-native variants |
| `update_variant` | write | Managed variants only: rename, change text, or `status: active` (starts serving) / `status: draft` (stops) |
| `delete_variant_draft` | write | Deletes a managed variant that is still a draft |
| `pause_variant` | write | Stops new traffic to a variant. Undo with `resume_variant` |
| `resume_variant` | write | Clears a pause — manual or guardrail |
| `retire_variant` | write | Archives an active variant (409 if it is the promoted one — unpromote first). Undo with `restore_variant` |
| `restore_variant` | write | Brings a retired variant back to active. Does not unpause it |
| `get_goal_funnel` | read | Per-goal conversion summary (windowed) + descriptive per-variant all-time completion rates, each with its n and a low-sample flag (descriptive — no verdict). Not a step funnel; for drop-off use `get_funnel_report` |
| `list_goals` | read | Defined goals, including ones with no conversions yet |
| `define_goal` | write | Create a new goal. Create-only: an existing id (even archived) is refused, and it never sets or changes the primary goal — that stays a dashboard decision |
| `list_funnels` | read | Defined multi-step funnels |
| `get_funnel_report` | read | Step-by-step funnel drop-off |
| `list_guardrail_events` | read | Every variant still paused by a guardrail; `days` narrows to recent pauses |
| `get_persona_breakdown` | read | Cluster distribution + avg reliability per cluster (all retained sessions, not windowed) |
| `get_layout_stats` | read | Per-persona layout order + bandit pulls/reward (cumulative state, not windowed) |
| `get_insights` | read | Ranked measured findings (tier + sample, low-sample flagged; `limit`, default 10) + (Growth) AI narrations, which are unmeasured |
| `refresh_insights` | write | Async trigger — wait ~15s then call `get_insights`. Starter+ and an editor/admin role |
| `get_cell_matrix` | read | "Who sees what": per-(visitor type, region) generation state + traffic share. A missing cell = they see the original |
| `get_cell_detail` | read | One cell's generated option, its stored rationale, and a plain-language performance verdict |
| `generate_cell` | write | Queues async AI generation for one cell (also retries failed ones). Publishes automatically, or waits for `review_cell` when review mode is on. Free includes 5 generations/month |
| `list_cell_reviews` | read | Generated versions waiting for approval |
| `review_cell` | write | Approve (publishes to live traffic) or reject one waiting version |
| `get_agent_traffic` | read | AI crawlers / agentic browsers / agent API callers reading the site (windowed; paid plans) |
| `get_agent_legibility` | read | Whether agent-read pages are machine-legible, with fixes (paid plans) |
| `get_integration_guide` | read | SDK setup guide (static) |
<!-- mcp-tools:end -->

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

The evidence state (from the brief) drives the change. It is keyed on the server's evidence tiers, never on a traffic count: only **DECIDED** (an arm reliably ahead of or behind the baseline, at the multiple-comparison-corrected strong bar) is a result to build on. **DIRECTIONAL** (early/moderate/likely-worse/inconclusive signals — likely-worse means probably behind the baseline, wrong about one time in five, so do not build on that arm but do not treat it as decided either), **COLLECTING** (below the 100-visit floor per arm) and **EMPTY** all mean: apply the best-practice priors for the project's context type and make one conservative change. Never call an arm better or worse from its raw rate.

**Add a no-code managed text variant (fallback — text only, less powerful)**
1. `list_components` — confirm the component ID
2. `create_variant` with `content` — creates a managed text draft (generate the copy from `get_variant_brief` context)
3. Show the user the draft; once they confirm, `update_variant` with `status: active` starts serving it (or they activate it from the dashboard)

**Pause, and undo a pause**
1. Confirm with the user before `pause_variant` — it stops new traffic immediately
2. `resume_variant` puts it back; for a guardrail pause, check `list_guardrail_events` and the variant's evidence first — the guardrail fired for a reason

**Fill generated versions**
1. `get_cell_matrix` — which (visitor type, region) cells are empty
2. Confirm with the user, then `generate_cell` — the result says whether the project auto-publishes or uses review mode
3. Review mode: `list_cell_reviews`, show the user the version, then `review_cell` with `approve` or `reject`

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
- Assuming `create_variant` is live — it's always a draft until `update_variant` sets `status: active`
- Calling `create_variant` for a variant that's being written in code — it creates an empty managed draft, not your code variant. Code-native variants auto-register on deploy; only use `create_variant` for no-code/managed variants whose content lives in SentientUI
- Optimizing a component without calling `get_variant_brief` first — it gives you the per-arm evidence, audience, findings, and evidence-state fallback you need to write a variant that actually makes sense (and the right steps when there is no data yet)
- Ranking variants by raw conversion rate — a rate on 10 sessions is noise. Only a server `verdict` of ahead/behind is a comparison; every rate carries its n for this reason
- Calling any write tool (`pause_variant`, `retire_variant`, `update_variant`, `review_cell`, …) without the user's confirmation — they change what real visitors see
- Resuming a guardrail-paused variant without checking why the guardrail fired
- Using `restore_variant` to activate a draft — it is for retired variants; activate drafts with `update_variant` `status: active`
- Using a `pk_` key instead of `sk_` — it will be rejected
- Interpreting `avgReward` in layout stats as a conversion rate — it's a bandit reward signal, not CVR
