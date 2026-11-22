import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { projectIdSchema, withApiErrorGuidance } from './common.js';

// get_site_areas: which parts of the site are before sign-up and which are
// after (dashboard Settings → Site areas, 2026-11-21). Before sign-up the
// visitor is anonymous and the goal is to convert them; after sign-up the
// visitor is inside the product and known. A component gets versions only for
// audiences of its own side, so an agent asked "write a version of the
// pricing headline for our admins" needs this to know why it is refused.
// Agents change the areas with manage_settings set_site_areas.

type Side = 'before' | 'after';

// GET /v1/mgmt/projects/:id/site-areas. The fields this tool reads.
type SiteAreasResponse = {
  areas?: Array<{ origin: string; path: string | null; side: Side }>;
  sites?: Array<{ origin: string; internal: boolean; visits30d: number; signedIn30d: number; suggested: Side | null }>;
};

const SIDE_WORDS: Record<Side, string> = { before: 'before sign-up', after: 'after sign-up' };

export function registerSiteAreasTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_site_areas',
    {
      title: 'Site areas (before and after sign-up)',
      description:
        'Read which parts of the site are before sign-up (anonymous visitors; the main goal is to convert them: a sign-up, a sale, a form) ' +
        'and which are after sign-up (inside the product, where the site knows who its users are) — dashboard Settings → Site areas. ' +
        'Each area is an allowed site, optionally narrowed to a path; a page no area covers is before sign-up. A component gets versions ' +
        'only for audiences of its own side, and serving follows the same line: campaign, arrival and retargeting audiences are before ' +
        'sign-up; declared personas are after sign-up only (they are people already using the product, so they never count toward ' +
        'winning new ones); discovered groups wherever their visits happen. An empty list means the site is not split and ' +
        'nothing is restricted. Also lists every allowed site with how many visitors were signed in (30 days) and a suggested side. ' +
        'To change: manage_settings set_site_areas.',
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        split: z.boolean().describe('True once the project has split its site into before and after sign-up'),
        areas: z
          .array(z.object({ origin: z.string(), path: z.string().nullable(), side: z.enum(['before', 'after']) }))
          .describe('The areas, as saved'),
        sites: z
          .array(
            z.object({
              origin: z.string(),
              internal: z.boolean().describe('Marked internal (Settings → Internal traffic): its visits never count'),
              visits30d: z.number(),
              signedIn30d: z.number().describe('Visits where the site passed a user id'),
              suggested: z.enum(['before', 'after']).nullable().describe('After when most visitors were signed in; null with too few visits'),
            }),
          )
          .describe('Every allowed site'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId }: { projectId: string }) => {
      const r = await client.get<SiteAreasResponse>(`/projects/${encodeURIComponent(projectId)}/site-areas`);
      const areas = r.areas ?? [];
      const sites = r.sites ?? [];
      // Printed as-is: every origin here was set by a project editor and is
      // one of the project's normalized allowed origins.
      const lines = areas.length === 0
        ? ['The site is not split into before and after sign-up: nothing is restricted.']
        : [
            'Site areas (a page no area covers is before sign-up):',
            ...areas.map((a) => `- ${a.origin}${a.path ?? ''}: ${SIDE_WORDS[a.side]}`),
          ];
      const suggestions = sites.filter((s) => !s.internal && s.suggested !== null);
      if (suggestions.length > 0) {
        lines.push(
          'Signed-in share, last 30 days:',
          ...suggestions.map((s) => `- ${s.origin}: ${s.signedIn30d} of ${s.visits30d} visits signed in → suggested ${SIDE_WORDS[s.suggested!]}`),
        );
      }
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: { split: areas.length > 0, areas, sites },
      };
    }),
  );
}
