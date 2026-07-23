import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { uiMeta } from '../ui/index.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

export function registerPersonaTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_persona_breakdown',
    {
      title: 'Persona breakdown',
      description: 'Get the distribution of visitor persona clusters with session counts and reliability scores.',
      inputSchema: { projectId: projectIdSchema },
      _meta: uiMeta('persona-breakdown'),
      outputSchema: {
        totalSessions: z.number().describe('Total sessions across all clusters'),
        clusters: z
          .array(
            z.object({
              label: z.string(),
              sessionCount: z.number(),
              sharePct: z.number().describe('Share of total traffic (0-100)'),
              reliability: z.number().describe('Average cluster reliability (0-1)'),
            }),
          )
          .describe('Persona clusters (empty until enough visitor data)'),
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
        clusters: Array<{ label: string; sessionCount: number; avgReliability: number }>;
        totalSessions: number;
      }>(`/projects/${id}/portraits`);

      const structuredContent = {
        totalSessions: data.totalSessions,
        clusters: data.clusters.map((c) => ({
          label: c.label,
          sessionCount: c.sessionCount,
          sharePct: data.totalSessions > 0 ? (c.sessionCount / data.totalSessions) * 100 : 0,
          reliability: c.avgReliability,
        })),
      };

      if (!data.clusters.length) {
        return {
          content: [{ type: 'text' as const, text: 'No persona clusters yet. More visitor data is needed.' }],
          structuredContent,
          _meta: uiMeta('persona-breakdown'),
        };
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

      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent, _meta: uiMeta('persona-breakdown') };
    },
  );
}
