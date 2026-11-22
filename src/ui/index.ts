// MCP Apps wiring: register the `ui://` views and expose the per-tool `_meta`
// that links a tool to its view. The spec summary these rely on is at the top
// of templates.ts.
//
// A UI-capable host reads the `ui://sentientui/<view>` resource named by a
// tool's `_meta.ui.resourceUri` and renders it when that tool returns. Hosts
// without UI support ignore all of this and use the tool's text/JSON output.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildTemplate, VIEW_TITLES, type ViewId, type VizId } from './templates.js';

/**
 * MCP Apps (extension `io.modelcontextprotocol/ui`, stable 2026-01-26) mandates
 * this exact media type for HTML views — `mimeType` MUST be
 * `text/html;profile=mcp-app`. A spec host filters `ui://` resources by it, so a
 * bare `text/html` resource is ignored (counts as "no UI support").
 */
export const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';

/** The data-viz tools that carry an interactive chart, and their viz ids. */
export const UI_TOOL_VIZ: Record<string, VizId> = {
  get_persona_breakdown: 'persona-breakdown',
  get_variant_performance: 'variant-performance',
  get_goal_funnel: 'goal-funnel',
  get_layout_stats: 'layout-stats',
};

/** Every tool that opens a view: the charts plus the review queue. */
export const UI_TOOL_VIEWS: Record<string, ViewId> = {
  ...UI_TOOL_VIZ,
  list_cell_reviews: 'cell-review',
};

/** Every view this server registers, once each. */
export const VIEW_IDS = Object.keys(VIEW_TITLES) as ViewId[];

/** Canonical `ui://` URI for a view. */
export function uiResourceUri(id: ViewId): string {
  return `ui://sentientui/${id}`;
}

/**
 * Per-tool `_meta` linking a tool to its view: the spec's `ui.resourceUri`,
 * its deprecated flat `ui/resourceUri` (hosts built before the stable spec
 * read only that), and ChatGPT's `openai/outputTemplate` alias.
 *
 * No size hint: `preferredFrameSize` was never in the stable spec, and the
 * view reports its own size with ui/notifications/size-changed.
 */
export function uiMeta(id: ViewId): Record<string, unknown> {
  const uri = uiResourceUri(id);
  return {
    ui: { resourceUri: uri },
    'ui/resourceUri': uri,
    'openai/outputTemplate': uri,
  };
}

/**
 * `_meta` for a tool only a view may call (its buttons), never the agent.
 *
 * Visibility is HOST-enforced: a spec host leaves the tool out of the agent's
 * tool list and refuses a view's call to anything not marked "app". It is not
 * a server guarantee — a host that ignores MCP Apps lists the tool like any
 * other, and nothing here can tell a click from an agent's call. What actually
 * gates the write is server-side: the project's "Approve and publish" Agent
 * access switch (the API's agent-access area table) and the caller's role.
 *
 * `openai/widgetAccessible` / `openai/visibility` are ChatGPT's older
 * compatibility flags for the same two facts.
 */
export function appOnlyToolMeta(): Record<string, unknown> {
  return {
    ui: { visibility: ['app'] },
    'openai/widgetAccessible': true,
    'openai/visibility': 'private',
  };
}

/**
 * Resource `_meta.ui` for every view. `csp` is deliberately omitted: the spec
 * reads an absent csp as "no external origins", which is exactly what these
 * zero-network views need — declaring domains would only widen it.
 * `prefersBorder`: the views paint their own card surface, so ask for a frame.
 */
const RESOURCE_UI_META = {
  ui: { prefersBorder: true },
  'openai/widgetPrefersBorder': true,
} as const;

/**
 * Every `ui://` resource this server registers. These templates are static HTML
 * — no project data, no API call — so a host may read them before the user has
 * authenticated. The remote /mcp endpoint uses this set to allow an
 * unauthenticated `resources/read` for exactly these URIs (see
 * apps/api/src/routes/mcp.ts): without it, `resources/list` advertised
 * resources that every reader got a 401 for, which reads to an agent as a
 * server whose resources are all broken.
 */
export const PUBLIC_UI_RESOURCE_URIS: readonly string[] = VIEW_IDS.map(uiResourceUri);

/** Register every `ui://` view on the server. */
export function registerUiResources(server: McpServer): void {
  for (const id of VIEW_IDS) {
    server.registerResource(
      id,
      uiResourceUri(id),
      {
        title: `${VIEW_TITLES[id]} (UI)`,
        description: `Interactive ${VIEW_TITLES[id]} view for agent hosts that support MCP Apps.`,
        mimeType: RESOURCE_MIME_TYPE,
        _meta: RESOURCE_UI_META,
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: RESOURCE_MIME_TYPE,
            text: buildTemplate(id),
            // The spec reads resource `_meta.ui` from the read contents; the
            // listing copy above is for hosts that inspect resources/list.
            _meta: RESOURCE_UI_META,
          },
        ],
      }),
    );
  }
}

export {
  buildTemplate,
  VIZ_TITLES,
  VIEW_TITLES,
  REVIEW_APP_TOOL,
  MCP_APPS_PROTOCOL_VERSION,
  LEGACY_DELAY_MS,
} from './templates.js';
export type { VizId, ViewId } from './templates.js';
