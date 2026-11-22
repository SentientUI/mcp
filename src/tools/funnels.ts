import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { projectIdSchema, withApiErrorGuidance, untrusted, codeSafe, UNTRUSTED_FIELDS_NOTE } from './common.js';

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

type Tracking = 'recorded' | 'defined' | 'silent' | 'none';
const trackingSchema = z.enum(['recorded', 'defined', 'silent', 'none']).nullable()
  .describe("What sends this step's goal: recorded (it has fired), defined (set up, nothing recorded yet, under 7 days), silent (set up 7+ days ago, never recorded), none (nothing sends it: no active definition and never fired, so this step can never fill). Null on an older API.");

/**
 * The dashboard's per-step wording, verbatim (`stepSourceText` in the
 * dashboard's funnel-view.ts; criteria in the API's funnel-step-sources.ts).
 * This said "never recorded — check the goal name" for every such step, so an
 * agent told that about a backend step nobody had wired went hunting for a
 * typo that was not there.
 */
export function stepSourceText(goalId: string, tracking: Tracking | null | undefined, definedDaysAgo: number | null | undefined): string | null {
  if (tracking === 'none') return `Nothing sends ${untrusted(goalId)} yet`;
  if (tracking === 'silent') return `${untrusted(goalId)} is set up but nothing has recorded it in ${definedDaysAgo ?? 7} days`;
  return null;
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
                    tracking: trackingSchema,
                    definedDaysAgo: z.number().nullable().describe('Days since an unfired goal was set up (null once it fires)'),
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
          steps: Array<{
            step_index: number; goal_id: string; weight: string | number | null;
            tracking?: Tracking; defined_days_ago?: number | null;
          }>;
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
            tracking: s.tracking ?? null,
            definedDaysAgo: s.defined_days_ago ?? null,
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
      const lines: string[] = [];
      let anyUnsourced = false;
      for (const f of structuredContent.funnels) {
        lines.push(`${untrusted(f.funnelId)} (${f.status}) — ${untrusted(f.displayName)}: ${f.steps.map((s) => untrusted(s.goalId)).join(' → ')}`);
        for (const s of f.steps) {
          const note = stepSourceText(s.goalId, s.tracking, s.definedDaysAgo);
          if (note) lines.push(`   step ${s.stepIndex + 1}: ${note}`);
          if (s.tracking === 'none') anyUnsourced = true;
        }
      }
      lines.push('', 'Reference a funnelId verbatim from code: <Adaptive funnel="<funnelId>">. Use get_funnel_report for drop-off numbers.');
      if (anyUnsourced) {
        lines.push('A step nothing sends can never fill: get_funnel_report gives the exact code to send it (useGoal in the browser, trackServerGoal on the server), or define it as a page visit with define_goal.');
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
    }),
  );

  server.registerTool(
    'get_funnel_report',
    {
      title: 'Funnel drop-off report',
      description:
        'Per-step reach and drop-off for one funnel over its conversion window (reach and drop-off are People: visitors who ran the page, interacted and passed the bot check; others who reached a step are in unconfirmedReached, from visitors we couldn\'t confirm as people, never inside a drop-off), with per-variant and audience splits per step, final-step revenue (the total, every visitor\'s orders, with unconfirmedRevenue beside it; avg order and per-entering-visitor are People\'s), and the holdout ("without optimization") comparison.' + UNTRUSTED_FIELDS_NOTE,
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
              reached: z.number().describe('Distinct People reaching this step in-window, the control group included (reachedControl of them)'),
              unconfirmedReached: z.number().nullable().describe("Visitors we couldn't confirm as people who reached this step (the API's own remainder; not in reached or any drop-off); null on an older API"),
              dropOffFromPrevious: z.number().nullable().describe('1 - reached/previousReached (null on the first step)'),
              neverFired: z.boolean().describe('Legacy: no definition in any status and never recorded. Prefer tracking'),
              tracking: trackingSchema,
              definedDaysAgo: z.number().nullable().describe('Days since an unfired goal was set up (null once it fires)'),
              fromCode: z.object({
                client: z.string().describe('Browser code: useGoal from @sentientui/react'),
                server: z.string().describe('Server code: trackServerGoal from @sentientui/react/server'),
                serverCall: z.string(),
              }).nullable().describe("Exact code that sends this step's goal, present until it first fires. Repeat it verbatim."),
              variants: z.array(z.object({
                componentId: z.string(),
                variantId: z.string(),
                reached: z.number(),
                assigned: z.number().describe('Distinct sessions served this variant in-window (the rate denominator)'),
              })),
              personas: z.array(z.object({ label: z.string(), reached: z.number() })),
            }),
          ),
        revenue: z.number().nullable().describe('Final-step revenue in the project currency: the total, every visitor\'s orders plus orders with no visit (null when no valued conversions)'),
        unconfirmedRevenue: z.number().nullable().describe("The part of revenue from visitors we couldn't confirm as people (the API's own remainder); null when none or on an older API"),
        avgOrderValue: z.number().nullable().describe("People's revenue per People order"),
        revenuePerEnteringVisitor: z.number().nullable().describe("People's revenue per People entering the funnel"),
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
          stepIndex: number; goalId: string; displayName: string; reached: number; unconfirmedReached?: number;
          dropOffFromPrevious: number | null; neverFired: boolean;
          tracking?: Tracking; definedDaysAgo?: number | null;
          fromCode?: { client: string; server: string; serverCall: string } | null;
          variants: Array<{ componentId: string; variantId: string; reached: number; assigned: number }>;
          personas: Array<{ label: string; reached: number }>;
        }>;
        revenue: number | null;
        unconfirmedRevenue?: number | null;
        avgOrderValue: number | null;
        revenuePerEnteringVisitor: number | null;
        holdoutCompletion: { entered: number; reached: number } | null;
      }>(`/projects/${encodeURIComponent(projectId)}/funnels/${encodeURIComponent(funnelId)}/report`);

      // Step names come from goal display names and variant/component ids from
      // the public ingest path — all visitor-mintable, so delimit them.
      const lines: string[] = [`${untrusted(data.displayName)} — last ${data.windowDays} days`];
      for (const s of data.steps) {
        // An API from before step sources sends only neverFired: read it as
        // "nothing sends it", as the dashboard does.
        const tracking: Tracking | null = s.tracking ?? (s.neverFired ? 'none' : null);
        const note = stepSourceText(s.goalId, tracking, s.definedDaysAgo);
        lines.push(
          `${s.stepIndex + 1}. ${untrusted(s.displayName)}: ${s.reached} People reached` +
          (s.unconfirmedReached ? ` (${s.unconfirmedReached} more from visitors we couldn't confirm as people)` : '') +
          stepChangeText(s.dropOffFromPrevious) +
          (note ? ` [${note}]` : ''),
        );
        // The API's code, verbatim — never rebuilt here, so it cannot drift
        // from what the dashboard shows. Only for a code-safe goal id: the
        // agent is told to paste this, and a minted name must not ride in it.
        if (tracking === 'none' && s.fromCode && codeSafe(s.goalId) === s.goalId) {
          lines.push('   Send it from your server:', ...s.fromCode.server.split('\n').map((l) => `     ${l}`));
          lines.push('   …or from the browser:', ...s.fromCode.client.split('\n').map((l) => `     ${l}`));
        }
        for (const v of s.variants) {
          lines.push(`   ${untrusted(v.componentId)}/${untrusted(v.variantId)}: ${v.reached}/${v.assigned} assigned sessions reached this step`);
        }
      }
      if (data.revenue != null) {
        lines.push(
          `Revenue: ${data.revenue.toFixed(2)} ${data.currency}` +
          // The API's remainder, verbatim: no arithmetic here, or this line
          // would print a figure the dashboard does not.
          (data.unconfirmedRevenue != null && data.unconfirmedRevenue !== 0
            ? ` (${data.unconfirmedRevenue.toFixed(2)} ${data.currency} from visitors we couldn't confirm as people)`
            : '') +
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
        structuredContent: {
          ...data,
          strictOrder: data.strictOrder ?? true,
          unconfirmedRevenue: data.unconfirmedRevenue ?? null,
          steps: data.steps.map((s) => ({
            ...s,
            unconfirmedReached: s.unconfirmedReached ?? null,
            tracking: s.tracking ?? null,
            definedDaysAgo: s.definedDaysAgo ?? null,
            fromCode: s.fromCode ?? null,
          })),
        },
      };
    }),
  );
}
