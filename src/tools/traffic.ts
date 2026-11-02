import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import {
  projectIdSchema,
  untrusted,
  withApiErrorGuidance,
  UNTRUSTED_FIELDS_NOTE,
} from './common.js';

// The same strings the dashboard's traffic card prints, so an agent relaying
// this tool's text and a person reading the dashboard never see two wordings.
const NOTICE_TEXT: Record<string, string> = {
  no_interaction_evidence:
    "Your integration isn't reporting clicks or scrolls, so we can't confirm anyone as a person yet.",
  server_only:
    "We receive these visits from your server but never see a browser, so we can't confirm them as people or bots.",
};

type Breakdown = {
  window: { from: string; to: string };
  total: number;
  groups: Array<{
    group: string;
    label: string;
    count: number;
    evidence: Array<{ code: string; label: string; count: number }>;
  }>;
  agents: Array<{ name: string; group: string; count: number }>;
  conversions: { total: number; fromPeople: number };
  notices: string[];
};

// 'range' here is not rangeInputSchema: this endpoint also takes the rolling
// '24h' token the shared calendar resolver has no preset for.
const trafficRangeSchema = z
  .enum(['24h', '7d', '30d', '90d', 'all'])
  .optional()
  .describe("'24h' is the rolling last 24 hours; 7d/30d/90d/all are calendar windows in the project's reporting timezone (default 30d)");

export function registerTrafficTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_traffic_breakdown',
    {
      title: 'Traffic breakdown',
      description:
        'Where a project’s traffic came from. Every visitor (one per browser or device) last seen in the window falls into exactly one of seven groups that add up to the total: ' +
        'People (ran the page, interacted (click, scroll, mouse, touch or key) and passed the bot check), Loaded but didn’t interact, Not verified — no browser activity, ' +
        'Being analysed (usually settled within 3 hours), AI assistants, Search & AI crawlers and Other automated. ' +
        'Each group carries plain-English evidence counts; named AI assistants and crawlers, conversions (total and from People) and notices are included. ' +
        'Conversion rates elsewhere are conversion rate among People. Reporting only — it does not change what the optimizer learns from.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema, range: trafficRangeSchema },
      outputSchema: {
        window: z.object({ from: z.string(), to: z.string() }),
        total: z.number().describe('Visitors in the window; the groups add up to this'),
        groups: z.array(
          z.object({
            group: z
              .string()
              .describe('people | loaded_no_interaction | not_verified | being_analysed | ai_assistant | crawler | other_automated'),
            label: z.string(),
            count: z.number(),
            evidence: z.array(z.object({ code: z.string(), label: z.string(), count: z.number() })),
          }),
        ),
        agents: z.array(z.object({ name: z.string(), group: z.string(), count: z.number() })),
        conversions: z.object({
          total: z.number().describe('Conversions from every visitor'),
          fromPeople: z.number().describe('Conversions from People; the rest are from visitors we couldn’t confirm as people'),
        }),
        notices: z.array(z.string()).describe('no_interaction_evidence | server_only'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, range }: { projectId: string; range?: string }) => {
      const id = encodeURIComponent(projectId);
      const t = await client.get<Breakdown>(`/projects/${id}/traffic${range ? `?range=${encodeURIComponent(range)}` : ''}`);

      const beingAnalysed = t.groups.find((g) => g.group === 'being_analysed')?.count ?? 0;
      const lines = [
        `Traffic from ${t.window.from.slice(0, 10)} to ${t.window.to.slice(0, 10)}: ${t.total} visitors.`,
        ...t.groups.map((g) => `- ${g.label}: ${g.count}`),
      ];
      if (beingAnalysed > 0) {
        lines.push('', `${beingAnalysed} visitors are being analysed — usually settled within 3 hours`);
      }
      if (t.agents.length > 0) {
        // Agent names come from request user-agents, so they are attacker-writable.
        lines.push('', 'Named agents:', ...t.agents.map((a) => `- ${untrusted(a.name)}: ${a.count}`));
      }
      // Both figures as the API sends them: a client-side total - fromPeople
      // would be a second definition of the remainder that could drift.
      lines.push('', `${t.conversions.total} conversions in total, ${t.conversions.fromPeople} from People.`);
      for (const n of t.notices) lines.push(NOTICE_TEXT[n] ?? n);

      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent: t };
    }, {
      range_too_large:
        'That window has too much traffic to break down in one go. Ask for a shorter range (24h, 7d or 30d) and try again.',
    }),
  );
}
