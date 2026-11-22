import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { uiMeta } from '../ui/index.js';
import { projectIdSchema, withApiErrorGuidance, untrusted, UNTRUSTED_FIELDS_NOTE } from './common.js';

/**
 * A portrait cluster's display name. The nightly refit used to write each
 * declared persona key into the cluster label, so a group of visitors who
 * merely behaved alike reached agents as "developer" — while nothing on the
 * site had declared anyone a developer. Clusters are labelled `behaviour-<n>`
 * now (API migration 227); anything else still renders as a behaviour group
 * and never echoes the stored string.
 */
export function behaviourGroupName(label: string | null | undefined): string {
  if (label == null || label === '' || label === 'unclustered') return 'Not grouped yet';
  const m = /^behaviour-(\d{1,4})$/.exec(label);
  return m ? `Behaviour group ${Number(m[1])}` : 'Behaviour group';
}

type BreakdownResponse = {
  windowDays: number;
  totalPeople: number;
  personas: Array<{ key: string; name: string; kind: string; people: number; sharePct: number }>;
  behaviourGroups: Array<{ name: string; description: string | null; people: number }>;
};

export function registerPersonaTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_persona_breakdown',
    {
      title: 'Persona breakdown',
      // Counted portrait clusters by a label named after the declared
      // personas until 2026-11-04, so an agent could report "Developer: 410
      // visitors" while the Matrix showed 0% for Developer. It now reads the
      // API's served-as breakdown — the Matrix share column's own numbers.
      description:
        'Visitors per audience they were SERVED as, last 30 days, People only — the same numbers as the Matrix share ' +
        'column (Everyone = no audience applied; a declared audience at 0 means the site never declared anyone as it). ' +
        'Separately, `behaviourGroups`: groups of visitors who behaved alike ("Behaviour group N" + what sets them apart). ' +
        'Behaviour groups are NOT audiences — nothing is shown to them; never describe one by an audience name.' +
        UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema },
      _meta: uiMeta('persona-breakdown'),
      outputSchema: {
        windowDays: z.number().describe('Window in days (30)'),
        totalPeople: z.number().describe('People with a served decision in the window — the share denominator'),
        personas: z
          .array(
            z.object({
              key: z.string().describe('Persona key served (`unknown` = Everyone)'),
              name: z.string().describe('Kind + name as the Matrix row reads it, e.g. "Declared: Developer"'),
              people: z.number(),
              sharePct: z.number().describe('Share of totalPeople (0-100) — the Matrix share'),
            }),
          )
          .describe('Everyone, then every Matrix audience row (zeros included), then any other served audience'),
        behaviourGroups: z
          .array(
            z.object({
              name: z.string().describe('"Behaviour group N" — never an audience'),
              description: z.string().nullable(),
              people: z.number(),
            }),
          )
          .describe('Visitors who behaved alike. Not audiences: nothing is served or targeted by them'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<BreakdownResponse>(`/projects/${id}/persona-breakdown`);

      const structuredContent = {
        windowDays: data.windowDays,
        totalPeople: data.totalPeople,
        personas: data.personas.map((p) => ({ key: p.key, name: p.name, people: p.people, sharePct: p.sharePct })),
        behaviourGroups: data.behaviourGroups.map((g) => ({ name: g.name, description: g.description, people: g.people })),
      };

      const lines = [
        `Visitors by the audience they were served as (last ${data.windowDays} days, ${data.totalPeople} people — same numbers as the Matrix share):`,
        // Audience names are customer-written — delimit them so a crafted
        // name can't pose as tool output (see untrusted()).
        ...(data.totalPeople === 0
          ? ['- No served decisions yet in this window.']
          : data.personas.map((p) => `- ${untrusted(p.name)}: ${p.people} people (${p.sharePct.toFixed(1)}%)`)),
        '',
        'Behaviour groups (visitors who behaved alike — NOT audiences; nothing is shown to a group):',
        ...(data.behaviourGroups.length === 0
          ? ['- None yet.']
          : data.behaviourGroups.map((g) => `- ${g.name}: ${g.people} people${g.description ? ` — ${g.description}` : ''}`)),
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent, _meta: uiMeta('persona-breakdown') };
    }),
  );
}
