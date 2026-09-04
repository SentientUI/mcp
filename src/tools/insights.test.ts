import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerInsightTools } from './insights.js';
import { registerPersonaTools } from './personas.js';
import { registerGoalTools } from './goals.js';
import { registerGuardrailTools } from './guardrails.js';
import { registerLayoutTools } from './layout.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => { tools[name] = { handler }; }),
    tools,
  };
}

describe('get_insights', () => {
  // Handlers are typed loosely by the MCP SDK; the repo casts at the assertion.
  const sc = (r: { structuredContent?: unknown }) => r.structuredContent as {
    status: string; reached: string; emptyReason: string | null; isStale: boolean;
    observations: string[]; recommendations: string[];
    findings: Array<{ coverage: number | null }>;
  };

  function finding(over = {}) {
    return {
      tier: 'observed', kind: 'traffic', headline: '73% of your visitors are on mobile',
      audience: null, interpreted: false,
      provenance: { sample: 800, coverage: 1, denominatorLabel: 'visits' },
      ...over,
    };
  }

  it('lists findings with the evidence behind each one', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      findings: [finding()], reached: 'observed', emptyReason: null,
      interpretation: { count: 0, locked: false, emptyReason: null },
      generatedAt: '2026-08-25T10:00:00.000Z', freshness: { isStale: false },
    });
    const server = makeServer();
    registerInsightTools(server as any, client);
    const result = await server.tools['get_insights']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('73% of your visitors are on mobile');
    expect(result.content[0].text).toContain('800 visits');
    expect(sc(result).status).toBe('ok');
  });

  it('states coverage when a finding describes only part of traffic', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      findings: [finding({
        kind: 'attention', audience: 'buyer', headline: 'buyer visitors spend 2.0x more time on pricing',
        provenance: { sample: 87, coverage: 0.1, denominatorLabel: 'visits we could group into an audience' },
      })],
      reached: 'patterned', emptyReason: null,
      interpretation: { count: 0, locked: false, emptyReason: null },
      generatedAt: null, freshness: { isStale: false },
    });
    const server = makeServer();
    registerInsightTools(server as any, client);
    const result = await server.tools['get_insights']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('covering 10% of visitors');
    expect(sc(result).findings[0].coverage).toBe(0.1);
  });

  it('says WHY it is empty instead of answering ok beside nothing', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      findings: [], reached: 'observed', emptyReason: 'no_events',
      interpretation: { count: 0, locked: false, emptyReason: null },
      generatedAt: null, freshness: { isStale: false },
    });
    const server = makeServer();
    registerInsightTools(server as any, client);
    const result = await server.tools['get_insights']!.handler({ projectId: 'p1' });
    expect(sc(result).status).toBe('empty');
    expect(sc(result).emptyReason).toBe('no_events');
    expect(result.content[0].text).toContain('snippet has not fired');
  });

  it('flags a stale narrator even while measured findings are healthy', async () => {
    // SentientUI-Prod's real state: live traffic, narrator last ran in July.
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      findings: [finding()], reached: 'observed', emptyReason: null,
      interpretation: { count: 0, locked: false, emptyReason: 'job_stale' },
      generatedAt: '2026-07-21T19:15:29.000Z', freshness: { isStale: true },
    });
    const server = makeServer();
    registerInsightTools(server as any, client);
    const result = await server.tools['get_insights']!.handler({ projectId: 'p1' });
    expect(sc(result).status).toBe('ok');
    expect(sc(result).isStale).toBe(true);
    expect(result.content[0].text).toContain('has not run recently');
  });

  it('keeps observations and recommendations populated for existing callers', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      findings: [finding(), finding({ interpreted: true, kind: 'interpretation', headline: 'Try a shorter hero.' })],
      reached: 'tested', emptyReason: null,
      interpretation: { count: 1, locked: false, emptyReason: null },
      generatedAt: null, freshness: { isStale: false },
    });
    const server = makeServer();
    registerInsightTools(server as any, client);
    const result = await server.tools['get_insights']!.handler({ projectId: 'p1' });
    expect(sc(result).observations).toEqual(['73% of your visitors are on mobile']);
    expect(sc(result).recommendations).toEqual(['Try a shorter hero.']);
  });

  it('tells the agent the remedy for a stale or never-run analysis exists', async () => {
    // An agent that learns "the analysis has not run recently" and is not told
    // about refresh_insights has no way to know it can fix that itself.
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      findings: [finding()], reached: 'observed', emptyReason: null,
      interpretation: { count: 0, locked: false, emptyReason: 'job_stale' },
      generatedAt: '2026-07-21T19:15:29.000Z', freshness: { isStale: true },
    });
    const server = makeServer();
    registerInsightTools(server as any, client);
    const result = await server.tools['get_insights']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('refresh_insights');
  });

  it('names a data outage as unavailable rather than blaming the snippet', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      findings: [], reached: 'observed', emptyReason: 'data_unavailable',
      interpretation: { count: 0, locked: false, emptyReason: null },
      generatedAt: null, freshness: { isStale: false },
    });
    const server = makeServer();
    registerInsightTools(server as any, client);
    const result = await server.tools['get_insights']!.handler({ projectId: 'p1' });
    expect(result.content[0].text.toLowerCase()).toContain('could not be read');
    expect(result.content[0].text).not.toContain('snippet');
  });

  it('rounds tiny coverage to "under 1%", never to a claim of 0%', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      findings: [finding({
        provenance: { sample: 3, coverage: 0.003, denominatorLabel: 'visits we could group into an audience' },
      })],
      reached: 'observed', emptyReason: null,
      interpretation: { count: 0, locked: false, emptyReason: null },
      generatedAt: null, freshness: { isStale: false },
    });
    const server = makeServer();
    registerInsightTools(server as any, client);
    const result = await server.tools['get_insights']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('under 1% of visitors');
    expect(result.content[0].text).not.toContain('0% of visitors');
  });

  it('tells the agent what would unlock the next rung', async () => {
    // Without this an agent can report "nothing is tested yet" but not what to
    // do about it — the one question the operator will ask next.
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      findings: [], reached: 'observed', emptyReason: 'nothing_moved',
      interpretation: { count: 0, locked: false, emptyReason: null },
      generatedAt: '2026-08-25T10:00:00.000Z', freshness: { isStale: false },
      nextUnlock: {
        tier: 'tested', needs: 'visits on its least-seen version',
        have: 53, need: 100, surface: 'hero',
      },
    });
    const server = makeServer();
    registerInsightTools(server as any, client);
    const result = await server.tools['get_insights']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('47 more visits on its least-seen version');
    expect(result.content[0].text).toContain('hero');
    expect((result.structuredContent as { nextUnlock: unknown }).nextUnlock).toEqual({
      tier: 'tested', needs: 'visits on its least-seen version',
      have: 53, need: 100, surface: 'hero',
    });
  });

  it('reports nextUnlock as null when there is nothing close', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      findings: [], reached: 'tested', emptyReason: null,
      interpretation: { count: 0, locked: false, emptyReason: null },
      generatedAt: '2026-08-25T10:00:00.000Z', freshness: { isStale: false },
    });
    const server = makeServer();
    registerInsightTools(server as any, client);
    const result = await server.tools['get_insights']!.handler({ projectId: 'p1' });
    expect((result.structuredContent as { nextUnlock: unknown }).nextUnlock).toBeNull();
  });
});

describe('get_persona_breakdown', () => {
  it('returns cluster summary with percentages', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      clusters: [{ label: 'buyers', sessionCount: 120, avgReliability: 0.75 }],
      totalSessions: 300,
    });
    const server = makeServer();
    registerPersonaTools(server as any, client);
    const result = await server.tools['get_persona_breakdown']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('buyers');
    expect(result.content[0].text).toContain('120');
    expect(result.content[0].text).toContain('40.0%');
  });
});

describe('get_goal_funnel', () => {
  it('returns goal hit counts and conversion rates', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      goals: [{ goalName: 'signup', hits: 42, uniqueSessions: 40, pct: 0.14, variants: [] }],
    });
    const server = makeServer();
    registerGoalTools(server as any, client);
    const result = await server.tools['get_goal_funnel']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('signup');
    expect(result.content[0].text).toContain('42');
    expect(result.content[0].text).toContain('14.0%');
  });
});

describe('list_guardrail_events', () => {
  it('returns paused variants', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      guardrailEvents: [{ componentId: 'hero', variantIds: ['v_b'], pausedAt: '2026-06-10T08:00:00Z' }],
    });
    const server = makeServer();
    registerGuardrailTools(server as any, client);
    const result = await server.tools['list_guardrail_events']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('hero');
    expect(result.content[0].text).toContain('v_b');
  });

  it('returns no-events message when list is empty', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({ guardrailEvents: [] });
    const server = makeServer();
    registerGuardrailTools(server as any, client);
    const result = await server.tools['list_guardrail_events']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('No variants currently paused by a guardrail.');
  });
});

describe('get_layout_stats', () => {
  it('returns layout policy weights per persona', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue([
      { persona: 'buyers', layoutOrder: ['pricing', 'hero', 'testimonials'], avgReward: 0.8, pulls: 120 },
    ]);
    const server = makeServer();
    registerLayoutTools(server as any, client);
    const result = await server.tools['get_layout_stats']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('buyers');
    expect(result.content[0].text).toContain('pricing');
    expect(result.content[0].text).toContain('0.80');
  });

  it('returns no-data message when array is empty', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue([]);
    const server = makeServer();
    registerLayoutTools(server as any, client);
    const result = await server.tools['get_layout_stats']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('No layout data');
  });
});
