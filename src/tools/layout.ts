import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

export function registerLayoutTools(server: McpServer, client: ApiClient): void {
  server.tool(
    'get_layout_stats',
    'Get per-persona section layout rankings and bandit reward weights.',
    { projectId: projectIdSchema },
    async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const stats = await client.get<Array<{
        persona: string;
        layoutOrder: string[];
        pulls: number;
        avgReward: number;
      }>>(`/projects/${id}/layout-stats`);

      if (!stats.length) {
        return { content: [{ type: 'text' as const, text: 'No layout data yet. More visitor sessions are needed.' }] };
      }

      const text = stats.map((s) =>
        `- ${s.persona}: [${s.layoutOrder.join(' → ')}] (avg reward: ${s.avgReward.toFixed(2)}, ${s.pulls} pulls)`
      ).join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
