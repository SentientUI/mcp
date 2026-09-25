import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import {
  projectIdSchema,
  withApiErrorGuidance,
  fetchAllComponents,
  settled,
  throwIfNotDegradable,
  untrusted,
  UNTRUSTED_FIELDS_NOTE,
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
  type EvidenceStateId,
  type Verdict,
} from './evidence.js';
import { findingIsAbout } from './insights.js';

/**
 * How far the server's evidence has got on this component — keyed on the
 * evidence tiers (CONTRACTS.md §5), never on a traffic count. This was
 * 'sufficient' at 500 impressions (plus fresh insights and persona
 * reliability), a threshold in no contract: 500 impressions split over four
 * arms is 125 each, and says nothing about whether any two of them differ —
 * yet the brief then told the agent to "target the underperforming variant".
 */
type DataState = 'empty' | 'collecting' | 'directional' | 'decided';

type ProjectRow = { id: string; name: string; context_type: string };

type ComponentRow = {
  component_id: string;
  control_id?: string | null;
  baseline_explicit?: boolean;
  total_impressions: number;
  total_exposed_sessions?: number;
  total_conversions: number;
  variants: Array<{
    variant_id: string;
    impressions?: number;
    exposed_sessions?: number;
    conversions?: number;
    evidence_state?: unknown;
    evidence_stats?: unknown;
  }>;
};

type PortraitsResponse = {
  clusters?: Array<{ label: string; sessionCount: number; avgReliability: number }>;
  totalSessions?: number;
};

type ReportFinding = {
  tier: string;
  kind: string;
  headline: string;
  surface?: string | null;
  componentId?: string | null;
  interpreted: boolean;
  provenance: { sample: number; denominatorLabel: string };
};

type EvidenceReport = {
  findings?: ReportFinding[];
  freshness?: { isStale: boolean };
};

/** Project-wide measured findings quoted beside the component's own. */
const PROJECT_FINDINGS_CAP = 3;

// Best-practice priors applied when there is not enough data to be data-driven.
// Keyed by the project's context_type so "do what you think is best" stays
// grounded and consistent rather than arbitrary.
const BEST_PRACTICE_PRIORS: Record<string, string[]> = {
  ecommerce: [
    'Lead with the core benefit/value, not features.',
    'Make the primary action (add to cart / buy) unmistakable and high-contrast.',
    'Reduce purchase anxiety near the decision: free returns, shipping, secure checkout, guarantees.',
    'Add credible social proof (ratings, review count, "X sold").',
    'Use urgency/scarcity only when it is genuinely true (low stock, real deadline).',
    'Cut friction: fewer steps, clearer pricing, no surprise costs.',
  ],
  saas: [
    'Lead with the outcome the user gets, not the mechanism.',
    'Make the primary CTA action-oriented and specific (e.g. "Start free trial").',
    'Reduce signup friction (fewer fields, SSO, "no credit card required").',
    'Add proof near the CTA: customer logos, a hard metric, a short testimonial.',
    "Address the target persona's top objection inline.",
  ],
  landing: [
    'One clear message and one primary action above the fold.',
    'Match the headline to the traffic source / campaign intent.',
    'Make the CTA specific and benefit-led.',
    'Add a single strong proof point; remove competing distractions.',
  ],
  marketplace: [
    'Reduce choice overload: guide the visitor to a clear next step.',
    'Surface trust and liquidity signals (ratings, counts, recency).',
    'Make the primary action on each listing obvious.',
    'Reassure on safety/guarantees near the point of decision.',
  ],
};

const GENERIC_PRIORS = [
  'Make the primary action unmistakable and benefit-led.',
  'Lead with the outcome/value for the visitor.',
  'Remove friction and distractions around the decision.',
  'Add one credible proof point near the action.',
];

function priorsFor(contextType: string): string[] {
  return BEST_PRACTICE_PRIORS[contextType] ?? GENERIC_PRIORS;
}

type ArmReading = {
  variantId: string;
  isBaseline: boolean;
  n: number;
  conversions: number;
  state: EvidenceStateId | null;
  verdict: Verdict;
};

function computeDataState(sessions: number, arms: ArmReading[]): DataState {
  if (sessions === 0) return 'empty';
  const challengers = arms.filter((a) => !a.isBaseline);
  if (challengers.some((a) => a.verdict === 'ahead' || a.verdict === 'behind')) return 'decided';
  if (challengers.some((a) => a.state !== null && a.state !== 'not_enough_data')) return 'directional';
  return 'collecting';
}

function guidanceFor(dataState: DataState, contextType: string, arms: ArmReading[]): string {
  switch (dataState) {
    case 'decided': {
      const ahead = arms.filter((a) => a.verdict === 'ahead').map((a) => untrusted(a.variantId));
      const behind = arms.filter((a) => a.verdict === 'behind').map((a) => untrusted(a.variantId));
      const facts = [
        ahead.length ? `reliably ahead of the baseline: ${ahead.join(', ')}` : '',
        behind.length ? `reliably behind the baseline: ${behind.join(', ')}` : '',
      ].filter(Boolean).join('; ');
      return `The server's evidence has decided at least one comparison (${facts}). Build on what is ahead or move away from what is behind, and name that arm as your basis. Every other arm is still undecided — do not read its raw rate as a ranking.`;
    }
    case 'directional': {
      const inconclusive = arms.some((a) => a.state === 'inconclusive');
      return (
        'No comparison on this component is decided. Early and moderate signals are hypotheses, not results (moderate evidence is wrong about one time in five), so do not target an arm as "under-" or "out-performing". ' +
        (inconclusive
          ? 'At least one arm ran a full period without separating from the baseline — the existing versions do not differ meaningfully, so make a clearly different change rather than a tweak. '
          : '') +
        'Lean on the best-practice priors below and make one focused change.'
      );
    }
    case 'collecting':
      if (!arms.some((a) => !a.isBaseline)) {
        return 'Only one arm is serving, so nothing is being compared yet — its rate says nothing about what would do better. Apply the best-practice priors below and make one focused change; adding it creates the first comparison.';
      }
      return `Not enough data for any comparison yet (each arm and the baseline need ${MIN_EVIDENCE_SAMPLE} visits before the server judges them). The rates above are not a ranking. Apply the best-practice priors below and make one focused change rather than a redesign.`;
    case 'empty':
      return `No data yet — use your best judgment. Apply the best-practice priors for a ${contextType} surface below. Make one conservative, high-confidence change, and consider enabling shadow mode (a project-level setting) so it is validated before it serves real traffic.`;
  }
}

export function registerVariantBriefTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_variant_brief',
    {
      title: 'Variant brief',
      description: 'Get an evidence-driven brief for creating a new CODE-NATIVE variant of a component. Returns each existing variant\'s rate with its sample and the server\'s evidence verdict against the baseline, the audience, the measured findings about this component, an evidence-state assessment (empty / collecting / directional / decided — with a best-practice fallback when nothing is decided), and step-by-step instructions for writing the variant in the customer\'s code. Use this instead of create_variant when the variant will live in the codebase.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: {
        projectId: projectIdSchema,
        componentId: z.string().describe('The component ID to write a new variant for (matches <Adaptive id="...">).'),
      },
      outputSchema: {
        componentId: z.string(),
        contextType: z.string().describe("The project's context type (or 'unknown')"),
        dataState: z
          .enum(['empty', 'collecting', 'directional', 'decided'])
          .describe(
            "Evidence state of the component (server evidence tiers, CONTRACTS §5): empty = no sessions; collecting = no arm past the 100-visit floor vs the baseline; directional = signals but nothing decided; decided = at least one arm reliably ahead/behind the baseline",
          ),
        variants: z
          .array(
            z.object({
              variantId: z.string(),
              isBaseline: z.boolean(),
              sessions: z.number().describe('All-time exposed sessions (the n of the rate)'),
              conversions: z.number(),
              lowSample: z.boolean(),
              evidenceState: z.string().nullable(),
              verdict: z.enum(['baseline', 'ahead', 'behind', 'unclear', 'no_evidence']),
            }),
          )
          .describe('Existing arms with their sample and the server evidence verdict'),
        existingVariantIds: z.array(z.string()).describe('Variant IDs already in use (do not reuse)'),
        priors: z.array(z.string()).describe('Best-practice priors applied for this context type'),
        markdown: z.string().describe('The full variant brief in Markdown'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async ({ projectId, componentId }) => {
      const id = encodeURIComponent(projectId);

      const [projectsRes, componentsRes, portraitsRes, reportRes] = await Promise.all([
        settled(client.get<ProjectRow[]>('/projects')),
        // Paginated: the target component may live past page 1 (API default 50),
        // so page until it is found — find()ing only the first page reported
        // component #51 as "no data yet" and pushed the agent onto priors.
        settled(fetchAllComponents<ComponentRow>(client, projectId, {
          maxPages: 25,
          foundWhen: (fetched) => fetched.some((c) => c.component_id === componentId),
        })),
        settled(client.get<PortraitsResponse>(`/projects/${id}/portraits`)),
        // The measured evidence report, NOT the legacy /insights narrator: that
        // endpoint's bullets are free LLM text ("v_b converts at 120.00% CVR")
        // and were relayed verbatim and undelimited (audit M2).
        settled(client.get<EvidenceReport>(`/projects/${id}/evidence-report`)),
      ]);
      // Never let an auth/access failure (or a total outage) degrade into a
      // confident "no data yet — proceed with priors" brief.
      throwIfNotDegradable([projectsRes, componentsRes, portraitsRes, reportRes]);

      const projects = projectsRes.ok ? projectsRes.value : null;
      const portraits = portraitsRes.ok ? portraitsRes.value : null;
      const report = reportRes.ok ? reportRes.value : null;

      const project = projects?.find((p) => p.id === projectId) ?? null;
      const contextType = project?.context_type ?? 'unknown';

      const components = componentsRes.ok ? componentsRes.value.components : [];
      const component = components.find((c) => c.component_id === componentId) ?? null;
      const existingVariantIds = component?.variants.map((v) => v.variant_id) ?? [];
      // Session-level when the API sends it (sticky sessions re-fire
      // variant_assigned on reload, so raw impressions overstate n).
      const useSessions = typeof component?.total_exposed_sessions === 'number';
      const unit = useSessions ? 'sessions' : 'impressions';
      const sessions = (useSessions ? component?.total_exposed_sessions : component?.total_impressions) ?? 0;
      const conversions = component?.total_conversions ?? 0;

      // Per-variant readings come from the SAME component payload. They used to
      // come from /trends, which groups by variant id alone — so this
      // component's `control` row was a blend of every component's control.
      // The server's stated baseline (control_id), not a client copy of its rule.
      const baseline = component ? baselineOf(component) : null;
      const arms: ArmReading[] = (component?.variants ?? []).map((v) => {
        const isBaseline = v.variant_id === baseline?.id;
        const state = readEvidenceState(v.evidence_state);
        return {
          variantId: v.variant_id,
          isBaseline,
          n: (useSessions ? v.exposed_sessions : v.impressions) ?? 0,
          conversions: v.conversions ?? 0,
          state,
          verdict: verdictOf(state, readEvidenceStats(v.evidence_stats), isBaseline),
        };
      });

      const clusters = portraits?.clusters ?? [];
      const totalSessions = portraits?.totalSessions ?? 0;

      const dataState = computeDataState(sessions, arms);

      const lines: string[] = [];
      lines.push(`# Variant brief — ${untrusted(componentId)}`);
      lines.push(`Project context type: ${contextType}`);
      lines.push('');

      if (!component) {
        lines.push(
          `Note: no component named ${untrusted(componentId)} has reported data yet. If this is a new <Adaptive> you are adding, that is expected — it registers automatically on first assignment after deploy. Proceed using the best-practice priors below.`,
        );
        lines.push('');
      } else {
        lines.push(`Component performance (all-time): ${rateWithN(conversions, sessions, unit)}.`);
        // Variant ids are visitor-mintable via the public ingest path — delimit
        // them so a minted id can't inject lines into the brief (see untrusted()).
        lines.push(
          `Existing variant IDs (do not reuse these): ${existingVariantIds.length ? existingVariantIds.map((v) => untrusted(v)).join(', ') : '(none)'}`,
        );
        lines.push('');
      }

      if (arms.length) {
        lines.push(
          `Variants (all-time; evidence is the server's comparison against the baseline ${baseline ? untrusted(baseline.id) : ''}` +
            `${baseline && !baseline.explicit ? " — no arm is named 'control', so the baseline is the alphabetically-first id" : ''}):`,
        );
        for (const a of arms) {
          const ev = a.isBaseline
            ? 'baseline'
            : arms.length < 2
              ? 'nothing to compare'
              : a.verdict === 'no_evidence'
                ? 'evidence: none available from the server'
                : `evidence: ${EVIDENCE_LABEL[a.state!]} — ${VERDICT_TEXT[a.verdict as Exclude<Verdict, 'baseline'>]}`;
          lines.push(`- ${untrusted(a.variantId)}: ${rateWithN(a.conversions, a.n, unit)} · ${ev}`);
        }
        lines.push('');
      }

      if (clusters.length) {
        lines.push(`Audience (${totalSessions} sessions):`);
        for (const c of clusters) {
          const share = totalSessions > 0 ? ((c.sessionCount / totalSessions) * 100).toFixed(0) : '0';
          // Persona labels derive from visitor behaviour — same delimiting.
          lines.push(`- ${untrusted(c.label)}: ${share}% of traffic, ${c.sessionCount} sessions (reliability ${(c.avgReliability * 100).toFixed(0)}%)`);
        }
        lines.push('');
      }

      if (report) {
        const measured = (report.findings ?? []).filter((f) => !f.interpreted);
        // By the server-stated componentId (surface only for an older report):
        // a reading finding on section type `hero` is not about component `hero`.
        const own = measured.filter((f) => findingIsAbout(f, componentId));
        const projectWide = measured.filter((f) => !findingIsAbout(f, componentId)).slice(0, PROJECT_FINDINGS_CAP);
        const narrations = (report.findings ?? []).filter((f) => f.interpreted).length;
        const findingLine = (f: ReportFinding) => {
          const low = f.provenance.sample < MIN_EVIDENCE_SAMPLE ? `, LOW SAMPLE (<${MIN_EVIDENCE_SAMPLE})` : '';
          return `- [${f.tier}] ${untrusted(f.headline, 240)} (${f.provenance.sample} ${f.provenance.denominatorLabel}${low})`;
        };
        if (report.freshness?.isStale) lines.push('⚠ The evidence report is stale — the analysis job has not run recently. Consider refresh_insights.');
        if (own.length) {
          lines.push('Measured findings about this component:');
          own.forEach((f) => lines.push(findingLine(f)));
        } else {
          lines.push('Measured findings about this component: none yet.');
        }
        if (projectWide.length) {
          lines.push('Top project-wide measured findings:');
          projectWide.forEach((f) => lines.push(findingLine(f)));
        }
        if (narrations) {
          lines.push(`(${narrations} AI narration${narrations === 1 ? '' : 's'} exist — unmeasured interpretation, not relayed here; see get_insights.)`);
        }
        lines.push('');
      } else {
        lines.push('Findings: the evidence report could not be read just now.');
        lines.push('');
      }

      lines.push(`## Evidence state: ${dataState.toUpperCase()}`);
      lines.push(guidanceFor(dataState, contextType, arms));
      lines.push('');

      lines.push(`## Best-practice priors (${contextType})`);
      priorsFor(contextType).forEach((p) => lines.push(`- ${p}`));
      lines.push('');

      lines.push('## How to implement (code-native variant)');
      lines.push(`1. Search the repository for <Adaptive id="${componentId}"> (and any matching useAssignment("${componentId}") usage).`);
      lines.push('2. Add a new key to its `variants` map with on-brand JSX that matches the surrounding components and the project\'s design system. Pick a short, descriptive new variant id that is not in the existing list above (e.g. "value_led", "social_proof", "urgency").');
      lines.push('3. If the component is server-rendered via <AdaptiveRoot>, add the new variant id to that component\'s entry in the `components` list so it is included in SSR preloading.');
      lines.push('4. Do NOT call create_variant — that creates a separate no-code MANAGED draft. Code-native variants register automatically on the first assignment after you deploy, and go live immediately.');
      lines.push('5. Commit, push, and deploy. Optionally enable shadow mode first (a project-level setting in the dashboard — it applies to the whole project, not one component) if you want to validate before serving real traffic.');
      lines.push('');
      lines.push('Make the change reflect the evidence state above: build on a decided result only when DECIDED; best-practice-led when DIRECTIONAL, COLLECTING or EMPTY.');

      const markdown = lines.join('\n');
      return {
        content: [{ type: 'text' as const, text: markdown }],
        structuredContent: {
          componentId,
          contextType,
          dataState,
          variants: arms.map((a) => ({
            variantId: a.variantId,
            isBaseline: a.isBaseline,
            sessions: a.n,
            conversions: a.conversions,
            lowSample: isLowSample(a.n),
            evidenceState: a.state,
            verdict: a.verdict,
          })),
          existingVariantIds,
          priors: priorsFor(contextType),
          markdown,
        },
      };
    }),
  );
}
