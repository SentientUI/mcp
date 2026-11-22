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

Dashboard → Project → **Settings → API key → Server key** → Generate, and copy it right away — it is shown only once. Available on every plan, including Free. A server key belongs to **one project**: it can read and change only that project, and generating a new one revokes the previous key (except keys held by a connected Shopify store).

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
| `get_project_stats` | read | Ingestion health: status, 24h events and People (with how many are being analysed or automated), and calls to the `/v1/agent` API (`agentCalls` — not MCP tool calls), plus sustained domains the snippet runs on that are turned away (not allowed) |
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
| `get_persona_breakdown` | read | Visitors per audience they were served as (30 days — the Matrix share), plus behaviour groups (visitors who behaved alike — never audiences) |
| `get_stage_breakdown` | read | E-commerce funnel stages: stage mix, arrival channel x stage, stage moves between visits, tested holdout lift per first-visit context and channel (all-time), and versions per context (windowed, observational) |
| `get_known_people` | read | Known people: visitors split into new, returning and already past the main goal (one per person), first-time vs repeat main-goal conversions, and the stored known-people list by how each was learnt (reporting only) |
| `get_main_funnel` | read | The main funnel: people at each step on the way to the main goal — Arrived, the funnel's steps, the main goal — for new and returning visitors, with people who already converted left out, drop-off per step and step health |
| `get_page_groups` | read | Page groups: the site's pages in named groups, where each sits on the main funnel, and per group the people who viewed it, the components that live there (where they were actually shown), layouts served, plus site-wide components |
| `get_plan` | read | Sentient's plan: tests running (day and a status word per version), winners waiting for a decision, proposals with their reason and the versions that could be tested, and what was learned |
| `get_test` | read | One test: its versions, the people counted and how many reached the goal, a status word per version, and how it ended |
| `get_page_elements` | read | The elements the site check found (buttons, headlines, forms), each with the id manage_generation open_pr needs to send a change to your code |
| `get_needs_you` | read | Needs you: versions waiting for approval, failed work, winners to keep, changes with your developers (pull request, checks, review) and what just finished |
| `get_layout_stats` | read | Per-persona section order with bandit pulls and reward (cumulative state) |
| `get_insights` | read | Ranked measured findings with their sample (low samples flagged), plus AI narrations marked unmeasured |
| `refresh_insights` | write | Regenerate AI insights — needs Starter or higher and an editor/admin role (a paid model call); advisor recommendations are Growth+ |
| `get_cell_matrix` | read | The "Who sees what" matrix of generated versions per visitor type and region |
| `get_cell_detail` | read | One cell's generated version, why it was written, and how it performs |
| `generate_cell` | write | Queue AI generation for one cell — publishes automatically, or waits for approval when review mode is on (Free includes 5 generations/month) |
| `list_cell_reviews` | read | Generated versions waiting for approval (review mode) |
| `review_cell` | write | Approve (publish) or reject one generated version waiting for review |
| `get_agent_traffic` | read | Which AI crawlers, automated browser sessions and agent API callers read the site (windowed; paid plans) |
| `get_traffic_breakdown` | read | Where traffic came from: People vs visitors we couldn't confirm vs automated vs your team / test sites (windowed) |
| `get_internal_traffic_rules` | read | How the project keeps its team and test sites out of its numbers: internal sites, team email domains and masked emails, browser link, sessions marked internal (7 days) |
| `get_site_areas` | read | Which parts of the site are before sign-up (anonymous visitors to convert) and after (inside the product), with each site's signed-in share and a suggested side |
| `get_agent_legibility` | read | Whether the pages agents read are machine-legible, with fixes (paid plans) |
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
| `get_integration_guide` | read | SDK setup guide (static — same for every project) |
<!-- mcp-tools:end -->

> **Write tools ask first.** Every write tool changes what real visitors see or what the project accepts, so an assistant should confirm with you before calling one. The common ones are reversible: `pause_variant` → `resume_variant`, `retire_variant` → `restore_variant`, `update_variant` `status: active` → `status: draft`.
>
> **Generated versions.** An `<Adaptive id="…">` that wraps your original as children (no `variants`) registers as a personalizable region once it is mounted and deployed. Its versions per visitor type are written in SentientUI — inspect and fill them with `get_cell_matrix`, `get_cell_detail`, and `generate_cell` — with no code change or redeploy. When the project has review mode on, a generated version waits in `list_cell_reviews` until `review_cell` approves it.
>
> **Which audiences actually serve.** A *declared* persona serves only on visits where your site declares it (`persona` prop on `<AdaptiveRoot>` / `<AdaptiveProvider>`, `init({ persona })`, or `window.sentient.persona`) — adding it to the vocabulary only names it. A *discovered* audience serves once it is promoted. *Campaigns*, arrival types and retargeting groups reach visitors by how they arrived, which is how to reach anonymous traffic. `get_persona_breakdown` counts the audience each visit was actually served as (the Matrix share); its `behaviourGroups` are descriptive groups of similar behaviour, not personas — never read one as an audience's visitors. A version's name never targets anyone — pin it to an audience instead. Pinned visitors stop teaching the optimizer for that component.
>
> **Hybrid components need Migrate.** An `<Adaptive>` with children *and* `variants` whose id already ran a variants test keeps serving that test; generated versions for it do not serve until it is migrated (`manage_tests` `migrate_component`, or Migrate… in the dashboard) — automatic once the code's test has assigned nobody a version for 14 days.
>
> **Funnels and server goals.** Every funnel step needs something that sends it. For a step your backend confirms, the call is `trackServerGoal({ serverKey, userId, name, dedupeKey })` from `@sentientui/react/server` (or `@sentientui/core/server`) — see `AGENTS.md` for the exact block.
>
> **Code-native vs no-code variants.** Variants you declare in your app (`<Adaptive variants={{…}}>`) register automatically the first time the SDK requests an assignment after you deploy — they go live immediately and need **no** `create_variant` call. Use `create_variant` only for **no-code** variants whose content is stored in SentientUI and rendered without a code change; these start as drafts — activate one with `update_variant` (`status: active`) or from the dashboard.
>
> **Optimizing a component?** Call `get_variant_brief` first. It returns each variant's rate with its sample and the server's evidence verdict, the audience, measured findings, and an evidence-state assessment — then your AI assistant writes a new on-brand variant directly into your code (which auto-registers on deploy). While nothing is decided, the brief falls back to best-practice priors for your project's context type so the assistant still makes a sensible change.

## In-chat views (MCP Apps)

Hosts that support [MCP Apps](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) (extension `io.modelcontextprotocol/ui`, spec 2026-01-26) render an interactive view in the chat for these tools; other hosts use the tool's normal text output.

- `get_persona_breakdown`, `get_variant_performance`, `get_goal_funnel`, `get_layout_stats` — charts.
- `list_cell_reviews` — the versions waiting for approval: each one's text or section outline, its audience and page, with **Approve** and **Reject** (with a reason) buttons.

The buttons call `review_cell_from_view`, a twin of `review_cell` marked `_meta.ui.visibility: ["app"]`, so the host keeps it out of the agent's tool list; agents keep using `review_cell`. That flag is enforced by the host, not this server. Either way, approving and rejecting are allowed only when the project's **Approve and publish** Agent access switch is on. The views load nothing from the network; the in-site preview stays in the dashboard (it needs a sign-in the chat does not have).

## Excluding your team and test sites

Visits marked **internal** still see your versions — so QA on staging keeps working — but never count in any report (People, conversions, the Matrix share, funnels) and never teach the optimizer. Reports and `get_traffic_breakdown` list them as **Your team / test sites**. They are set up in the dashboard under **Settings → Internal traffic**, four ways:

- **Internal sites** — switch on any allowed domain (staging, preview, `localhost`); every visit from it is internal. Only allowed domains can be chosen.
- **Team emails & domains** — `@example.com` for a whole team, `name@example.com` for one person. They match visitors the site identifies with their email: `identify(userId, { email })` (core, or `useSentient()` in React) or `window.SentientSnippet.identify(userId, { email })` on the script tag. The SDK sends a SHA-256 of the trimmed, lowercased address and its domain — never the address — and exact rules are stored as the same hash and shown masked.
- **Browser link** — `https://<site>/?sentient_internal=<token>` opened once marks that browser; `?sentient_internal=off` stops it. Rotating the link un-marks every browser.
- **Code flag** — `<AdaptiveRoot internal={…}>` / `<AdaptiveProvider internal>`, `init({ internal })` in `@sentientui/core`, or `window.sentient.internal` (a boolean, or a function read once at start-up). Example: `internal={user.email.endsWith('@example.com')}` — the email never leaves the site.

It applies from when it is turned on: earlier visits can't be separated, because which site a visit came from was not recorded before. A visit marked internal after it already trained (a late identify, a rule added later) drops out of every report on the next read but is not untrained. There is no report filter or IP rule. `get_internal_traffic_rules` reads the rules; `manage_settings` changes them (`set_internal_sites`, `add_internal_email`, `remove_internal_email`) when the project's Agent access allows Project settings.

## Example prompts

The whole loop — setup, goals, versions, pull requests, tests — can run from your agent. The tool-by-tool order is in [Run Sentient from your agent](https://sentient-ui.com/docs#run-from-agent).


- *"What projects do I have?"*
- *"Show me the CVR trends for the hero banner this week"*
- *"Are any variants paused by the guardrail right now?"*
- *"What do the AI insights say about what changed this week?"*
- *"Refresh insights for project X"*
- *"Optimize my hero CTA — pull the brief and add a new variant in the code"*
- *"Create a new variant called 'short-copy' for the pricing CTA"*
- *"What should we test next? Start it with the shorter version."*
- *"Is anything waiting for me? How is our pull request doing?"*

## Configuration

| Environment variable | Default | Description |
|----------------------|---------|-------------|
| `SENTIENTUI_API_KEY` | — | Your `sk_...` server key. Required (or demo mode activates). |
| `SENTIENTUI_API_URL` | `https://api.sentient-ui.com` | Override for staging or a custom API endpoint. |

## Auth model

The server key you provide is passed as a `Bearer` token on every call to the SentientUI management API. It is scoped to **one project**: `list_projects` returns only that project, and calls naming any other project are refused. To work across several projects, connect by URL with an OAuth sign-in instead. Keys are never logged or stored by the MCP package; they exist only in the process environment.

Server keys start with `sk_` (not `pk_`). Public keys (`pk_`) are for the browser SDKs (React, core, the script-tag snippet) and will be rejected by the management API.

## AI agent context

`AGENTS.md` (included in this package) gives your AI assistant deeper context about SentientUI concepts, tool ordering, and common pitfalls. Wire it up once and it applies to every conversation.

| Assistant | How to use |
|-----------|-----------|
| **Claude Code** | Append to your project's `CLAUDE.md` (or `~/.claude/CLAUDE.md` for every project) |
| **Cursor** | Copy to `.cursor/rules/sentientui.mdc` |
| **GitHub Copilot** | Append to `.github/copilot-instructions.md` |
| **Other** | Paste into your assistant's system prompt |

## Requirements

- Node.js 18+
- A SentientUI account (or use demo mode)
