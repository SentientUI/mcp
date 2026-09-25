/**
 * The MCP surface's reading of the server's evidence contract (CONTRACTS.md §5).
 *
 * Nothing here computes evidence. The server judges every non-baseline arm
 * against its component's baseline (`evidence_state` + `evidence_stats` on
 * GET /projects/:id/components — deterministic quadrature, 100-per-arm floor on
 * the arm AND the baseline, Bonferroni-corrected bars). This module only maps
 * that verdict to words, so no tool output can call an arm better, worse,
 * winning or "sufficient" on its own raw rate. Before this existed,
 * get_variant_brief ranked by raw CVR ("target the underperforming variant")
 * and declared data SUFFICIENT at 500 impressions — a threshold that appears
 * nowhere in the contract and says nothing about whether two arms differ.
 */

export type EvidenceStateId =
  | 'not_enough_data'
  | 'early_signal'
  | 'moderate_evidence'
  | 'strong_evidence'
  | 'inconclusive';

/** CONTRACTS.md §5 "Minimum sample before any evidence claim". Used here only
 *  to FLAG a displayed rate as low-sample — never to decide anything. */
export const MIN_EVIDENCE_SAMPLE = 100;

/** Same plain-language labels the dashboard uses (components-metrics.ts). */
export const EVIDENCE_LABEL: Record<EvidenceStateId, string> = {
  not_enough_data: 'Not enough data',
  early_signal: 'Early signal (still moving — not a result)',
  moderate_evidence: 'Moderate evidence (about one call in five of this strength is wrong — not decided)',
  strong_evidence: 'Strong evidence',
  inconclusive: 'Inconclusive (ran a full period without separating from the baseline)',
};

export type EvidenceStats = {
  sample: number;
  probBeatsControl: number;
  threshold: { moderate: number; strong: number; minSample: number };
};

const STATES = new Set<string>(Object.keys(EVIDENCE_LABEL));

export function readEvidenceState(raw: unknown): EvidenceStateId | null {
  return typeof raw === 'string' && STATES.has(raw) ? (raw as EvidenceStateId) : null;
}

export function readEvidenceStats(raw: unknown): EvidenceStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const t = s.threshold as Record<string, unknown> | undefined;
  if (
    typeof s.sample !== 'number' ||
    typeof s.probBeatsControl !== 'number' ||
    !t ||
    typeof t.strong !== 'number' ||
    typeof t.moderate !== 'number'
  ) {
    return null;
  }
  return {
    sample: s.sample,
    probBeatsControl: s.probBeatsControl,
    threshold: {
      moderate: t.moderate,
      strong: t.strong,
      minSample: typeof t.minSample === 'number' ? t.minSample : MIN_EVIDENCE_SAMPLE,
    },
  };
}

/**
 * The baseline arm, chosen exactly as the server chooses it
 * (domain/variant-evidence.ts pickControlId): 'control' when declared, else the
 * lexicographically smallest id. `explicit: false` means that choice is
 * arbitrary — output must name the arm rather than say "vs control".
 */
export function pickBaseline(ids: string[]): { id: string; explicit: boolean } | null {
  if (ids.length === 0) return null;
  if (ids.includes('control')) return { id: 'control', explicit: true };
  return { id: [...ids].sort((a, b) => a.localeCompare(b))[0]!, explicit: false };
}

/**
 * The baseline of one /components row. The server states it (`control_id` +
 * `baseline_explicit`, the id pickControlId actually measured evidence
 * against); reading it removes the copied rule above as a second source of
 * truth that could drift from the server's. pickBaseline stays as the fallback
 * for an older API that does not send the field.
 */
export function baselineOf(component: {
  control_id?: string | null;
  baseline_explicit?: boolean;
  variants: Array<{ variant_id: string }>;
}): { id: string; explicit: boolean } | null {
  if (typeof component.control_id === 'string') {
    return {
      id: component.control_id,
      explicit: typeof component.baseline_explicit === 'boolean' ? component.baseline_explicit : component.control_id === 'control',
    };
  }
  if (component.control_id === null) return null;
  return pickBaseline(component.variants.map((v) => v.variant_id));
}

/**
 * The one comparative claim an arm's evidence supports — the dashboard's
 * liftVerdict, mirrored. 'ahead' only at strong evidence; 'behind' only when
 * P(beats baseline) is at or under 1 − the corrected strong bar; everything
 * else is 'unclear'. 'no_evidence' = the server sent no verdict (older API, or
 * the arm was not scored), which must never be read as "equal".
 */
export type Verdict = 'baseline' | 'ahead' | 'behind' | 'unclear' | 'no_evidence';

export function verdictOf(
  state: EvidenceStateId | null,
  stats: EvidenceStats | null,
  isBaseline: boolean,
): Verdict {
  if (isBaseline) return 'baseline';
  if (state === null) return 'no_evidence';
  if (state === 'strong_evidence') return 'ahead';
  if (state !== 'not_enough_data' && stats && stats.probBeatsControl <= 1 - stats.threshold.strong) {
    return 'behind';
  }
  return 'unclear';
}

export const VERDICT_TEXT: Record<Exclude<Verdict, 'baseline'>, string> = {
  ahead: 'reliably AHEAD of the baseline',
  behind: 'reliably BEHIND the baseline',
  unclear: 'not separated from the baseline',
  no_evidence: 'no evidence available from the server',
};

/**
 * A rate always travels with its n. Below the evidence floor the rate is
 * flagged: "50%" on 2 sessions and "50%" on 2,000 used to print identically.
 */
export function rateWithN(conversions: number, n: number, unit = 'sessions'): string {
  if (!(n > 0)) return `no rate (0 ${unit})`;
  const pct = ((conversions / n) * 100).toFixed(2);
  const flag = n < MIN_EVIDENCE_SAMPLE ? `, LOW SAMPLE (<${MIN_EVIDENCE_SAMPLE}) — not interpretable on its own` : '';
  return `${pct}% (${conversions}/${n} ${unit}${flag})`;
}

export function isLowSample(n: number): boolean {
  return n < MIN_EVIDENCE_SAMPLE;
}
