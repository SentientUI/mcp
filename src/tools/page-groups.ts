import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import {
  projectIdSchema,
  rangeInputSchema,
  rangeQuery,
  untrusted,
  windowLine,
  windowOutputSchema,
  withApiErrorGuidance,
  UNTRUSTED_FIELDS_NOTE,
  type RangeArgs,
  type WindowMeta,
} from './common.js';

type Component = { componentId: string; sessions: number; shareOfComponent: number };
type Group = {
  id: string | null; name: string; patterns: string[]; placement: string; stepGoalId: string | null; placementValid: boolean;
  viewers: number; knownViewers: number; components: Component[]; layoutVisits: number; layoutOrders: number;
};
type PageGroups = {
  saved: boolean;
  groups: Group[];
  siteWide: Array<{ componentId: string; sessions: number; groups: number }>;
  funnelSteps: Array<{ goalId: string; name: string | null }>;
  pathCoverage: number | null;
  window?: WindowMeta;
};

const PLACEMENT: Record<string, string> = {
  arrived: 'where people arrive',
  after: 'after the main goal',
  unplaced: 'not placed on the funnel',
};

export function registerPageGroupTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_page_groups',
    {
      title: 'Page groups: pages, their place in the funnel, what runs on them',
      // Mirrors GET /projects/:id/page-groups.
      description:
        'The site\'s pages in named groups (Home, Product pages, Pricing …), where each group sits on the main ' +
        'funnel, and what ran on it in the window: `viewers` (People, one per person, with a page view on the ' +
        'group\'s pages), `knownViewers` (of those, already past the main goal when they viewed it), `components` ' +
        '(the components that live there — at least 70% of their exposures were on that group; this is where a ' +
        'component was actually shown, not the page it was first seen on) and `layoutVisits` / `layoutOrders` (visits ' +
        'a page layout was served on, and how many different section orders). `siteWide` lists components shown ' +
        'across several groups, such as a header. A group is a list of URL patterns: a path like /pricing, a section ' +
        'like /products/* (anything under it), or * for every page; a page belongs to the FIRST group that matches. ' +
        '`placement` is `arrived`, `step` (with `stepGoalId`, a step of the main funnel — see `funnelSteps`), `after` ' +
        '(after the main goal) or `unplaced`. It ORGANISES the view only: it does not say where a person is in the ' +
        'funnel — get_main_funnel does, from what people did. `placementValid: false` means the group is placed at a ' +
        'step the main funnel no longer has. The row with `id: null` is pages in no group. When `saved` is false the ' +
        'project has stored no groups and the rows are a SUGGESTION counted against real traffic: save one with ' +
        'manage_goals set_page_groups. `pathCoverage` is the share of page views that carry a page; when it is low ' +
        '(an older SDK) every count here understates. Reporting only. Defaults to the last 30 days.' +
        UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema, ...rangeInputSchema('30d') },
      outputSchema: {
        saved: z.boolean().describe('False = nothing stored; the groups are a suggestion'),
        groups: z.array(z.object({
          id: z.string().nullable().describe('null = pages in no group'),
          name: z.string(),
          patterns: z.array(z.string()),
          placement: z.string().describe('unplaced | arrived | step | after'),
          stepGoalId: z.string().nullable(),
          placementValid: z.boolean(),
          viewers: z.number(),
          knownViewers: z.number(),
          components: z.array(z.object({ componentId: z.string(), sessions: z.number(), shareOfComponent: z.number() })),
          layoutVisits: z.number(),
          layoutOrders: z.number(),
        })),
        siteWide: z.array(z.object({ componentId: z.string(), sessions: z.number(), groups: z.number() })),
        funnelSteps: z.array(z.object({ goalId: z.string(), name: z.string().nullable() })).describe('The main funnel\'s steps a group can be placed at'),
        pathCoverage: z.number().nullable(),
        window: windowOutputSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, range, from, to }: { projectId: string } & RangeArgs) => {
      const id = encodeURIComponent(projectId);
      const r = await client.get<PageGroups>(`/projects/${id}/page-groups${rangeQuery({ range, from, to })}`);
      const stepName = new Map(r.funnelSteps.map((s) => [s.goalId, s.name ?? s.goalId]));
      const lines: string[] = [];
      const win = windowLine(r.window);
      if (win) lines.push(win);
      lines.push(
        r.saved
          ? 'Page groups:'
          : 'No page groups are saved yet. This is a suggestion, counted against real traffic (save it, edited as needed, with manage_goals set_page_groups):',
      );
      if (r.groups.length === 0) lines.push('  (no pages seen yet)');
      for (const g of r.groups) {
        const where =
          g.placement === 'step'
            ? (g.placementValid
                ? `at the step ${untrusted(stepName.get(g.stepGoalId ?? '') ?? g.stepGoalId ?? '')}`
                : `placed at ${untrusted(g.stepGoalId ?? '')}, which is no longer a step of the main funnel`)
            : (PLACEMENT[g.placement] ?? g.placement);
        lines.push(
          '',
          `${g.id === null ? 'Other pages (in no group)' : untrusted(g.name)}` +
            (g.id === null ? '' : ` — ${g.patterns.map((p) => untrusted(p)).join(', ')} — ${where}`),
          `  ${g.viewers} people viewed it` + (g.knownViewers > 0 ? ` (${g.knownViewers} already past the main goal)` : ''),
          g.components.length > 0
            ? `  Components here: ${g.components.map((c) => `${untrusted(c.componentId)} (${c.sessions} visits)`).join(', ')}`
            : '  No component lives here',
        );
        if (g.layoutVisits > 0) lines.push(`  Page layout served on ${g.layoutVisits} visits, in ${g.layoutOrders} different orders`);
      }
      if (r.siteWide.length > 0) {
        lines.push('', `Site-wide components (shown across several groups): ${r.siteWide.map((c) => `${untrusted(c.componentId)} (${c.sessions} visits, ${c.groups} groups)`).join(', ')}`);
      }
      if (r.pathCoverage !== null && r.pathCoverage < 0.9) {
        lines.push('', `Only ${(r.pathCoverage * 100).toFixed(0)}% of page views carry a page, so these counts understate (an older SDK sends none).`);
      }
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: {
          saved: r.saved, groups: r.groups, siteWide: r.siteWide, funnelSteps: r.funnelSteps,
          pathCoverage: r.pathCoverage, window: r.window,
        },
      };
    }),
  );
}
