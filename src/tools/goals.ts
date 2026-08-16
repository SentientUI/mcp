import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { uiMeta } from '../ui/index.js';
import { projectIdSchema, withApiErrorGuidance } from './common.js';

export function registerGoalTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_goal_funnel',
    {
      title: 'Goal funnel',
      description: 'Get goal hit counts, unique-session conversion rates, and per-variant breakdown.',
      inputSchema: { projectId: projectIdSchema },
      _meta: uiMeta('goal-funnel'),
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
    withApiErrorGuidance(async ({ projectId }) => {
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
          _meta: uiMeta('goal-funnel'),
        };
      }

      const lines = data.goals.flatMap((g) => [
        `${g.goalName}: ${g.hits} hits, ${g.uniqueSessions} unique sessions, ${(g.pct * 100).toFixed(1)}% conversion`,
        ...g.variants.map((v) => `  ${v.componentId}/${v.variantId}: ${(v.completionRate * 100).toFixed(1)}% per assigned session`),
        '',
      ]);

      return { content: [{ type: 'text' as const, text: lines.join('\n').trim() }], structuredContent, _meta: uiMeta('goal-funnel') };
    }),
  );

  server.registerTool(
    'list_goals',
    {
      title: 'List goal definitions',
      description:
        'List the project\'s defined goals — including ones with no conversions yet, which get_goal_funnel cannot see. Returns each goal\'s stable id, display name, role (primary/secondary/guardrail), event type, and status. Reference a goalId verbatim from code: client.goal(\'<goalId>\') or <Adaptive goal="<goalId>">.',
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        goals: z
          .array(
            z.object({
              goalId: z.string().describe('Stable id — use this exact string when firing the goal from code'),
              displayName: z.string(),
              role: z.string().describe('primary | secondary | guardrail'),
              event: z.string().describe('click | form_submit | url_reached'),
              urlPattern: z.string().nullable().describe('Only for url_reached goals'),
              status: z.string().describe('active | archived'),
            }),
          )
          .describe('Defined goals (empty if none)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        goals: Array<{
          goal_id: string;
          display_name: string;
          role: string;
          event: string;
          url_pattern: string | null;
          status: string;
        }>;
      }>(`/projects/${id}/goal-definitions`);

      const structuredContent = {
        goals: data.goals.map((g) => ({
          goalId: g.goal_id,
          displayName: g.display_name,
          role: g.role,
          event: g.event,
          urlPattern: g.url_pattern ?? null,
          status: g.status,
        })),
      };

      if (!structuredContent.goals.length) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No goal definitions yet. Define one in the dashboard (Goals page or onboarding chat), or fire client.goal(\'<name>\') from code and it will appear in get_goal_funnel once it converts.',
          }],
          structuredContent,
        };
      }

      const lines = structuredContent.goals.map(
        (g) => `${g.goalId} (${g.role}, ${g.event}${g.status === 'archived' ? ', archived' : ''}) — ${g.displayName}`,
      );
      lines.push('', 'Reference a goalId verbatim from code: client.goal(\'<goalId>\') or <Adaptive goal="<goalId>">.');
      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
    }),
  );
}
