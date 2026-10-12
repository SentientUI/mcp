import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerStageTools } from './stages.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler; config: { annotations?: { readOnlyHint?: boolean } } }> = {};
  return {
    registerTool: vi.fn((name: string, config: never, handler: ToolHandler) => { tools[name] = { handler, config }; }),
    tools,
  };
}

const WINDOW = {
  range: '30d', start: '2026-09-09T00:00:00.000Z', end: '2026-10-09T00:00:00.000Z',
  timezone: 'UTC', bucketUnit: 'week', retentionDays: 90, earliestAvailable: '2026-07-11',
};

async function run(data: unknown, args: Record<string, unknown> = {}) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  const get = vi.spyOn(client, 'get').mockResolvedValue(data as never);
  const server = makeServer();
  registerStageTools(server as never, client);
  const result = await server.tools['get_stage_breakdown']!.handler({ projectId: 'p1', ...args });
  return { result, get, server };
}

const empty = { stages: [], channels: [], arrivals: [], contexts: [], arms: [], sessions: 0, hinted: 0, window: WINDOW };

describe('get_stage_breakdown', () => {
  it('is a read-only tool hitting the windowed stage report', async () => {
    const { get, server } = await run({ ...empty, enabled: true, contextType: 'ecommerce', mode: 'record' }, { range: '7d' });
    expect(get).toHaveBeenCalledWith('/projects/p1/stage-report?range=7d');
    expect(server.tools['get_stage_breakdown']!.config.annotations?.readOnlyHint).toBe(true);
  });

  it('explains a project that does not record stages, by site type', async () => {
    const store = await run({ ...empty, enabled: false, contextType: 'ecommerce', mode: null });
    expect(store.result.content[0].text).toContain('switched off');
    const saas = await run({ ...empty, enabled: false, contextType: 'saas', mode: null });
    expect(saas.result.content[0].text).toContain('online stores only');
    expect((saas.result.structuredContent as { enabled: boolean }).enabled).toBe(false);
  });

  it('says recording just started when the window is empty', async () => {
    const { result } = await run({ ...empty, enabled: true, contextType: 'ecommerce', mode: 'record' });
    expect(result.content[0].text).toContain('No recorded stages in this window yet');
  });

  it('labels everything observational and delimits integrator-written names', async () => {
    const { result } = await run({
      ...empty,
      enabled: true, contextType: 'ecommerce', mode: 'record', sessions: 200, hinted: 10,
      stages: [{ stage: 'new', sessions: 150, share: 0.75, observed: 150, hinted: 0 }, { stage: 'carted', sessions: 50, share: 0.25, observed: 40, hinted: 10 }],
      arrivals: [{ channel: 'paid_social', stage: 'new', sessions: 150, conversions: 3, conversionRate: 0.02 }],
      contexts: [{ context: 'new', kind: 'stage', sessions: 150 }],
      arms: [{ slotId: 'hero', slotName: 'Hero', context: 'new', arm: 'bold', isControl: false, trials: 80, credited: 4, rate: 0.05, evidence: 'not_enough_data', probBeatsControl: 0.6 }],
    });
    const text = result.content[0].text as string;
    expect(text).toContain('OBSERVATIONAL');
    expect(text).toContain('- carted: 50 (25.0%), 10 hinted');
    expect(text).toContain('- `Hero` / new / `bold`: 80 closed trials, rate 5.0%, not_enough_data');
    expect((result.structuredContent as { arms: unknown[] }).arms).toHaveLength(1);
  });

  it('reports the tested lift per first-visit context and channel, keeps Early honest, and lists stage moves', async () => {
    const lift = (key: string, kind: string, evidence: string, over: Record<string, unknown> = {}) => ({
      key, kind, evidence, testStarted: true, liftPct: null, diffInterval: null, pValue: null, rates: null,
      adapted: { visitors: 900, conversions: 40 }, control: { visitors: 60, conversions: 2 }, epochs: 1, ...over,
    });
    const { result } = await run({
      ...empty,
      enabled: true, contextType: 'ecommerce', mode: 'record', sessions: 200, hinted: 0,
      stages: [{ stage: 'new', sessions: 200, share: 1, observed: 200, hinted: 0 }],
      holdoutLift: {
        basis: 'first_visit', allTime: true, goal: 'any', alpha: 0.05 / 23, family: 23, minPerArm: 100, units: 3000, unclassified: 500,
        contexts: [
          lift('new', 'stage', 'collecting', { testStarted: false }),
          lift('cart_recovery', 'arrival', 'significant_positive', { liftPct: 18.5, diffInterval: { lower: 0.004, upper: 0.03 } }),
        ],
        channels: [lift('paid_social', 'channel', 'not_significant', { liftPct: 6 })],
      },
      transitions: { pairs: 10, visitors: 8, rows: [{ from: 'browsing', nextVisits: 10, to: [{ stage: 'browsing', visits: 7, visitors: 6, share: 0.7 }, { stage: 'carted', visits: 3, visitors: 3, share: 0.3 }] }] },
    });
    const text = result.content[0].text as string;
    expect(text).toContain('tested, all-time');
    expect(text).toContain('over 23');
    expect(text).toContain('500 of 3000 visitors predate recording');
    expect(text).toContain('- context new: early — adapted 900 / control 60 visitors; a number shows at 100 per side');
    expect(text).toContain('- context cart_recovery: tested: +18.5% conversion, range 0.40 to 3.00 pts');
    expect(text).toContain('- channel paid_social: not proven yet (+6%, could be chance)');
    expect(text).toContain('- from browsing (10 next visits): browsing 70%, carted 30%');
    const sc = result.structuredContent as { holdoutLift: { contexts: unknown[] }; transitions: { pairs: number } };
    expect(sc.holdoutLift.contexts).toHaveLength(2);
    expect(sc.transitions.pairs).toBe(10);
  });
});
