import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

export function registerPersonaTools(server: McpServer, client: ApiClient): void {
  server.tool(
    'get_persona_breakdown',
    'Get the distribution of visitor persona clusters with session counts and reliability scores.',
    { projectId: projectIdSchema },
    async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        clusters: Array<{ label: string; sessionCount: number; avgReliability: number }>;
        totalSessions: number;
      }>(`/projects/${id}/portraits`);

      if (!data.clusters.length) {
        return { content: [{ type: 'text' as const, text: 'No persona clusters yet. More visitor data is needed.' }] };
      }

      const lines = [
        `Total sessions: ${data.totalSessions}`,
        '',
        'Clusters:',
        ...data.clusters.map((c) => {
          const pct = data.totalSessions > 0 ? (c.sessionCount / data.totalSessions) * 100 : 0;
          return `- ${c.label}: ${c.sessionCount} sessions (${pct.toFixed(1)}% of traffic, reliability ${(c.avgReliability * 100).toFixed(0)}%)`;
        }),
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
