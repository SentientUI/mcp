import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { projectIdSchema, withApiErrorGuidance, untrusted, UNTRUSTED_FIELDS_NOTE } from './common.js';

const funnelIdSchema = z.string().describe('Funnel slug (from list_funnels), e.g. "checkout"');


/**
 * A step can out-reach the one before it — visitors who completed the earlier
 * step before the window opened, or (in any-order mode) skipped it entirely.
 * CONTRACTS §8 requires that be rendered as a GAIN with the reason, never as a
 * negative drop: "(-25% drop-off from previous)" reads as a broken number and
 * an agent will repeat it as one. The dashboard already does this; this surface
 * was missed.
 */
function stepChangeText(dropOffFromPrevious: number | null | undefined): string {
  if (dropOffFromPrevious == null) return '';
  if (dropOffFromPrevious < 0) {
    return ` (${Math.round(-dropOffFromPrevious * 100)}% MORE than the previous step — some visitors reached it without the step before, or completed that step before this window)`;
  }
  return ` (${Math.round(dropOffFromPrevious * 100)}% drop-off from previous)`;
}

export function registerFunnelTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'list_funnels',
    {
      title: 'List funnels',
      description:
        'List the project\'s multi-step funnels — ordered goal steps plus the components serving them. Use get_funnel_report for a funnel\'s drop-off numbers. Reference a funnelId verbatim from code: <Adaptive funnel="<funnelId>">.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        funnels: z
          .array(
            z.object({
              funnelId: z.string().describe('Stable slug — use this exact string in code and in get_funnel_report'),
              displayName: z.string(),
              status: z.string().describe('draft | active | archived'),
              windowDays: z.number().describe('Conversion window in days'),
              source: z.string().describe('user | chat | editor | sdk'),
              steps: z
                .array(
                  z.object({
                    stepIndex: z.number(),
                    goalId: z.string(),
                    weight: z.number().nullable().describe('Manual optimizer credit for reaching this step (null = automatic end-weighted)'),
                  }),
                )
                .describe('Ordered steps'),
              components: z
                .array(z.object({ componentId: z.string(), stepIndex: z.number().nullable() }))
                .describe('Components serving this funnel (stepIndex null = whole funnel)'),
            }),
          )
          .describe('Defined funnels (empty if none)'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        funnels: Array<{
          funnel_id: string;
          display_name: string;
          status: string;
          window_days: number;
          source: string;
          steps: Array<{ step_index: number; goal_id: string; weight: string | number | null }>;
          components: Array<{ component_id: string; step_index: number | null }>;
        }>;
      }>(`/projects/${id}/funnels`);

      const structuredContent = {
        funnels: (data.funnels ?? []).map((f) => ({
          funnelId: f.funnel_id,
          displayName: f.display_name,
          status: f.status,
          windowDays: f.window_days,
          source: f.source,
          // NUMERIC arrives serialized as a string; coerce.
          steps: f.steps.map((s) => ({
            stepIndex: s.step_index,
            goalId: s.goal_id,
            weight: s.weight == null ? null : Number(s.weight),
          })),
          components: f.components.map((c) => ({ componentId: c.component_id, stepIndex: c.step_index ?? null })),
        })),
      };

      if (structuredContent.funnels.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No funnels defined yet. Build one in the dashboard (Goals → Funnels tab) or via the goal chat — a funnel is 2-12 ordered goal steps, e.g. add_to_cart → checkout → purchase.',
          }],
          structuredContent,
        };
      }

      // Funnel steps reference goal ids, and goals are visitor-mintable via the
      // public pk_ key — delimit every name (see untrusted()).
      const lines = structuredContent.funnels.map(
        (f) => `${untrusted(f.funnelId)} (${f.status}) — ${untrusted(f.displayName)}: ${f.steps.map((s) => untrusted(s.goalId)).join(' → ')}`,
      );
      lines.push('', 'Reference a funnelId verbatim from code: <Adaptive funnel="<funnelId>">. Use get_funnel_report for drop-off numbers.');
      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
    }),
  );

  server.registerTool(
    'get_funnel_report',
    {
      title: 'Funnel drop-off report',
      description:
        'Per-step reach and drop-off for one funnel over its conversion window, with per-variant and audience splits per step, final-step revenue, and the holdout ("without optimization") comparison.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema, funnelId: funnelIdSchema },
      outputSchema: {
        funnelId: z.string(),
        displayName: z.string(),
        windowDays: z.number(),
        strictOrder: z.boolean().describe('True when the chart counts a step only if the previous step happened first (reporting only — the optimizer always credits max progress)'),
        currency: z.string().describe('Project display currency (ISO-4217) for the revenue fields'),
        steps: z
          .array(
            z.object({
              stepIndex: z.number(),
              goalId: z.string(),
              displayName: z.string(),
              reached: z.number().describe('Distinct visitors reaching this step in-window'),
              dropOffFromPrevious: z.number().nullable().describe('1 - reached/previousReached (null on the first step)'),
              neverFired: z.boolean().describe('True when the step goal has never been recorded anywhere — likely a typo'),
              variants: z.array(z.object({
                componentId: z.string(),
                variantId: z.string(),
                reached: z.number(),
                assigned: z.number().describe('Distinct sessions served this variant in-window (the rate denominator)'),
              })),
              personas: z.array(z.object({ label: z.string(), reached: z.number() })),
            }),
          ),
        revenue: z.number().nullable().describe('Final-step revenue in the project currency (null when no valued conversions)'),
        avgOrderValue: z.number().nullable(),
        revenuePerEnteringVisitor: z.number().nullable(),
        holdoutCompletion: z.object({ entered: z.number(), reached: z.number() }).nullable()
          .describe('Holdout visitors entering vs finishing — the "without optimization" line'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, funnelId }) => {
      const data = await client.get<{
        funnelId: string;
        displayName: string;
        windowDays: number;
        strictOrder?: boolean;
        currency: string;
        steps: Array<{
          stepIndex: number; goalId: string; displayName: string; reached: number;
          dropOffFromPrevious: number | null; neverFired: boolean;
          variants: Array<{ componentId: string; variantId: string; reached: number; assigned: number }>;
          personas: Array<{ label: string; reached: number }>;
        }>;
        revenue: number | null;
        avgOrderValue: number | null;
        revenuePerEnteringVisitor: number | null;
        holdoutCompletion: { entered: number; reached: number } | null;
      }>(`/projects/${encodeURIComponent(projectId)}/funnels/${encodeURIComponent(funnelId)}/report`);

      // Step names come from goal display names and variant/component ids from
      // the public ingest path — all visitor-mintable, so delimit them.
      const lines: string[] = [`${untrusted(data.displayName)} — last ${data.windowDays} days`];
      for (const s of data.steps) {
        lines.push(
          `${s.stepIndex + 1}. ${untrusted(s.displayName)}: ${s.reached} reached` +
          stepChangeText(s.dropOffFromPrevious) +
          (s.neverFired ? ' [never recorded — check the goal name]' : ''),
        );
        for (const v of s.variants) {
          lines.push(`   ${untrusted(v.componentId)}/${untrusted(v.variantId)}: ${v.reached}/${v.assigned} assigned sessions reached this step`);
        }
      }
      if (data.revenue != null) {
        lines.push(
          `Revenue: ${data.revenue.toFixed(2)} ${data.currency}` +
          (data.avgOrderValue != null ? ` (${data.avgOrderValue.toFixed(2)} ${data.currency} avg order)` : '') +
          (data.revenuePerEnteringVisitor != null ? `, ${data.revenuePerEnteringVisitor.toFixed(2)} ${data.currency} per entering visitor` : ''),
        );
      }
      if (data.holdoutCompletion && data.holdoutCompletion.entered > 0) {
        lines.push(`Without optimization: ${data.holdoutCompletion.reached} of ${data.holdoutCompletion.entered} holdout visitors finished.`);
      }
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        // Tolerate an API deployed before strict funnels existed.
        structuredContent: { ...data, strictOrder: data.strictOrder ?? true },
      };
    }),
  );
}
