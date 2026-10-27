import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import {
  projectIdSchema,
  rangeInputSchema,
  rangeQuery,
  untrusted,
  windowLine,
  windowOutputSchema,
  withApiErrorGuidance,
  UNTRUSTED_FIELDS_NOTE,
  type RangeArgs,
  type WindowMeta,
} from './common.js';

type SegmentLift = {
  key: string;
  kind: string;
  evidence: string;
  testStarted: boolean;
  liftPct: number | null;
  diffInterval: { lower: number; upper: number } | null;
  pValue: number | null;
  rates: { adapted: number; control: number } | null;
  adapted: { visitors: number; conversions: number };
  control: { visitors: number; conversions: number };
  epochs: number;
};
type HoldoutLift = {
  basis: string;
  allTime: boolean;
  goal: string;
  alpha: number;
  family: number;
  minPerArm: number;
  units: number;
  unclassified: number;
  contexts: SegmentLift[];
  channels: SegmentLift[];
};
type Transitions = {
  pairs: number;
  visitors: number;
  rows: Array<{ from: string; nextVisits: number; to: Array<{ stage: string; visits: number; visitors: number; share: number }> }>;
};
type StageReport = {
  enabled: boolean;
  contextType: string | null;
  mode: string | null;
  observational: boolean;
  sessions: number;
  hinted: number;
  stages: Array<{ stage: string; sessions: number; share: number; observed: number; hinted: number }>;
  channels: Array<{ channel: string; sessions: number; conversions: number; conversionRate: number | null }>;
  arrivals: Array<{ channel: string; stage: string; sessions: number; conversions: number; conversionRate: number | null }>;
  contexts: Array<{ context: string; kind: string; sessions: number }>;
  holdoutLift?: HoldoutLift | null;
  transitions?: Transitions;
  arms: Array<{
    slotId: string; slotName: string; context: string; arm: string; isControl: boolean;
    trials: number; credited: number; rate: number | null; evidence: string | null; probBeatsControl: number | null;
  }>;
  window?: WindowMeta;
};

const pct = (v: number | null) => (v == null ? 'n/a (too few sessions)' : `${(v * 100).toFixed(1)}%`);
const counts = z.object({ visitors: z.number(), conversions: z.number() });
const segmentLift = z.object({
  key: z.string(),
  kind: z.string().describe('stage | arrival | channel'),
  evidence: z.string().describe('collecting | awaiting_conversions | not_significant | significant_positive | significant_negative'),
  testStarted: z.boolean().describe('False until the series has 100 visitors per side and 10 conversions (its test scale is then fixed)'),
  liftPct: z.number().nullable().describe('Relative lift %, null while collecting / awaiting conversions'),
  diffInterval: z.object({ lower: z.number(), upper: z.number() }).nullable().describe('Always-valid range on the absolute rate difference (fractions)'),
  pValue: z.number().nullable(),
  rates: z.object({ adapted: z.number(), control: z.number() }).nullable(),
  adapted: counts,
  control: counts,
  epochs: z.number(),
});

/** Plain words for a lift verdict — "Early" never reads as a result. */
function liftWords(l: SegmentLift, minPerArm: number): string {
  const n = `adapted ${l.adapted.visitors} / control ${l.control.visitors} visitors`;
  switch (l.evidence) {
    case 'collecting':
      return `early — ${n}; a number shows at ${minPerArm} per side`;
    case 'awaiting_conversions':
      return `early — ${n}; waiting on control-group conversions`;
    case 'not_significant':
      return `not proven yet${l.liftPct != null ? ` (${l.liftPct > 0 ? '+' : ''}${l.liftPct}%, could be chance)` : ''}${l.testStarted ? '' : ' — test not started'} — ${n}`;
    case 'significant_positive':
    case 'significant_negative':
      return `tested: ${l.liftPct != null && l.liftPct > 0 ? '+' : ''}${l.liftPct}% conversion${l.evidence === 'significant_negative' ? ' (worse)' : ''}${l.diffInterval ? `, range ${(l.diffInterval.lower * 100).toFixed(2)} to ${(l.diffInterval.upper * 100).toFixed(2)} pts` : ''} — ${n}`;
    default:
      return n;
  }
}

export function registerStageTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_stage_breakdown',
    {
      title: 'Funnel-stage breakdown',
      // Mirrors GET /projects/:id/stage-report. Says OBSERVATIONAL in the
      // description because nothing serves on stage yet: an agent must not
      // read a per-context arm result as "stage-based serving would win".
      description:
        'E-commerce projects: where visitors are in buying (new, browsing, carted, customer, lapsed) — share of human ' +
        'sessions per stage (each session counted once, at its latest recorded stage; hinted = set by a tagged campaign, ' +
        'not observed history), arrival channel x stage with conversion, how visitors moved between stages from one ' +
        'visit to the next, the TESTED holdout lift per first-visit context and per first-visit arrival channel (the ' +
        'same always-valid test as the headline lift, all-time, alpha split over all 23 possible series; "collecting" ' +
        'and "awaiting_conversions" are early, not results), and each region\'s versions per context judged against the ' +
        'original with the per-audience evidence rule. OBSERVATIONAL: nothing is served by stage yet; the per-context ' +
        'results are what stage-based serving would have to beat. Defaults to the last 30 days; pass range or from/to. ' +
        'Returns enabled:false when the project does not record stages.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema, ...rangeInputSchema('30d') },
      outputSchema: {
        enabled: z.boolean().describe('False when the project does not record funnel stages (settings.stage absent)'),
        mode: z.string().nullable().describe("'record' (reporting only) — serving by stage is not available yet"),
        sessions: z.number().describe('Human sessions with a recorded stage in the window'),
        hinted: z.number().describe('Of those, sessions whose stage came from a campaign tag, not observed history'),
        stages: z.array(z.object({ stage: z.string(), sessions: z.number(), share: z.number().describe('0-1'), observed: z.number(), hinted: z.number() })),
        channels: z.array(z.object({ channel: z.string(), sessions: z.number(), conversions: z.number(), conversionRate: z.number().nullable() })),
        arrivals: z.array(z.object({ channel: z.string(), stage: z.string(), sessions: z.number(), conversions: z.number(), conversionRate: z.number().nullable().describe('null below 30 sessions') })),
        contexts: z.array(z.object({
          context: z.string(), kind: z.string().describe('stage | arrival'), sessions: z.number(),
        })),
        holdoutLift: z.object({
          basis: z.string().describe("'first_visit': visitors grouped by their first visit's context/channel"),
          allTime: z.boolean().describe('True: the window does not apply to the lift'),
          goal: z.string(),
          alpha: z.number().describe('Per-series alpha after the correction'),
          family: z.number(),
          minPerArm: z.number(),
          units: z.number(),
          unclassified: z.number().describe('Exposed visitors with no first-visit record (exposed before recording began)'),
          contexts: z.array(segmentLift),
          channels: z.array(segmentLift),
        }).nullable().optional(),
        transitions: z.object({
          pairs: z.number().describe('Consecutive recorded visits in the window'),
          visitors: z.number(),
          rows: z.array(z.object({
            from: z.string(),
            nextVisits: z.number(),
            to: z.array(z.object({ stage: z.string(), visits: z.number(), visitors: z.number(), share: z.number().describe('0-1') })),
          })),
        }).optional(),
        arms: z.array(z.object({
          slotId: z.string(), slotName: z.string(), context: z.string(), arm: z.string(), isControl: z.boolean(),
          trials: z.number().describe('Closed trials'), credited: z.number().describe('Summed credited reward'),
          rate: z.number().nullable(), evidence: z.string().nullable().describe('Evidence state vs the original in this context; null on the original'),
          probBeatsControl: z.number().nullable(),
        })),
        window: windowOutputSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, range, from, to }: { projectId: string } & RangeArgs) => {
      const id = encodeURIComponent(projectId);
      const r = await client.get<StageReport>(`/projects/${id}/stage-report${rangeQuery({ range, from, to })}`);
      const structuredContent = {
        enabled: r.enabled,
        mode: r.mode,
        sessions: r.sessions,
        hinted: r.hinted,
        stages: r.stages,
        channels: r.channels,
        arrivals: r.arrivals,
        contexts: r.contexts,
        holdoutLift: r.holdoutLift ?? null,
        transitions: r.transitions,
        arms: r.arms,
        window: r.window,
      };
      const win = windowLine(r.window);

      if (!r.enabled) {
        const why = r.contextType === 'ecommerce'
          ? 'Funnel stages are switched off for this project (Settings → Funnel stages).'
          : 'Funnel stages are recorded for online stores only (site type: e-commerce).';
        return { content: [{ type: 'text' as const, text: why }], structuredContent };
      }
      if (r.sessions === 0) {
        return {
          content: [{ type: 'text' as const, text: `${win ? `${win}\n` : ''}No recorded stages in this window yet — recording starts with the first decision after it was switched on.` }],
          structuredContent,
        };
      }

      const lines = [
        ...(win ? [win] : []),
        'OBSERVATIONAL — nothing is served by stage yet.',
        `Sessions with a recorded stage: ${r.sessions} (${r.hinted} hinted by a tagged campaign).`,
        '',
        'Stage mix:',
        ...r.stages.map((s) => `- ${s.stage}: ${s.sessions} (${(s.share * 100).toFixed(1)}%)${s.hinted ? `, ${s.hinted} hinted` : ''}`),
        '',
        'Arrival channel x stage (conversion):',
        ...r.arrivals.map((a) => `- ${a.channel} / ${a.stage}: ${a.sessions} sessions, ${pct(a.conversionRate)}`),
      ];
      const t = r.transitions;
      if (t && t.rows.length > 0) {
        lines.push('', `Stage moves between visits (${t.pairs} next visits from ${t.visitors} returning visitors in the window):`);
        for (const row of t.rows) {
          lines.push(`- from ${row.from} (${row.nextVisits} next visits): ${row.to.map((x) => `${x.stage} ${(x.share * 100).toFixed(0)}%`).join(', ')}`);
        }
      }
      const h = r.holdoutLift;
      if (h && (h.contexts.length > 0 || h.channels.length > 0)) {
        lines.push(
          '',
          `Holdout lift by first-visit context and channel (tested, all-time — the window does not apply; alpha ${h.alpha.toPrecision(2)} per series over ${h.family}; ${h.unclassified} of ${h.units} visitors predate recording and are not in any row):`,
          ...h.contexts.map((l) => `- context ${l.key}: ${liftWords(l, h.minPerArm)}`),
          ...h.channels.map((l) => `- channel ${l.key}: ${liftWords(l, h.minPerArm)}`),
        );
      }
      if (r.arms.length > 0) {
        lines.push('', 'Versions per context (what stage-based serving would have to beat):');
        for (const a of r.arms) {
          // Slot names and arm ids come from the integrator's code / generated
          // versions — delimit them so they cannot pose as tool output.
          lines.push(
            `- ${untrusted(a.slotName)} / ${a.context} / ${untrusted(a.arm)}${a.isControl ? ' (original)' : ''}: ${a.trials} closed trials, rate ${a.rate == null ? 'n/a' : `${(a.rate * 100).toFixed(1)}%`}${a.evidence ? `, ${a.evidence}` : ''}`,
          );
        }
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
    }),
  );
}
