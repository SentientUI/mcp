import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { uiMeta } from '../ui/index.js';
import {
  projectIdSchema,
  rangeInputSchema,
  rangeQuery,
  windowOutputSchema,
  windowLine,
  withApiErrorGuidance,
  fetchAllComponents,
  settled,
  throwIfNotDegradable,
  untrusted,
  UNTRUSTED_FIELDS_NOTE,
  type RangeArgs,
} from './common.js';
import {
  EVIDENCE_LABEL,
  MIN_EVIDENCE_SAMPLE,
  VERDICT_TEXT,
  baselineOf,
  isLowSample,
  rateWithN,
  readEvidenceState,
  readEvidenceStats,
  verdictOf,
  type Verdict,
} from './evidence.js';

type PerfComponentRow = {
  component_id: string;
  /** The baseline the server measured evidence against (absent on older APIs). */
  control_id?: string | null;
  baseline_explicit?: boolean;
  variants: Array<{
    variant_id: string;
    impressions?: number;
    exposed_sessions?: number;
    conversions?: number;
    evidence_state?: unknown;
    evidence_stats?: unknown;
    /** Windowed session-CVR verdict vs the baseline (absent on older APIs; null on the baseline). */
    window_evidence?: unknown;
  }>;
};

type TrendsResponse = {
  // componentId is absent on APIs older than the per-component keying; those
  // rows are a blend across every component sharing the variant id.
  cvr?: Array<{ componentId?: string; variantId: string; currentCvr: number; priorCvr: number; deltaPp: number; priorImpressions?: number }>;
  momentum?: Array<{ componentId?: string; variantId: string; direction: string }>;
};

export function registerComponentTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'list_components',
    {
      title: 'List components',
      description:
        'List all adaptive components in a project with variant counts and impression totals. ' +
        'Counts cover all retained data by default; pass range or from/to for a window.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema, ...rangeInputSchema('all') },
      outputSchema: {
        components: z
          .array(
            z.object({
              componentId: z.string(),
              variantCount: z.number(),
              impressions: z.number(),
              conversions: z.number(),
            }),
          )
          .describe('Adaptive components in the project (empty if none)'),
        total: z.number().describe('Total components in the project — larger than the list when truncated'),
        truncated: z.boolean().describe('True when the fetch cap was hit before listing every component'),
        window: windowOutputSchema,
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async ({ projectId, range, from, to }: { projectId: string } & RangeArgs) => {
      // "List all" used to destructure the first page of a paginated envelope
      // (API default: 50/page), so a project's 51st component silently never
      // existed as far as any agent could tell. Fetch every page (bounded) and
      // say so when the bound cuts the list short.
      const { components, total, window, truncated } = await fetchAllComponents<{
        component_id: string;
        total_impressions: number;
        total_conversions: number;
        variants: Array<{ variant_id: string }>;
      }>(client, projectId, { rangeArgs: { range, from, to } });

      const structuredContent = {
        components: components.map((c) => ({
          componentId: c.component_id,
          variantCount: c.variants.length,
          impressions: c.total_impressions,
          conversions: c.total_conversions,
        })),
        total,
        truncated,
        window,
      };

      if (!components.length) {
        return {
          content: [{ type: 'text' as const, text: 'No components found for this project.' }],
          structuredContent,
        };
      }

      // Component ids come from the page (and from the public ingest path), so
      // they are visitor-mintable strings — delimit them (see untrusted()).
      const lines = components.map((c) =>
        `- ${untrusted(c.component_id)}: ${c.variants.length} variants, ${c.total_impressions} impressions, ${c.total_conversions} conversions`
      );
      if (truncated) {
        lines.push(`Showing ${components.length} of ${total} components — fetch cap reached; the rest exist but are not listed here.`);
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
    }),
  );

  server.registerTool(
    'get_variant_performance',
    {
      title: 'Variant performance',
      description:
        'Per-variant conversion over the selected window (default: last 7 calendar days), keyed by ' +
        'component AND variant, each rate with its sample (converting sessions / exposed sessions). ' +
        'Each non-baseline variant carries the server\'s evidence verdict against its component\'s ' +
        'baseline arm (100-visit floor on both arms, multiple-comparison-corrected bars): `verdict` judges the ' +
        'windowed rate this row prints when the server sends window evidence (`verdictBasis` = window), and ' +
        'falls back to the all-time verdict on older APIs (`verdictBasis` = all_time). The all-time verdict is ' +
        'also reported separately as reliability (`evidenceState`, `reliabilityVerdict`). ' +
        'Only ahead/behind is a comparative result; raw rates are not a ranking. ' +
        'The change vs the preceding window is an untested descriptor.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema, ...rangeInputSchema('7d') },
      _meta: uiMeta('variant-performance'),
      outputSchema: {
        variants: z
          .array(
            z.object({
              componentId: z.string(),
              variantId: z.string().describe('Unique only WITHIN its component — key rows by componentId + variantId'),
              isBaseline: z.boolean().describe('The arm the server measures the others against'),
              baselineExplicit: z
                .boolean()
                .describe("False when no arm is named 'control' and the baseline is just the alphabetically-first id"),
              sessions: z.number().describe('Exposed sessions in the window (the n of currentCvr)'),
              conversions: z.number().describe('Converting sessions in the window'),
              currentCvr: z.number().nullable().describe('conversions / sessions over the window (0-1); null at 0 sessions'),
              lowSample: z.boolean().describe(`True under ${MIN_EVIDENCE_SAMPLE} sessions — the rate is not interpretable on its own`),
              evidenceState: z
                .string()
                .nullable()
                .describe('Reliability (all time): the server\'s ALL-TIME evidence state vs the baseline on direct evidence — not_enough_data | early_signal | moderate_evidence | strong_evidence | inconclusive; null for the baseline or when not provided. Not a verdict on the windowed rate'),
              probBeatsBaseline: z.number().nullable().describe('P(this arm > baseline), all-time, from the server; null when not provided'),
              reliabilityVerdict: z
                .enum(['baseline', 'ahead', 'behind', 'unclear', 'no_evidence'])
                .describe('The all-time verdict read from evidenceState — reliability (all time), which can differ from `verdict` on the window'),
              windowEvidenceState: z
                .string()
                .nullable()
                .describe('The server\'s evidence state on the WINDOWED session conversion rate vs the baseline; null for the baseline, when the arm was not scored in the window, or on older APIs'),
              windowProbBeatsBaseline: z.number().nullable().describe('P(this arm > baseline) on the windowed rate; null when not provided'),
              verdict: z
                .enum(['baseline', 'ahead', 'behind', 'unclear', 'no_evidence'])
                .describe('The only comparative claim this row supports about the windowed rate. ahead/behind = decided at the corrected strong bar; unclear = not separated'),
              verdictBasis: z
                .enum(['window', 'all_time'])
                .describe('window = verdict judges this window\'s rate (server window_evidence); all_time = older API, verdict is the all-time one'),
              priorCvr: z.number().nullable().describe('Rate over the preceding window; null when unavailable (see trendNote)'),
              priorSessions: z.number().nullable().describe('n of priorCvr'),
              deltaPp: z.number().nullable().describe('Change vs the preceding window in percentage points — untested'),
              momentum: z.string().nullable().describe('rising | falling | flat vs the preceding window (±15% relative, 100 per window) — an untested descriptor, never a comparison between arms'),
              trendNote: z.string().nullable().describe('Why the preceding-window fields are null, when they are'),
            }),
          )
          .describe('Per-(component, variant) performance (empty if no data yet)'),
        truncated: z.boolean().describe('True when the component fetch cap was hit before every component was read'),
        window: windowOutputSchema,
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async ({ projectId, range, from, to }: { projectId: string } & RangeArgs) => {
      const id = encodeURIComponent(projectId);
      const [componentsRes, trendsRes] = await Promise.all([
        settled(fetchAllComponents<PerfComponentRow>(client, projectId, { rangeArgs: { range, from, to } })),
        settled(client.get<TrendsResponse>(`/projects/${id}/trends${rangeQuery({ range, from, to })}`)),
      ]);
      // The components payload is the primary source (per-component counts and
      // the server's evidence); without it there is nothing honest to say, so
      // its failure is the tool's failure. /trends is optional context.
      throwIfNotDegradable([componentsRes, trendsRes]);
      if (!componentsRes.ok) throw componentsRes.error;
      const { components, window, truncated } = componentsRes.value;
      const trends = trendsRes.ok ? trendsRes.value : null;

      // /trends is keyed by (componentId, variantId). An older API grouped by
      // variant_id ONLY, so a `control` present on three components came back
      // as one blended row — this tool used to print that blend under every
      // component's "control". Against such an API (rows without componentId)
      // a trend row is still attached only where the variant id is unique
      // project-wide.
      const KEY_SEP = '\x00';
      const keyOf = (componentId: string, variantId: string) => `${componentId}${KEY_SEP}${variantId}`;
      const keyed = (trends?.cvr ?? []).some((t) => typeof t.componentId === 'string');
      const idCount = new Map<string, number>();
      for (const c of components) for (const v of c.variants) idCount.set(v.variant_id, (idCount.get(v.variant_id) ?? 0) + 1);
      const trendByKey = new Map(
        (trends?.cvr ?? []).map((t) => [keyed ? keyOf(t.componentId ?? '', t.variantId) : t.variantId, t]),
      );
      const momentumByKey = new Map(
        (trends?.momentum ?? []).map((m) => [keyed ? keyOf(m.componentId ?? '', m.variantId) : m.variantId, m.direction]),
      );

      type Row = {
        componentId: string; variantId: string; isBaseline: boolean; baselineExplicit: boolean;
        sessions: number; conversions: number; currentCvr: number | null; lowSample: boolean;
        evidenceState: string | null; probBeatsBaseline: number | null; reliabilityVerdict: Verdict;
        windowEvidenceState: string | null; windowProbBeatsBaseline: number | null;
        verdict: Verdict; verdictBasis: 'window' | 'all_time';
        priorCvr: number | null; priorSessions: number | null; deltaPp: number | null;
        momentum: string | null; trendNote: string | null;
      };
      const rows: Row[] = [];
      const textBlocks: string[] = [];
      let sessionUnit = 'sessions';
      let anyAllTimeBasis = false;

      for (const c of components) {
        if (!c.variants.length) continue;
        const baseline = baselineOf(c);
        const block: string[] = [];
        block.push(
          `${untrusted(c.component_id)} — baseline ${baseline ? untrusted(baseline.id) : '(none)'}` +
            (baseline && !baseline.explicit ? " (no arm is named 'control'; the baseline is the alphabetically-first id, an arbitrary choice)" : ''),
        );
        if (c.variants.length < 2) block.push('  Only one arm — nothing to compare.');

        for (const v of c.variants) {
          // exposed_sessions is the rate's real denominator (sticky sessions
          // re-fire variant_assigned on reload). An API without it falls back to
          // impressions, and the unit says so.
          const hasSessions = typeof v.exposed_sessions === 'number';
          if (!hasSessions) sessionUnit = 'impressions';
          const n = hasSessions ? v.exposed_sessions! : (v.impressions ?? 0);
          const conv = v.conversions ?? 0;
          const isBaseline = v.variant_id === baseline?.id;
          const state = readEvidenceState(v.evidence_state);
          const stats = readEvidenceStats(v.evidence_stats);
          const reliabilityVerdict = verdictOf(state, stats, isBaseline);
          // The verdict sat beside the WINDOWED rate but was the ALL-TIME one —
          // an arm could read "reliably AHEAD" on a window where it trailed.
          // window_evidence judges the same rate over the same window; the
          // all-time state is reported separately as reliability. An older API
          // (key absent) keeps the all-time verdict, labelled as such.
          const hasWindow = v.window_evidence !== undefined;
          const wState = hasWindow ? readEvidenceState((v.window_evidence as { state?: unknown } | null)?.state) : null;
          const wStats = hasWindow ? readEvidenceStats(v.window_evidence) : null;
          const verdict = hasWindow ? verdictOf(wState, wStats, isBaseline) : reliabilityVerdict;
          const verdictBasis: 'window' | 'all_time' = hasWindow ? 'window' : 'all_time';
          if (!hasWindow && !isBaseline) anyAllTimeBasis = true;

          let priorCvr: number | null = null;
          let priorSessions: number | null = null;
          let deltaPp: number | null = null;
          let momentum: string | null = null;
          let trendNote: string | null = null;
          const trendKey = keyed ? keyOf(c.component_id, v.variant_id) : v.variant_id;
          const t = trendByKey.get(trendKey);
          if (!trends) {
            trendNote = 'Preceding-window data unavailable (the trends request failed).';
          } else if (!keyed && (idCount.get(v.variant_id) ?? 0) > 1) {
            trendNote = `Variant id is shared by ${idCount.get(v.variant_id)} components and the trends endpoint does not separate them, so no per-component preceding-window rate is available.`;
          } else if (!t) {
            trendNote = 'No preceding-window data for this variant.';
          } else {
            priorCvr = t.priorCvr;
            priorSessions = typeof t.priorImpressions === 'number' ? t.priorImpressions : null;
            deltaPp = t.deltaPp;
            const dir = momentumByKey.get(trendKey);
            momentum = dir === 'gaining' ? 'rising' : dir === 'losing' ? 'falling' : dir ? 'flat' : null;
          }

          rows.push({
            componentId: c.component_id,
            variantId: v.variant_id,
            isBaseline,
            baselineExplicit: baseline?.explicit ?? false,
            sessions: n,
            conversions: conv,
            currentCvr: n > 0 ? conv / n : null,
            lowSample: isLowSample(n),
            evidenceState: state,
            probBeatsBaseline: stats?.probBeatsControl ?? null,
            reliabilityVerdict,
            windowEvidenceState: wState,
            windowProbBeatsBaseline: wStats?.probBeatsControl ?? null,
            verdict,
            verdictBasis,
            priorCvr,
            priorSessions,
            deltaPp,
            momentum,
            trendNote,
          });

          const parts = [`  - ${untrusted(v.variant_id)}${isBaseline ? ' (baseline)' : ''}: ${rateWithN(conv, n, hasSessions ? 'sessions' : 'impressions')}`];
          if (!isBaseline && c.variants.length > 1) {
            if (verdictBasis === 'window') {
              parts.push(
                verdict === 'no_evidence'
                  ? 'evidence (this window): not scored by the server'
                  : `evidence (this window): ${EVIDENCE_LABEL[wState!]} — ${VERDICT_TEXT[verdict as Exclude<Verdict, 'baseline'>]}`,
              );
              parts.push(
                reliabilityVerdict === 'no_evidence'
                  ? 'reliability (all time): none available'
                  : `reliability (all time): ${EVIDENCE_LABEL[state!]}`,
              );
            } else {
              parts.push(
                verdict === 'no_evidence'
                  ? 'evidence: none available from the server'
                  : `evidence: ${EVIDENCE_LABEL[state!]} — ${VERDICT_TEXT[verdict as Exclude<Verdict, 'baseline'>]}`,
              );
            }
          }
          if (priorCvr !== null && deltaPp !== null) {
            const pn = priorSessions !== null ? ` (n=${priorSessions})` : '';
            parts.push(
              `vs preceding window: ${(priorCvr * 100).toFixed(2)}%${pn}, ${deltaPp > 0 ? '+' : ''}${deltaPp.toFixed(1)} pp` +
                `${momentum ? `, ${momentum}` : ''} (untested)`,
            );
          }
          block.push(parts.join(' · '));
        }
        textBlocks.push(block.join('\n'));
      }

      const structuredContent = { variants: rows, truncated, window };

      if (!rows.length) {
        return {
          content: [{ type: 'text' as const, text: 'No variant data available yet.' }],
          structuredContent,
          _meta: uiMeta('variant-performance'),
        };
      }

      const header = [
        windowLine(window),
        `Rates: converting ${sessionUnit} ÷ exposed ${sessionUnit} in the window. ` +
          (anyAllTimeBasis
            ? "Evidence: the server's ALL-TIME comparison of each arm against its component's baseline (this API sends no windowed verdict) — "
            : "Evidence (this window): the server's comparison of each arm's windowed rate against its component's baseline; " +
              'reliability (all time): the all-time verdict on direct evidence, which can differ — ') +
          'only "ahead"/"behind" is a result; do not rank arms by raw rate.',
      ].filter(Boolean);
      const footer = truncated ? ['', 'Fetch cap reached — some components are not listed.'] : [];
      const text = [...header, '', textBlocks.join('\n\n'), ...footer].join('\n');
      return { content: [{ type: 'text' as const, text }], structuredContent, _meta: uiMeta('variant-performance') };
    }),
  );
}
