import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { uiMeta } from '../ui/index.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

export function registerLayoutTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_layout_stats',
    {
      title: 'Layout stats',
      description: 'Get per-persona section layout rankings and bandit reward weights.',
      inputSchema: { projectId: projectIdSchema },
      _meta: uiMeta('layout-stats'),
      outputSchema: {
        layouts: z
          .array(
            z.object({
              persona: z.string(),
              layoutOrder: z.array(z.string()).describe('Ranked section order for this persona'),
              pulls: z.number().describe('Number of times this arm was served'),
              avgReward: z.number().describe('Average bandit reward weight'),
            }),
          )
          .describe('Per-persona layout rankings (empty until enough sessions)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const stats = await client.get<Array<{
        persona: string;
        layoutOrder: string[];
        pulls: number;
        avgReward: number;
      }>>(`/projects/${id}/layout-stats`);

      const structuredContent = {
        layouts: stats.map((s) => ({
          persona: s.persona,
          layoutOrder: s.layoutOrder,
          pulls: s.pulls,
          avgReward: s.avgReward,
        })),
      };

      if (!stats.length) {
        return {
          content: [{ type: 'text' as const, text: 'No layout data yet. More visitor sessions are needed.' }],
          structuredContent,
          _meta: uiMeta('layout-stats'),
        };
      }

      const text = stats.map((s) =>
        `- ${s.persona}: [${s.layoutOrder.join(' → ')}] (avg reward: ${s.avgReward.toFixed(2)}, ${s.pulls} pulls)`
      ).join('\n');

      return { content: [{ type: 'text' as const, text }], structuredContent, _meta: uiMeta('layout-stats') };
    },
  );
}
