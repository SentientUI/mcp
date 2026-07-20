import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

export function registerComponentTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'list_components',
    {
      title: 'List components',
      description: 'List all adaptive components in a project with variant counts and impression totals.',
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        components: z
          .array(
            z.object({
              componentId: z.string(),
              variantCount: z.number(),
              impressions: z.number(),
              conversions: z.number(),
            }),
          )
          .describe('Adaptive components in the project (empty if none)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const components = await client.get<Array<{
        component_id: string;
        total_impressions: number;
        total_conversions: number;
        variants: Array<{ variant_id: string }>;
      }>>(`/projects/${id}/components`);

      const structuredContent = {
        components: components.map((c) => ({
          componentId: c.component_id,
          variantCount: c.variants.length,
          impressions: c.total_impressions,
          conversions: c.total_conversions,
        })),
      };

      if (!components.length) {
        return {
          content: [{ type: 'text' as const, text: 'No components found for this project.' }],
          structuredContent,
        };
      }

      const text = components.map((c) =>
        `- ${c.component_id}: ${c.variants.length} variants, ${c.total_impressions} impressions, ${c.total_conversions} conversions`
      ).join('\n');

      return { content: [{ type: 'text' as const, text }], structuredContent };
    },
  );

  server.registerTool(
    'get_variant_performance',
    {
      title: 'Variant performance',
      description: 'Get CVR and momentum for all variants in a project over the last 7 days vs prior 7 days.',
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        variants: z
          .array(
            z.object({
              variantId: z.string(),
              currentCvr: z.number().describe('Conversion rate over the last 7 days (0-1)'),
              priorCvr: z.number().describe('Conversion rate over the prior 7 days (0-1)'),
              deltaPp: z.number().describe('Change in percentage points'),
              momentum: z.string().describe('Momentum direction: gaining, losing, or stable'),
            }),
          )
          .describe('Per-variant performance (empty if no data yet)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        cvr: Array<{
          variantId: string;
          currentCvr: number;
          priorCvr: number;
          deltaPp: number;
        }>;
        momentum: Array<{
          variantId: string;
          direction: string;
        }>;
      }>(`/projects/${id}/trends`);

      const momentumMap = new Map((data.momentum ?? []).map((m) => [m.variantId, m.direction]));
      const structuredContent = {
        variants: (data.cvr ?? []).map((v) => ({
          variantId: v.variantId,
          currentCvr: v.currentCvr,
          priorCvr: v.priorCvr,
          deltaPp: v.deltaPp,
          momentum: momentumMap.get(v.variantId) ?? 'stable',
        })),
      };

      if (!data.cvr?.length) {
        return {
          content: [{ type: 'text' as const, text: 'No variant data available yet.' }],
          structuredContent,
        };
      }

      const text = data.cvr.map((v) =>
        `- ${v.variantId}: CVR ${(v.currentCvr * 100).toFixed(2)}% (prior ${(v.priorCvr * 100).toFixed(2)}%, ${v.deltaPp > 0 ? '+' : ''}${v.deltaPp.toFixed(1)} pp, ${momentumMap.get(v.variantId) ?? 'stable'})`
      ).join('\n');

      return { content: [{ type: 'text' as const, text }], structuredContent };
    },
  );
}
