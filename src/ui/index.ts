// MCP Apps / MCP-UI wiring: register `ui://` resources for the data-viz tools and
// expose the per-tool `_meta` that links a tool to its UI template.
//
// A UI-capable host discovers the `ui://sentientui/<viz>` resources via
// resources/list and renders one when a linked tool returns. Hosts without UI
// support ignore all of this and use the tool's existing text/JSON output.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildTemplate, VIZ_TITLES, type VizId } from './templates.js';

/**
 * MCP Apps (SEP-1865, extension `io.modelcontextprotocol/ui`) mandates this exact
 * media type for HTML UI resources — `mimeType` MUST be `text/html;profile=mcp-app`.
 * A spec-compliant host/scanner enumerates `ui://` resources and filters by this
 * type, so a bare `text/html` resource is ignored (counts as "no UI support").
 */
export const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';

/** The data-viz tools that carry an interactive UI template, and their viz ids. */
export const UI_TOOL_VIZ: Record<string, VizId> = {
  get_persona_breakdown: 'persona-breakdown',
  get_variant_performance: 'variant-performance',
  get_goal_funnel: 'goal-funnel',
  get_layout_stats: 'layout-stats',
};

/** Canonical `ui://` URI for a viz template. */
export function uiResourceUri(id: VizId): string {
  return `ui://sentientui/${id}`;
}

/**
 * Per-tool `_meta` linking a tool to its UI template. Uses `ui` (agent scanners
 * and MCP-UI hosts look for `_meta.ui`) plus the OpenAI Apps SDK
 * `openai/outputTemplate` key, so the widest set of hosts can render it.
 */
export function uiMeta(id: VizId): Record<string, unknown> {
  const uri = uiResourceUri(id);
  return {
    ui: {
      resourceUri: uri,
      preferredFrameSize: ['720px', '480px'],
    },
    'openai/outputTemplate': uri,
  };
}

/** Register the four `ui://` HTML resources on the server. */
export function registerUiResources(server: McpServer): void {
  for (const id of Object.values(UI_TOOL_VIZ)) {
    server.registerResource(
      id,
      uiResourceUri(id),
      {
        title: `${VIZ_TITLES[id]} (UI)`,
        description: `Interactive ${VIZ_TITLES[id]} view for agent hosts that support MCP UI.`,
        mimeType: RESOURCE_MIME_TYPE,
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: RESOURCE_MIME_TYPE,
            text: buildTemplate(id),
          },
        ],
      }),
    );
  }
}

export { buildTemplate, VIZ_TITLES } from './templates.js';
export type { VizId } from './templates.js';
