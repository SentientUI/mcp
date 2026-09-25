import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerComponentTools } from './components.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => { tools[name] = { handler }; }),
    tools,
  };
}

describe('list_components', () => {
  it('returns component names and variant counts', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    // The mgmt API returns a paginated envelope, not a bare array.
    vi.spyOn(client, 'get').mockResolvedValue({
      components: [
        { component_id: 'hero', total_impressions: 500, total_conversions: 75, variants: [{ variant_id: 'v_a' }, { variant_id: 'v_b' }] },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });
    const server = makeServer();
    registerComponentTools(server as any, client);
    const result = await server.tools['list_components']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('hero');
    expect(result.content[0].text).toContain('2 variants');
    expect(result.content[0].text).toContain('500');
  });

  it('shows no-components message when list is empty', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({ components: [], total: 0, page: 1, limit: 50 });
    const server = makeServer();
    registerComponentTools(server as any, client);
    const result = await server.tools['list_components']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('No components');
  });

  // Destructuring only page one of the paginated envelope silently capped the
  // "list ALL components" tool at the API default of 50 — component #51 never
  // existed as far as any agent could tell.
  it('follows nextCursor across pages and asks for the 200-per-page maximum', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    const mk = (id: string) => ({ component_id: id, total_impressions: 1, total_conversions: 0, variants: [] });
    const get = vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
      if (path.includes('cursor=page1end')) {
        return { components: [mk('zz_late')], total: 2, nextCursor: null } as any;
      }
      return { components: [mk('aa_early')], total: 2, nextCursor: 'page1end' } as any;
    });
    const server = makeServer();
    registerComponentTools(server as any, client);
    const result = await server.tools['list_components']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('zz_late');
    expect((result.structuredContent as { components: unknown[] }).components).toHaveLength(2);
    expect((result.structuredContent as { truncated: boolean }).truncated).toBe(false);
    expect(get.mock.calls[0]![0]).toContain('limit=200');
  });

  it('says so when the page cap cuts the listing short', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    // Every page claims another page follows — the cap must kick in and be surfaced.
    let n = 0;
    vi.spyOn(client, 'get').mockImplementation(async () => ({
      components: [{ component_id: `c${n}`, total_impressions: 1, total_conversions: 0, variants: [] }],
      total: 5000,
      nextCursor: `c${n++}`,
    }) as any);
    const server = makeServer();
    registerComponentTools(server as any, client);
    const result = await server.tools['list_components']!.handler({ projectId: 'p1' });
    expect((result.structuredContent as { truncated: boolean }).truncated).toBe(true);
    expect(result.content[0].text).toContain('fetch cap reached');
    expect(result.content[0].text).toContain('5000');
  });
});

describe('get_variant_performance', () => {
  // Two components that BOTH have a `control` arm. An older /trends grouped by
  // variant id alone, so its `control` row is a blend of the two; the current
  // one keys rows by (componentId, variantId).
  const components = {
    components: [
      {
        component_id: 'hero',
        variants: [
          { variant_id: 'control', impressions: 600, exposed_sessions: 500, conversions: 50, evidence_state: null, evidence_stats: null },
          {
            variant_id: 'bold', impressions: 700, exposed_sessions: 500, conversions: 80,
            evidence_state: 'strong_evidence',
            evidence_stats: { sample: 500, probBeatsControl: 0.99, threshold: { moderate: 0.8, strong: 0.95, minSample: 100 } },
          },
        ],
      },
      {
        component_id: 'pricing',
        variants: [
          { variant_id: 'control', impressions: 60, exposed_sessions: 40, conversions: 20, evidence_state: null, evidence_stats: null },
          {
            variant_id: 'calm', impressions: 12, exposed_sessions: 10, conversions: 9,
            evidence_state: 'not_enough_data',
            evidence_stats: { sample: 10, probBeatsControl: 0.97, threshold: { moderate: 0.8, strong: 0.95, minSample: 100 } },
          },
        ],
      },
    ],
    total: 2,
    nextCursor: null,
  };
  const trends = {
    cvr: [
      { variantId: 'control', currentCvr: 0.13, priorCvr: 0.1, deltaPp: 3, priorImpressions: 400 },
      { variantId: 'bold', currentCvr: 0.16, priorCvr: 0.12, deltaPp: 4, priorImpressions: 450 },
    ],
    momentum: [
      { variantId: 'control', direction: 'gaining' },
      { variantId: 'bold', direction: 'gaining' },
    ],
  };

  async function run(c: unknown = components, t: unknown = trends) {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/components')) return c as never;
      if (path.includes('/trends')) {
        if (t instanceof Error) throw t;
        return t as never;
      }
      return {} as never;
    });
    const server = makeServer();
    registerComponentTools(server as any, client);
    return server.tools['get_variant_performance']!.handler({ projectId: 'p1' });
  }
  type Row = {
    componentId: string; variantId: string; sessions: number; conversions: number; currentCvr: number | null;
    lowSample: boolean; verdict: string; priorCvr: number | null; trendNote: string | null; isBaseline: boolean;
  };
  const rows = (r: { structuredContent?: unknown }) => (r.structuredContent as { variants: Row[] }).variants;

  // M1: rows were keyed by variant id alone, so the two `control` arms
  // collided, and no rate carried its n.
  it('keys rows by component + variant and gives every rate its n', async () => {
    const result = await run();
    const r = rows(result);
    expect(r.map((x) => `${x.componentId}/${x.variantId}`)).toEqual([
      'hero/control', 'hero/bold', 'pricing/control', 'pricing/calm',
    ]);
    const heroBold = r.find((x) => x.componentId === 'hero' && x.variantId === 'bold')!;
    expect(heroBold).toMatchObject({ sessions: 500, conversions: 80, currentCvr: 0.16, lowSample: false });
    const text = result.content[0].text as string;
    expect(text).toContain('`bold`: 16.00% (80/500 sessions)');
    expect(text).toContain('`calm`: 90.00% (9/10 sessions, LOW SAMPLE');
  });

  // S6: no evidence state reached the agent, so a 90% rate on 10 sessions
  // read as the best arm in the project.
  it('carries the server evidence verdict and never calls a thin arm ahead', async () => {
    const r = rows(await run());
    expect(r.find((x) => x.variantId === 'bold')!.verdict).toBe('ahead');
    // P(beats control) 0.97 but only 10 visits: the server says not_enough_data,
    // and that must stay "unclear", however high its raw rate.
    expect(r.find((x) => x.variantId === 'calm')!.verdict).toBe('unclear');
    expect(r.filter((x) => x.variantId === 'control').every((x) => x.verdict === 'baseline')).toBe(true);
  });

  // V10: the verdict printed beside the WINDOWED rate was the ALL-TIME one, so
  // an arm the all-time posterior favoured read "reliably AHEAD" on a window
  // where it trailed. window_evidence is now the verdict; all-time is reported
  // separately as reliability.
  it('judges the windowed rate on window_evidence and reports all-time as reliability', async () => {
    const hero = components.components[0]!;
    const windowed = {
      ...components,
      components: [{
        ...hero,
        variants: [
          { ...hero.variants[0]!, window_evidence: null },
          {
            ...hero.variants[1]!,
            window_evidence: {
              state: 'early_signal', probBeatsControl: 0.02, sample: 500, controlSample: 500,
              threshold: { moderate: 0.8, strong: 0.95, minSample: 100 },
            },
          },
        ],
      }],
    };
    const result = await run(windowed, { cvr: [], momentum: [] });
    const bold = rows(result).find((x) => x.variantId === 'bold')! as Row & Record<string, unknown>;
    expect(bold.verdict).toBe('behind');
    expect(bold.verdictBasis).toBe('window');
    expect(bold.windowEvidenceState).toBe('early_signal');
    expect(bold.windowProbBeatsBaseline).toBe(0.02);
    expect(bold.evidenceState).toBe('strong_evidence');
    expect(bold.reliabilityVerdict).toBe('ahead');
    const text = result.content[0].text as string;
    expect(text).toContain('evidence (this window): Early signal (still moving — not a result) — reliably BEHIND the baseline');
    expect(text).toContain('reliability (all time): Strong evidence');
    expect(text).toContain('Evidence (this window)');
    expect(text).not.toContain("the server's ALL-TIME comparison");
  });

  it('older API without window_evidence: verdict stays the all-time one, labelled all_time', async () => {
    const result = await run();
    const bold = rows(result).find((x) => x.variantId === 'bold')! as Row & Record<string, unknown>;
    expect(bold).toMatchObject({ verdict: 'ahead', verdictBasis: 'all_time', reliabilityVerdict: 'ahead', windowEvidenceState: null });
    const text = result.content[0].text as string;
    expect(text).toContain('evidence: Strong evidence — reliably AHEAD of the baseline');
    expect(text).toContain("the server's ALL-TIME comparison");
    expect(text).not.toContain('reliability (all time)');
  });

  it('older API (no componentId on trend rows): does not attach the blend to a shared variant id', async () => {
    const result = await run();
    const r = rows(result);
    const heroControl = r.find((x) => x.componentId === 'hero' && x.variantId === 'control')!;
    expect(heroControl.priorCvr).toBeNull();
    expect(heroControl.trendNote).toMatch(/shared by 2 components/);
    // A unique id still gets its preceding-window comparison, with n, marked untested.
    expect(r.find((x) => x.variantId === 'bold')!.priorCvr).toBe(0.12);
    expect(result.content[0].text).toContain('vs preceding window: 12.00% (n=450), +4.0 pp, rising (untested)');
    expect(result.content[0].text).not.toMatch(/gaining|losing/);
  });

  // The keyed /trends separates hero/control from pricing/control, so each
  // gets ITS OWN preceding-window rate — the old workaround withheld both.
  it('attaches per-component trend rows when /trends is keyed by component', async () => {
    const keyedTrends = {
      cvr: [
        { componentId: 'hero', variantId: 'control', currentCvr: 0.1, priorCvr: 0.08, deltaPp: 2, priorImpressions: 400 },
        { componentId: 'pricing', variantId: 'control', currentCvr: 0.5, priorCvr: 0.6, deltaPp: -10, priorImpressions: 30 },
        { componentId: 'hero', variantId: 'bold', currentCvr: 0.16, priorCvr: 0.12, deltaPp: 4, priorImpressions: 450 },
      ],
      momentum: [
        { componentId: 'hero', variantId: 'control', direction: 'gaining' },
        { componentId: 'pricing', variantId: 'control', direction: 'losing' },
        { componentId: 'hero', variantId: 'bold', direction: 'stable' },
      ],
    };
    const r = rows(await run(components, keyedTrends));
    const heroControl = r.find((x) => x.componentId === 'hero' && x.variantId === 'control')!;
    const pricingControl = r.find((x) => x.componentId === 'pricing' && x.variantId === 'control')!;
    expect(heroControl).toMatchObject({ priorCvr: 0.08, trendNote: null });
    expect((heroControl as Row & { momentum: string }).momentum).toBe('rising');
    expect(pricingControl).toMatchObject({ priorCvr: 0.6, trendNote: null });
    expect((pricingControl as Row & { momentum: string }).momentum).toBe('falling');
    // pricing/calm has no trend row of its own — hero's rows must not leak into it.
    expect(r.find((x) => x.componentId === 'pricing' && x.variantId === 'calm')!.trendNote).toMatch(/No preceding-window data/);
  });

  // The server now states the baseline it measured against; the tool reads it
  // instead of re-deriving the rule (which named `control` here while the
  // server compared against `bold`).
  it('uses the server-stated control_id / baseline_explicit over the copied rule', async () => {
    const withServerBaseline = {
      ...components,
      components: [{ ...components.components[0]!, control_id: 'bold', baseline_explicit: false }],
    };
    const result = await run(withServerBaseline, { cvr: [], momentum: [] });
    const r = rows(result);
    expect(r.find((x) => x.variantId === 'bold')!.isBaseline).toBe(true);
    expect(r.find((x) => x.variantId === 'control')!.isBaseline).toBe(false);
    expect((r[0] as Row & { baselineExplicit: boolean }).baselineExplicit).toBe(false);
    expect(result.content[0].text).toContain("baseline `bold` (no arm is named 'control'");
  });

  it('still reports counts and evidence when /trends fails', async () => {
    const r = rows(await run(components, new Error('trends down')));
    expect(r).toHaveLength(4);
    expect(r[0]!.trendNote).toMatch(/trends request failed/);
  });

  it('shows no-data message when no component has variants', async () => {
    const result = await run({ components: [], total: 0, nextCursor: null }, { cvr: [], momentum: [] });
    expect(result.content[0].text).toContain('No variant data');
  });
});
