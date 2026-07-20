import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

export function registerInsightTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_insights',
    {
      title: 'Get insights',
      description: 'Get the latest AI-generated insights: narrator observations and (Growth tier) advisor recommendations.',
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        status: z.enum(['ok', 'empty']).describe('Whether insights exist yet'),
        observations: z.array(z.string()).describe('Narrator observations'),
        recommendations: z.array(z.string()).describe('Advisor recommendations (Growth tier)'),
        isStale: z.boolean().describe('True when the insights are older than ~6h'),
        generatedAt: z.string().nullable().describe('ISO timestamp the insights were generated, or null'),
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
        status: 'ok' | 'empty';
        narratorBullets?: string[];
        advisorBullets?: string[];
        isStale?: boolean;
        generatedAt?: string;
      }>(`/projects/${id}/insights`);

      if (data.status === 'empty') {
        return {
          content: [{ type: 'text' as const, text: 'No insights generated yet. Use refresh_insights to generate.' }],
          structuredContent: {
            status: 'empty' as const,
            observations: [],
            recommendations: [],
            isStale: false,
            generatedAt: null,
          },
        };
      }

      const observations = data.narratorBullets ?? [];
      const recommendations = data.advisorBullets ?? [];

      const lines: string[] = [];
      if (data.isStale) lines.push('⚠ Insights are stale (>6h old). Consider calling refresh_insights.');
      if (data.generatedAt) lines.push(`Generated: ${new Date(data.generatedAt).toUTCString()}`);
      lines.push('');
      lines.push('Observations:');
      observations.forEach((b) => lines.push(`- ${b}`));
      if (recommendations.length) {
        lines.push('');
        lines.push('Recommendations:');
        recommendations.forEach((b) => lines.push(`- ${b}`));
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: {
          status: 'ok' as const,
          observations,
          recommendations,
          isStale: data.isStale ?? false,
          generatedAt: data.generatedAt ?? null,
        },
      };
    },
  );
}
