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
      description: 'Get goal hit counts, unique-session conversion rates, and per-variant breakdown. This is a flat per-goal list — for multi-step funnel drop-off, use get_funnel_report.',
      inputSchema: { projectId: projectIdSchema },
      _meta: uiMeta('goal-funnel'),
      outputSchema: {
        currency: z.string().describe('Project display currency (ISO-4217) for the revenue fields'),
        goals: z
          .array(
            z.object({
              goalName: z.string(),
              hits: z.number(),
              uniqueSessions: z.number(),
              conversionRate: z.number().describe('Unique-session conversion rate (0-1)'),
              revenue: z.number().nullable().describe('Total revenue from valued conversions, in the project currency (null for valueless goals)'),
              avgOrderValue: z.number().nullable().describe('Average value per valued conversion (null for valueless goals)'),
              revenuePerSession: z.number().nullable().describe('Revenue divided by all project sessions (null for valueless goals)'),
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
        currency?: string;
        goals: Array<{
          goalName: string;
          hits: number;
          uniqueSessions: number;
          pct: number;
          revenue?: number | null;
          avgOrderValue?: number | null;
          revenuePerSession?: number | null;
          variants: Array<{ componentId: string; variantId: string; completionRate: number }>;
        }>;
      }>(`/projects/${id}/goals`);

      // ?? null tolerance: an API deployed before revenue goals sends none of
      // these fields, and the tool must keep working against it.
      const structuredContent = {
        currency: data.currency ?? 'USD',
        goals: data.goals.map((g) => ({
          goalName: g.goalName,
          hits: g.hits,
          uniqueSessions: g.uniqueSessions,
          conversionRate: g.pct,
          revenue: g.revenue ?? null,
          avgOrderValue: g.avgOrderValue ?? null,
          revenuePerSession: g.revenuePerSession ?? null,
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

      const currency = data.currency ?? 'USD';
      const lines = data.goals.flatMap((g) => [
        `${g.goalName}: ${g.hits} hits, ${g.uniqueSessions} unique sessions, ${(g.pct * 100).toFixed(1)}% conversion` +
          (g.revenue != null
            ? `, ${g.revenue.toFixed(2)} ${currency} revenue (${(g.avgOrderValue ?? 0).toFixed(2)} avg order)`
            : ''),
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
              defaultValue: z.number().nullable().describe('Fixed worth applied when a conversion carries no explicit value (project currency); null when unset'),
            }),
          )
          .describe('Defined goals (empty if none)'),
        warnings: z.array(z.object({
          goalName: z.string().describe('The suspicious (probably typo) goal name'),
          suggestion: z.string().describe('The existing goal it likely meant'),
        })).describe('Recent goal names that look like typos of existing goals — verify before firing a new name'),
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
          default_value?: string | null;
        }>;
      }>(`/projects/${id}/goal-definitions`);

      // Typo warnings (spec item 1). Tolerate an API deployed before the
      // warnings endpoint — the tool must keep working against it.
      let warnings: Array<{ goalName: string; suggestion: string }> = [];
      try {
        const w = await client.get<{ warnings: Array<{ goalName: string; suggestion: string }> }>(
          `/projects/${id}/goal-warnings`,
        );
        warnings = (w.warnings ?? []).map((x) => ({ goalName: x.goalName, suggestion: x.suggestion }));
      } catch { /* older API */ }

      const structuredContent = {
        goals: data.goals.map((g) => ({
          goalId: g.goal_id,
          displayName: g.display_name,
          role: g.role,
          event: g.event,
          urlPattern: g.url_pattern ?? null,
          status: g.status,
          // NUMERIC arrives serialized as a string; coerce and tolerate its
          // absence from an older API deploy.
          defaultValue: g.default_value != null ? Number(g.default_value) : null,
        })),
        warnings,
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
      for (const w of warnings) {
        lines.push(`⚠ "${w.goalName}" looks like a typo of "${w.suggestion}" — check before using it.`);
      }
      lines.push('', 'Reference a goalId verbatim from code: client.goal(\'<goalId>\') or <Adaptive goal="<goalId>">.');
      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
    }),
  );
}
