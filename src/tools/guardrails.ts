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
        'List every variant currently paused by a guardrail (a paused variant stops serving until unpaused, ' +
        'however long ago the pause fired). Pass `days` to narrow to pauses fired within the last N days.' +
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
              variantIds: z.array(z.string()).describe('Variants paused by the guardrail'),
              pausedAt: z.string().nullable().describe('ISO timestamp the pause fired, or null'),
              funnelId: z.string().nullable().describe('Set when the pause came from a funnel guardrail'),
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
        }>;
      }>(`/projects/${id}/guardrail-events${query}`);

      const structuredContent = {
        events: data.guardrailEvents.map((e) => ({
          componentId: e.componentId,
          variantIds: e.variantIds,
          pausedAt: e.pausedAt,
          funnelId: e.funnelId ?? null,
        })),
      };

      if (!data.guardrailEvents.length) {
        const scope = days != null ? `paused by a guardrail in the last ${days} days` : 'currently paused by a guardrail';
        return {
          content: [{ type: 'text' as const, text: `No variants ${scope}.` }],
          structuredContent,
        };
      }

      // Component/variant ids are visitor-mintable via the public ingest path —
      // delimit them so a minted id can't pose as tool output (see untrusted()).
      const lines = data.guardrailEvents.map((e) =>
        `- ${untrusted(e.componentId)}: variants [${e.variantIds.map((v) => untrusted(v)).join(', ')}] paused${e.pausedAt ? ` at ${e.pausedAt}` : ''}${e.funnelId ? ` (protecting the ${untrusted(e.funnelId)} funnel)` : ''}`
      );

      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
    }),
  );
}
