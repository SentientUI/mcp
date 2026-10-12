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
  { name: 'get_persona_breakdown', access: 'read', summary: 'Visitor clusters with session counts and reliability (all retained sessions)' },
  { name: 'get_stage_breakdown', access: 'read', summary: 'E-commerce funnel stages: stage mix, arrival channel x stage, stage moves between visits, tested holdout lift per first-visit context and channel, and versions per context (windowed, observational)' },
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
  { name: 'get_agent_traffic', access: 'read', summary: 'Which AI crawlers, agentic browsers and agent API callers read the site (windowed)' },
  { name: 'get_agent_legibility', access: 'read', summary: 'Whether the pages agents read are machine-legible, with fixes' },
  // Setup
  { name: 'get_integration_guide', access: 'read', summary: 'SDK setup guide (static — same for every project)' },
];

export const TOOL_NAMES: readonly string[] = TOOL_CATALOG.map((t) => t.name);
