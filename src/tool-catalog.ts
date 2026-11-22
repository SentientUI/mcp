// The ONE list of tools this server registers, with the one-line summary every
// human-facing surface should use. Before this existed the list was retyped by
// hand in five places (docs/mcp-setup.md, this package's README and AGENTS.md,
// the served llms.txt, the server card) and they had drifted to 16/17/17/20/24
// tools — agents reading llms.txt never learned the cell tools existed, and the
// README promised a resume tool that was not there. server.test.ts asserts the
// registered set equals this list (and that `access` matches each tool's
// readOnlyHint); apps/api's mcp-tool-surfaces test asserts every monorepo doc
// surface lists exactly these names. Add a tool here first, or both fail.

export type ToolAccess = 'read' | 'write';

export type ToolCatalogEntry = {
  name: string;
  access: ToolAccess;
  summary: string;
};

export const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  // Projects
  { name: 'list_projects', access: 'read', summary: 'List the projects this credential can see (an sk_ key sees only its own project)' },
  { name: 'create_project', access: 'write', summary: 'Create a project and return its pk_ public key (account login only — not an sk_ key or demo token)' },
  { name: 'get_project_stats', access: 'read', summary: 'Ingestion health: status, 24h events and sessions, and /v1/agent API calls' },
  { name: 'add_origin', access: 'write', summary: "Allow-list a site origin so the SDK's events from it are accepted" },
  // Components and variants
  { name: 'list_components', access: 'read', summary: 'Adaptive components with variant counts and impressions' },
  { name: 'get_variant_performance', access: 'read', summary: "Per-(component, variant) rates with their n and the server's evidence verdict vs the baseline" },
  { name: 'get_variant_brief', access: 'read', summary: 'Evidence-driven brief for writing a new code-native variant' },
  { name: 'get_test_brief', access: 'read', summary: "Ready-to-paste test code that forces one of a component's real variants" },
  { name: 'create_variant', access: 'write', summary: 'Create a no-code managed text variant as a draft' },
  { name: 'update_variant', access: 'write', summary: "Edit a managed variant's name or text, or activate a draft (status active) / move it back to draft" },
  { name: 'delete_variant_draft', access: 'write', summary: 'Delete a managed variant that is still a draft' },
  { name: 'pause_variant', access: 'write', summary: 'Pause a variant so no new traffic is assigned to it (undo with resume_variant)' },
  { name: 'resume_variant', access: 'write', summary: 'Resume a paused variant — manual or guardrail pause' },
  { name: 'retire_variant', access: 'write', summary: 'Retire (archive) an active variant (undo with restore_variant)' },
  { name: 'restore_variant', access: 'write', summary: 'Bring a retired variant back to active' },
  // Goals, funnels, guardrails
  { name: 'get_goal_funnel', access: 'read', summary: 'Per-goal conversion summary (windowed) with descriptive all-time per-variant rates — not a step funnel (see get_funnel_report)' },
  { name: 'list_goals', access: 'read', summary: 'Defined goals (id, role, event, status), including ones with no conversions yet' },
  { name: 'define_goal', access: 'write', summary: 'Create a new goal — never overwrites an existing goal and never changes the primary goal' },
  { name: 'list_funnels', access: 'read', summary: 'Defined multi-step funnels' },
  { name: 'get_funnel_report', access: 'read', summary: 'Step-by-step funnel drop-off' },
  { name: 'list_guardrail_events', access: 'read', summary: 'Every variant currently paused by a guardrail (optionally only pauses from the last N days)' },
  // Audience and layout
  { name: 'get_persona_breakdown', access: 'read', summary: 'Visitors per audience they were served as (30 days, the Matrix share), plus behaviour groups — visitors who behaved alike, never audiences' },
  { name: 'get_stage_breakdown', access: 'read', summary: 'E-commerce funnel stages: stage mix, arrival channel x stage, stage moves between visits, tested holdout lift per first-visit context and channel, and versions per context (windowed, observational)' },
  { name: 'get_known_people', access: 'read', summary: 'Known people: visitors split into new, returning and already past the main goal (one per person), first-time vs repeat main-goal conversions, and the stored known-people list by how each was learnt (reporting only)' },
  { name: 'get_main_funnel', access: 'read', summary: "The main funnel: people at each step on the way to the main goal — Arrived, the funnel's steps, the main goal — for new and returning visitors, with people who already converted left out, drop-off per step and step health" },
  { name: 'get_page_groups', access: 'read', summary: "Page groups: the site's pages in named groups, where each sits on the main funnel, and per group the people who viewed it, the components that live there (where they were actually shown), layouts served, plus site-wide components" },
  { name: 'get_plan', access: 'read', summary: "Sentient's plan: tests running (day and a status word per version), winners waiting for a decision, proposals with their reason and the versions that could be tested, and what was learned" },
  { name: 'get_test', access: 'read', summary: 'One test: its versions, the people counted and how many reached the goal, a status word per version, and how it ended' },
  { name: 'get_page_elements', access: 'read', summary: 'The elements the site check found (buttons, headlines, forms), each with the id manage_generation open_pr needs to send a change to your code' },
  { name: 'get_needs_you', access: 'read', summary: 'Needs you: versions waiting for approval, failed work, winners to keep, changes with your developers (pull request, checks, review) and what just finished' },
  { name: 'get_layout_stats', access: 'read', summary: 'Per-persona section order with bandit pulls and reward (cumulative state)' },
  // Insights
  { name: 'get_insights', access: 'read', summary: 'Ranked measured findings with their sample, plus AI narrations marked unmeasured' },
  { name: 'refresh_insights', access: 'write', summary: 'Regenerate AI insights (Starter+ and an editor/admin role; a paid model call)' },
  // Generated versions (persona x slot cells)
  { name: 'get_cell_matrix', access: 'read', summary: 'The "Who sees what" matrix of generated versions per visitor type and region' },
  { name: 'get_cell_detail', access: 'read', summary: "One cell's generated version, why it was written, and how it performs" },
  { name: 'generate_cell', access: 'write', summary: 'Queue AI generation for one cell — publishes automatically, or waits for approval when review mode is on' },
  { name: 'list_cell_reviews', access: 'read', summary: 'Generated versions waiting for approval (review mode)' },
  { name: 'review_cell', access: 'write', summary: 'Approve (publish) or reject one generated version waiting for review' },
  // Agent traffic
  { name: 'get_agent_traffic', access: 'read', summary: 'Which AI crawlers, automated browser sessions and agent API callers read the site (windowed)' },
  { name: 'get_traffic_breakdown', access: 'read', summary: 'Where traffic came from: People vs visitors we could not confirm vs automated vs your team / test sites (windowed)' },
  { name: 'get_internal_traffic_rules', access: 'read', summary: 'How the project keeps its team and test sites out of its numbers: internal sites, team email domains and masked emails, browser link, sessions marked internal (7 days)' },
  { name: 'get_site_areas', access: 'read', summary: 'Which parts of the site are before sign-up (anonymous visitors to convert) and after (inside the product), with each site\'s signed-in share and a suggested side' },
  { name: 'get_agent_legibility', access: 'read', summary: 'Whether the pages agents read are machine-legible, with fixes' },
  // Agent access reads
  { name: 'get_agent_access', access: 'read', summary: "Which areas a person has allowed agents to change in this project (Generate, Approve and publish, Run tests, Goals and funnels, Campaigns and audiences, Project settings)" },
  { name: 'list_campaigns', access: 'read', summary: "Named campaigns, retargeting groups and campaigns seen in traffic; with campaignId, one campaign's card (clicks, people, conversions, control group, and its verdict against the control group: Helping / Hurting / Not proven yet with a range)" },
  { name: 'get_retargeting_report', access: 'read', summary: "One retargeting group's numbers: who came back, clicks, conversions" },
  { name: 'get_audiences', access: 'read', summary: "Declared and discovered audiences with evidence, and what blocks promoting the discovered set" },
  { name: 'get_site_styles', access: 'read', summary: "Captured site styles per role, whether colors were measured, last scan, and site audit score" },
  { name: 'get_region_history', access: 'read', summary: "A region's published versions over time and whether it is still found on the live page" },
  // Agent access writes (one tool per area; each action is one mgmt route)
  { name: 'manage_generation', access: 'write', summary: 'Generate and edit written versions: queue generation, auto-fill, rewrite depth, regions, campaign versions, pull requests (Generate area)' },
  { name: 'manage_approvals', access: 'write', summary: "Approve or reject generated versions, require approval, publish, roll back or pin a region version, promote a variant, keep a test's winner (Approve and publish area)" },
  { name: 'manage_tests', access: 'write', summary: 'Propose, start, stop or skip a test and turn down a winner; archive or restore components and regions, lift guardrail pauses, proof window, observation-only mode, restrict versions by context (Run tests area)' },
  { name: 'manage_goals', access: 'write', summary: 'Edit, publish or archive goals and funnels, set a goal role, confirm or dismiss discovered goals and goal-name warnings (Goals and funnels area)' },
  { name: 'manage_campaigns', access: 'write', summary: 'Campaigns, retargeting and audiences: create, update, promote or roll back, plus stage and search settings (Campaigns and audiences area)' },
  { name: 'manage_settings', access: 'write', summary: 'Project settings: edit the project, origins, webhooks, site styles, report shares, previews, models, test events, who counts as already converted (gate setting, import of known people) (Project settings area); accept, dismiss or save a structured insight is always allowed' },
  // Setup
  { name: 'get_integration_guide', access: 'read', summary: 'SDK setup guide (static — same for every project)' },
];

export const TOOL_NAMES: readonly string[] = TOOL_CATALOG.map((t) => t.name);

// Tools a view's buttons call and the agent is not meant to (MCP Apps
// `_meta.ui.visibility: ["app"]`). Kept OUT of TOOL_CATALOG on purpose: that
// list is what every doc surface tells agents they can call, and a spec host
// leaves these out of the agent's tool list. server.test.ts asserts the
// registry is exactly both lists together, and that each of these is marked
// app-only while no TOOL_CATALOG tool is — so an agent-facing tool can never
// be hidden from agents by accident. Visibility is host-enforced, not a
// server guarantee; see appOnlyToolMeta in ui/index.ts.
export const APP_ONLY_TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  { name: 'review_cell_from_view', access: 'write', summary: "The review view's Approve / Reject buttons (same effect and checks as review_cell)" },
];

export const APP_ONLY_TOOL_NAMES: readonly string[] = APP_ONLY_TOOL_CATALOG.map((t) => t.name);
