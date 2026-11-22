# SentientUI — AI Agent Guide

SentientUI is a UI personalization platform that assigns visitors to variant components and reorders page sections per persona. The MCP gives agents read + limited write access to project data.

## Key Concepts

**Audiences — and what makes each one serve.** When a visitor fits several, the order is declared › retargeting › discovered › campaign › arrival › everyone.

- **Everyone** (key `unknown`) — every visitor no other audience claims; usually most of the traffic.
- **Declared persona** (a bare key such as `developer`) — a role the site already knows, e.g. from sign-in. It serves **only on visits where the site declares it**: the `persona` prop on `<AdaptiveRoot>` / `<AdaptiveProvider>`, `init({ persona })` in `@sentientui/core`, or `window.sentient.persona` on the script tag (a string, or a function read once at start-up). The value must be exactly a key from the dashboard's Audiences → Personas list. Adding a persona there only names it: one the site never sends has no visitors, and versions written for it reach nobody. Undeclared visitors are never guessed into a declared persona — for anonymous traffic use campaigns, arrival types or discovered audiences.
- **Discovered audience** (`d-…`) — found in real behaviour; it serves only after it is promoted, which needs evidence that it wants something different.
- **Campaign, arrival type, retargeting group** (`c-…`, `a-…`, `r-…`) — visitors who arrived on a named campaign's link, arrived a certain way, or were moved into a retargeting group after a campaign. A version restricted to one of these ("Show to", `manage_tests` `restrict_versions`) is shown only to them. A declared persona cannot be a "Show to" target.
- **Behaviour groups** (`get_persona_breakdown` `behaviourGroups`) — visitors whose visit patterns look alike ("Behaviour group 2"). Reporting only: they are **not** personas or audiences, nothing is shown to them, and they are never named after an audience. `get_persona_breakdown` `personas` counts the audience each visit was actually **served as** — the same number as the Matrix share in `get_cell_matrix`.
- **Names never target.** A version's display name, or a key in code `variants`, does not choose who sees it. To give one audience one version every time, pin it (`manage_approvals` `pin`, or the dashboard's "Always show this to …"). Pinned visitors stop teaching the optimizer for that component.

**Hybrid components need Migrate first.** An `<Adaptive>` with children **and** `variants` whose id already ran a variants test keeps serving that old test. Generated or dashboard-written versions for it do not serve — even when approved — until it is migrated (dashboard Components → the component → Migrate…, or `manage_tests` `migrate_component`). Sentient migrates it by itself once the code's test has assigned nobody a version for 14 days. Check before you generate for one.

**Funnels need a source per step.** A funnel is an ordered list of goal ids, and every step must have something that sends it — a page-visit goal, a click or form goal, `useGoal` in the browser, or `trackServerGoal` from the backend. A step nothing sends never fills, and the funnel reads as broken. Join a component to a funnel with `<Adaptive id="…" funnel="<funnelId>">`.

**Server goals — the exact call.** From a route handler, server action or webhook only (it needs the secret key):

```ts
import { trackServerGoal } from '@sentientui/react/server'; // non-React backend: '@sentientui/core/server'

await trackServerGoal({
  serverKey: process.env.SENTIENT_SECRET_KEY!, // the project's sk_ key
  userId: user.id,      // the id the site identifies the visitor with, e.g. <AdaptiveRoot userId={user.id}>
  name: 'subscribed',   // the goal id, exactly as defined
  dedupeKey: user.id,   // your own id for this conversion; a retry counts once
});
```

In the visitor's own request, pass `sessionId: readSessionCookie(cookies, publicKey)` (same import) instead of `userId`. It resolves `'recorded'`, `'skipped_no_visitor'` or `'failed'` and never throws. There is no `sentientui.trackServerGoal(name, visitorId)` form.

**Variant** — a version of an adaptive component. There are **two kinds**, and the difference matters:

- **Code-native variants** are declared in the customer's code (`<Adaptive variants={{…}}>`). They **register automatically** the first time the SDK requests an assignment after deploy, and they go **live immediately** — there is no draft step and no `create_variant` call. Their content lives in the repo, not in SentientUI.
- **No-code / managed variants** have no code; their content is stored on the SentientUI API (dashboard WYSIWYG, `<AdaptiveText>`, or `create_variant`). These start as **draft** after `create_variant`; no traffic is assigned until one is activated — with `update_variant` (`status: active`) or from the dashboard. `update_variant` `status: draft` takes it back out of serving, and `delete_variant_draft` removes a draft entirely.

Only call `create_variant` for the no-code path. If the user is writing (or you are writing) the variant in code, do **not** call `create_variant` — deploying the code registers it.

**Guardrail** — automatic safety circuit that pauses a variant once its CVR is shown (anytime-valid bounds, checked every 5 minutes) to be more than the configured threshold below the best variant's. `list_guardrail_events` lists every variant a guardrail has paused that is still paused (`days` narrows it to recent pauses). `resume_variant` clears a pause — a guardrail pause or one from `pause_variant` — so check why the guardrail fired before resuming.

**Shadow mode** — project-level flag (toggled in dashboard settings). When ON: personalization is computed and logged but visitors receive the default layout/variant. Use it to validate the algorithm before committing to live changes.

**Insights** — AI-generated. Two tiers: narrator observations (`refresh_insights` needs Starter or higher and an editor/admin role, since each refresh is a paid model call; Free plans can only view already-stored bullets) + advisor recommendations (Growth tier). Insights go stale after 6 hours. Always check `isStale` before presenting them.

**Review mode** — project-level setting (dashboard). When ON, `generate_cell` output does not publish on its own: it waits in `list_cell_reviews` until `review_cell` approves (publishes) or rejects it. When OFF, a generated version publishes automatically once the worker writes it — `generate_cell` tells you which applies.

**Layout stats** — per-persona section ordering driven by a bandit algorithm. `pulls` = times a layout was applied, `avgReward` = normalized conversion signal (not raw CVR).

## Excluding your team and test sites

Visits marked **internal** still see your versions — so QA on staging keeps working — but never count in any report (People, conversions, the Matrix share, funnels) and never teach the optimizer. Reports and `get_traffic_breakdown` list them as **Your team / test sites**. They are set up in the dashboard under **Settings → Internal traffic**, four ways:

- **Internal sites** — switch on any allowed domain (staging, preview, `localhost`); every visit from it is internal. Only allowed domains can be chosen.
- **Team emails & domains** — `@example.com` for a whole team, `name@example.com` for one person. They match visitors the site identifies with their email: `identify(userId, { email })` (core, or `useSentient()` in React) or `window.SentientSnippet.identify(userId, { email })` on the script tag. The SDK sends a SHA-256 of the trimmed, lowercased address and its domain — never the address — and exact rules are stored as the same hash and shown masked.
- **Browser link** — `https://<site>/?sentient_internal=<token>` opened once marks that browser; `?sentient_internal=off` stops it. Rotating the link un-marks every browser.
- **Code flag** — `<AdaptiveRoot internal={…}>` / `<AdaptiveProvider internal>`, `init({ internal })` in `@sentientui/core`, or `window.sentient.internal` (a boolean, or a function read once at start-up). Example: `internal={user.email.endsWith('@example.com')}` — the email never leaves the site.

It applies from when it is turned on: earlier visits can't be separated, because which site a visit came from was not recorded before. A visit marked internal after it already trained (a late identify, a rule added later) drops out of every report on the next read but is not untrained. There is no report filter or IP rule. `get_internal_traffic_rules` reads the rules; `manage_settings` changes them (`set_internal_sites`, `add_internal_email`, `remove_internal_email`) when the project's Agent access allows Project settings.

## Auth

Server keys start with `sk_` — required for the management API, available on every plan including Free. Public keys (`pk_`) are for the React SDK only and will be rejected. An `sk_` key is scoped to **one project**: `list_projects` returns only that project and other project ids are refused. For several projects, connect by URL with an OAuth sign-in. `create_project` needs that OAuth login.

## Tool Quick Reference

Every write tool changes what real visitors see or what the project accepts — confirm with the user before calling one.

<!-- mcp-tools:start -->
| Tool | Access | Notes |
|------|--------|-------|
| `list_projects` | read | Start here to get project IDs (an `sk_` key sees only its own project) |
| `create_project` | write | Onboard a new user: creates a project + returns its `pk_` key. Needs an account login (OAuth) — refuses `sk_` project keys and demo tokens. Follow with `get_integration_guide` |
| `get_project_stats` | read | Health status + 24h events and People count. `agentCalls` counts calls to the `/v1/agent` API (all retained history) — not MCP tool calls. `rejectedOrigins` lists sustained domains being turned away (not allowed; count = minutes with traffic) |
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
| `get_persona_breakdown` | read | Visitors per audience they were served as (30 days, the Matrix share) + behaviour groups (not audiences) |
| `get_stage_breakdown` | read | E-commerce funnel stages: stage mix (observed vs hinted), arrival channel x stage, stage moves between visits, tested holdout lift per first-visit context and channel (the headline lift's always-valid test, all-time, alpha split over 23 series), versions per context with evidence (windowed, observational) |
| `get_known_people` | read | Known people: visitors split into new, returning and already past the main goal (one per person), first-time vs repeat main-goal conversions, and the stored known-people list by how each was learnt (reporting only) |
| `get_main_funnel` | read | The main funnel: people at each step on the way to the main goal — Arrived, the funnel's steps, the main goal — for new and returning visitors, with people who already converted left out, drop-off per step and step health |
| `get_page_groups` | read | Page groups: the site's pages in named groups, where each sits on the main funnel, and per group the people who viewed it, the components that live there (where they were actually shown), layouts served, plus site-wide components |
| `get_plan` | read | Sentient's plan: tests running (day and a status word per version), winners waiting for a decision, proposals with their reason and the versions that could be tested, and what was learned |
| `get_test` | read | One test: its versions, the people counted and how many reached the goal, a status word per version, and how it ended |
| `get_page_elements` | read | The elements the site check found (buttons, headlines, forms), each with the id manage_generation open_pr needs to send a change to your code |
| `get_needs_you` | read | Needs you: versions waiting for approval, failed work, winners to keep, changes with your developers (pull request, checks, review) and what just finished |
| `get_layout_stats` | read | Per-persona layout order + bandit pulls/reward (cumulative state, not windowed) |
| `get_insights` | read | Ranked measured findings (tier + sample, low-sample flagged; `limit`, default 10) + (Growth) AI narrations, which are unmeasured |
| `refresh_insights` | write | Async trigger — wait ~15s then call `get_insights`. Starter+ and an editor/admin role |
| `get_cell_matrix` | read | "Who sees what": per-(visitor type, region) generation state + traffic share. A missing cell = they see the original |
| `get_cell_detail` | read | One cell's generated option, its stored rationale, and a plain-language performance verdict |
| `generate_cell` | write | Queues async AI generation for one cell (also retries failed ones). Publishes automatically, or waits for `review_cell` when review mode is on. Free includes 5 generations/month |
| `list_cell_reviews` | read | Generated versions waiting for approval |
| `review_cell` | write | Approve (publishes to live traffic) or reject one waiting version |
| `get_agent_traffic` | read | AI crawlers / automated browser sessions / agent API callers reading the site (windowed; paid plans) |
| `get_traffic_breakdown` | read | Where traffic came from: People vs visitors we couldn't confirm vs automated vs your team / test sites (windowed) |
| `get_internal_traffic_rules` | read | How the project keeps its team and test sites out of its numbers: internal sites, team email domains and masked emails, browser link, sessions marked internal (7 days) |
| `get_site_areas` | read | Which parts of the site are before sign-up (anonymous visitors to convert) and after (inside the product), with each site's signed-in share and a suggested side |
| `get_agent_legibility` | read | Whether agent-read pages are machine-legible, with fixes (paid plans) |
| `get_agent_access` | read | Which areas a person has allowed agents to change (read this before a write; only a person can change it) |
| `list_campaigns` | read | Named campaigns, retargeting groups and campaigns seen in traffic; with `campaignId`, one campaign card, including its verdict against the control group (Helping / Hurting / Not proven yet, with a range) |
| `get_retargeting_report` | read | One retargeting group: who came back, clicks, conversions |
| `get_audiences` | read | Declared and discovered audiences with evidence, and what blocks promotion |
| `get_site_styles` | read | Captured site styles per role, whether colors were measured, last scan, audit score |
| `get_region_history` | read | A region's published versions and whether it is still found on the live page |
| `manage_generation` | write | Generate and edit written versions: queue generation, auto-fill, rewrite depth, regions, campaign versions, pull requests (Generate area) |
| `manage_approvals` | write | Approve or reject generated versions, require approval, publish, roll back or pin a region version, promote a variant, keep a test's winner (Approve and publish area) |
| `manage_tests` | write | Propose, start, stop or skip a test and turn down a winner; archive or restore components and regions, lift guardrail pauses, proof window, observation-only mode, restrict versions by context (Run tests area) |
| `manage_goals` | write | Edit, publish or archive goals and funnels, set a goal role, confirm or dismiss discovered goals and goal-name warnings (Goals and funnels area) |
| `manage_campaigns` | write | Campaigns, retargeting and audiences: create, update, promote or roll back, plus stage and search settings (Campaigns and audiences area) |
| `manage_settings` | write | Project settings: edit the project, origins, webhooks, site styles, report shares, previews, models, test events, who counts as already converted (gate setting, import of known people) (Project settings area); accept, dismiss or save a structured insight is always allowed |
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
1. `get_audiences` — declared and discovered audiences, and what blocks promotion
2. `get_cell_matrix` — each audience's served share and what it sees (a declared persona at 0% is one the site never declares)
3. `get_persona_breakdown` — who was served as which audience (the Matrix share), and, apart, behaviour groups (descriptive, never audiences)
4. `get_layout_stats` — what layout order each persona gets
5. `get_insights` — AI narrative on what changed

**"Why doesn't audience X see its version?"**
1. `get_cell_matrix` — is X's share 0? A declared persona the site never sends has no visitors: give the user the declaration line for their setup (see Audiences above)
2. Is the component a hybrid with an old variants test? Its new versions wait for `migrate_component`
3. Is the version waiting for approval (`list_cell_reviews`) or restricted to a campaign?

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
- Reporting a behaviour group as an audience's visitors — behaviour groups are not personas; an audience's visitors are `get_persona_breakdown` `personas` (= the Matrix share)
- Expecting a declared persona to serve because it is in the vocabulary — the site has to declare it on the visit
- Naming a version (or a code `variants` key) after an audience and expecting it to target them — pin it instead
- Generating versions for a hybrid component that still has its old variants test — nothing serves until `migrate_component`
- Building a funnel over goal ids nothing sends — every step needs a source
- Writing any other call shape for server goals than the `trackServerGoal({ … })` block above
- Telling a user to filter staging or team traffic out of a report — there is no report filter or IP rule; point them to Settings → Internal traffic (it applies from when it is turned on), and read the current rules with `get_internal_traffic_rules`
