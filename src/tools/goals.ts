import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

export function registerGoalTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_goal_funnel',
    {
      title: 'Goal funnel',
      description: 'Get goal hit counts, unique-session conversion rates, and per-variant breakdown.',
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        goals: z
          .array(
            z.object({
              goalName: z.string(),
              hits: z.number(),
              uniqueSessions: z.number(),
              conversionRate: z.number().describe('Unique-session conversion rate (0-1)'),
              variants: z
                .array(
                  z.object({
                    componentId: z.string(),
                    variantId: z.string(),
                    completionRate: z.number().describe('Completion rate per assigned session (0-1)'),
                  }),
                )
                .describe('Per-variant breakdown'),
            }),
          )
          .describe('Configured goals (empty if none)'),
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
        goals: Array<{
          goalName: string;
          hits: number;
          uniqueSessions: number;
          pct: number;
          variants: Array<{ componentId: string; variantId: string; completionRate: number }>;
        }>;
      }>(`/projects/${id}/goals`);

      const structuredContent = {
        goals: data.goals.map((g) => ({
          goalName: g.goalName,
          hits: g.hits,
          uniqueSessions: g.uniqueSessions,
          conversionRate: g.pct,
          variants: g.variants.map((v) => ({
            componentId: v.componentId,
            variantId: v.variantId,
            completionRate: v.completionRate,
          })),
        })),
      };

      if (!data.goals.length) {
        return {
          content: [{ type: 'text' as const, text: 'No goals configured for this project.' }],
          structuredContent,
        };
      }

      const lines = data.goals.flatMap((g) => [
        `${g.goalName}: ${g.hits} hits, ${g.uniqueSessions} unique sessions, ${(g.pct * 100).toFixed(1)}% conversion`,
        ...g.variants.map((v) => `  ${v.componentId}/${v.variantId}: ${(v.completionRate * 100).toFixed(1)}% per assigned session`),
        '',
      ]);

      return { content: [{ type: 'text' as const, text: lines.join('\n').trim() }], structuredContent };
    },
  );
}
