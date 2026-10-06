import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { projectIdSchema, withApiErrorGuidance, untrusted, UNTRUSTED_FIELDS_NOTE } from './common.js';

export function registerGuardrailTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'list_guardrail_events',
    {
      title: 'List guardrail events',
      description:
        'List every variant currently paused (a paused variant stops serving until unpaused, however long ago the pause ' +
        "fired). `source` says who paused it: 'guardrail' = automatically, for converting clearly worse; 'manual' = a " +
        'teammate paused it by hand (do not suggest resuming those without asking who paused them). Pass `days` to narrow ' +
        'to pauses fired within the last N days.' +
        UNTRUSTED_FIELDS_NOTE,
      inputSchema: {
        projectId: projectIdSchema,
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe('Only pauses fired within the last N days. Omit for every still-paused variant.'),
      },
      outputSchema: {
        events: z
          .array(
            z.object({
              componentId: z.string(),
              variantIds: z.array(z.string()).describe('Variants paused together'),
              pausedAt: z.string().nullable().describe('ISO timestamp the pause fired, or null'),
              funnelId: z.string().nullable().describe('Set when the pause came from a funnel guardrail'),
              source: z
                .enum(['guardrail', 'manual'])
                .describe("'guardrail' = paused automatically; 'manual' = paused by a teammate"),
            }),
          )
          .describe('Currently paused variants (empty if none)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async ({ projectId, days }) => {
      const id = encodeURIComponent(projectId);
      const query = days != null ? `?days=${days}` : '';
      const data = await client.get<{
        guardrailEvents: Array<{
          componentId: string;
          variantIds: string[];
          pausedAt: string | null;
          funnelId?: string | null;
          /** Absent from an API older than 2026-10-06, which listed manual pauses as guardrail ones. */
          source?: 'guardrail' | 'manual';
        }>;
      }>(`/projects/${id}/guardrail-events${query}`);

      const structuredContent = {
        events: data.guardrailEvents.map((e) => ({
          componentId: e.componentId,
          variantIds: e.variantIds,
          pausedAt: e.pausedAt,
          funnelId: e.funnelId ?? null,
          source: e.source ?? ('guardrail' as const),
        })),
      };

      if (!data.guardrailEvents.length) {
        const scope = days != null ? `paused in the last ${days} days` : 'currently paused';
        return {
          content: [{ type: 'text' as const, text: `No variants ${scope}.` }],
          structuredContent,
        };
      }

      // Component/variant ids are visitor-mintable via the public ingest path —
      // delimit them so a minted id can't pose as tool output (see untrusted()).
      const lines = structuredContent.events.map((e) =>
        `- ${untrusted(e.componentId)}: variants [${e.variantIds.map((v) => untrusted(v)).join(', ')}] ` +
        `${e.source === 'manual' ? 'paused by a teammate' : 'paused automatically by a guardrail'}` +
        `${e.pausedAt ? ` at ${e.pausedAt}` : ''}${e.funnelId ? ` (protecting the ${untrusted(e.funnelId)} funnel)` : ''}`
      );

      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
    }),
  );
}
