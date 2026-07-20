import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

export function registerGoalTools(server: McpServer, client: ApiClient): void {
  server.tool(
    'get_goal_funnel',
    'Get goal hit counts, unique-session conversion rates, and per-variant breakdown.',
    { projectId: projectIdSchema },
    async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        goals: Array<{
          goalName: string;
          hits: number;
          uniqueSessions: number;
          pct: number;
          variants: Array<{ componentId: string; variantId: string; completionRate: number }>;
        }>;
      }>(`/projects/${id}/goals`);

      if (!data.goals.length) {
        return { content: [{ type: 'text' as const, text: 'No goals configured for this project.' }] };
      }

      const lines = data.goals.flatMap((g) => [
        `${g.goalName}: ${g.hits} hits, ${g.uniqueSessions} unique sessions, ${(g.pct * 100).toFixed(1)}% conversion`,
        ...g.variants.map((v) => `  ${v.componentId}/${v.variantId}: ${(v.completionRate * 100).toFixed(1)}% per assigned session`),
        '',
      ]);

      return { content: [{ type: 'text' as const, text: lines.join('\n').trim() }] };
    },
  );
}
