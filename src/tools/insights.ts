import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

export function registerInsightTools(server: McpServer, client: ApiClient): void {
  server.tool(
    'get_insights',
    'Get the latest AI-generated insights: narrator observations and (Growth tier) advisor recommendations.',
    { projectId: projectIdSchema },
    async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        status: 'ok' | 'empty';
        narratorBullets?: string[];
        advisorBullets?: string[];
        isStale?: boolean;
        generatedAt?: string;
      }>(`/projects/${id}/insights`);

      if (data.status === 'empty') {
        return { content: [{ type: 'text' as const, text: 'No insights generated yet. Use refresh_insights to generate.' }] };
      }

      const lines: string[] = [];
      if (data.isStale) lines.push('⚠ Insights are stale (>6h old). Consider calling refresh_insights.');
      if (data.generatedAt) lines.push(`Generated: ${new Date(data.generatedAt).toUTCString()}`);
      lines.push('');
      lines.push('Observations:');
      (data.narratorBullets ?? []).forEach((b) => lines.push(`- ${b}`));
      if (data.advisorBullets?.length) {
        lines.push('');
        lines.push('Recommendations:');
        data.advisorBullets.forEach((b) => lines.push(`- ${b}`));
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
