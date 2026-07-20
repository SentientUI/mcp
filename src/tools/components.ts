import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

export function registerComponentTools(server: McpServer, client: ApiClient): void {
  server.tool(
    'list_components',
    'List all adaptive components in a project with variant counts and impression totals.',
    { projectId: projectIdSchema },
    async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const components = await client.get<Array<{
        component_id: string;
        total_impressions: number;
        total_conversions: number;
        variants: Array<{ variant_id: string }>;
      }>>(`/projects/${id}/components`);

      if (!components.length) {
        return { content: [{ type: 'text' as const, text: 'No components found for this project.' }] };
      }

      const text = components.map((c) =>
        `- ${c.component_id}: ${c.variants.length} variants, ${c.total_impressions} impressions, ${c.total_conversions} conversions`
      ).join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'get_variant_performance',
    'Get CVR and momentum for all variants in a project over the last 7 days vs prior 7 days.',
    { projectId: projectIdSchema },
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

      if (!data.cvr?.length) {
        return { content: [{ type: 'text' as const, text: 'No variant data available yet.' }] };
      }

      const momentumMap = new Map(data.momentum.map((m) => [m.variantId, m.direction]));

      const text = data.cvr.map((v) =>
        `- ${v.variantId}: CVR ${(v.currentCvr * 100).toFixed(2)}% (prior ${(v.priorCvr * 100).toFixed(2)}%, ${v.deltaPp > 0 ? '+' : ''}${v.deltaPp.toFixed(1)} pp, ${momentumMap.get(v.variantId) ?? 'stable'})`
      ).join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
