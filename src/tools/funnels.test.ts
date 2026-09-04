import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerFunnelTools } from './funnels.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => { tools[name] = { handler }; }),
    tools,
  };
}

function setup(data: unknown) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  vi.spyOn(client, 'get').mockResolvedValue(data as any);
  const server = makeServer();
  registerFunnelTools(server as any, client);
  return server;
}

const REPORT = {
  funnelId: 'checkout',
  displayName: 'Checkout',
  windowDays: 30,
  currency: 'EUR',
  steps: [
    { stepIndex: 0, goalId: 'add_to_cart', displayName: 'Added to cart', reached: 100, dropOffFromPrevious: null, neverFired: false, variants: [], personas: [] },
    { stepIndex: 1, goalId: 'purchase', displayName: 'Purchase', reached: 20, dropOffFromPrevious: 0.8, neverFired: false, variants: [], personas: [] },
  ],
  revenue: 900.5,
  avgOrderValue: 45.025,
  revenuePerEnteringVisitor: 9.005,
  holdoutCompletion: { entered: 10, reached: 1 },
};

describe('get_funnel_report', () => {
  it('renders per-step reach with drop-off and a revenue line', async () => {
    const server = setup(REPORT);
    const res = await server.tools['get_funnel_report']!.handler({ projectId: 'p1', funnelId: 'checkout' });
    const text = res.content[0].text as string;
    expect(text).toContain('`Added to cart`: 100 reached');
    expect(text).toContain('`Purchase`: 20 reached (80% drop-off from previous)');
    expect(text).toContain('Revenue: 900.50 EUR');
    // 45.025 is 45.02499… in IEEE754, so toFixed(2) → 45.02.
    expect(text).toContain('45.02 EUR avg order');
    expect(res.structuredContent).toMatchObject({ funnelId: 'checkout', revenue: 900.5 });
  });

  it('omits the revenue line for valueless funnels and flags never-fired steps', async () => {
    const server = setup({
      ...REPORT,
      revenue: null,
      avgOrderValue: null,
      revenuePerEnteringVisitor: null,
      steps: [REPORT.steps[0], { ...REPORT.steps[1], neverFired: true }],
    });
    const res = await server.tools['get_funnel_report']!.handler({ projectId: 'p1', funnelId: 'checkout' });
    const text = res.content[0].text as string;
    expect(text).not.toContain('Revenue:');
    expect(text).toContain('never recorded');
  });

  it('passes strictOrder through, and an absent value reads as sequence counting', async () => {
    const anyOrderServer = setup({ ...REPORT, strictOrder: false });
    const anyOrderRes = await anyOrderServer.tools['get_funnel_report']!.handler({ projectId: 'p1', funnelId: 'checkout' });
    expect((anyOrderRes.structuredContent as { strictOrder: boolean }).strictOrder).toBe(false);

    // Sequence counting is the default (migration 107), so an API that omits
    // the field is reporting a sequence-counted funnel, not an any-order one.
    const olderServer = setup(REPORT); // no strictOrder field in the response
    const olderRes = await olderServer.tools['get_funnel_report']!.handler({ projectId: 'p1', funnelId: 'checkout' });
    expect((olderRes.structuredContent as { strictOrder: boolean }).strictOrder).toBe(true);
  });
});

describe('list_funnels', () => {
  it('lists funnels with ordered step goal ids', async () => {
    const server = setup({
      funnels: [{
        funnel_id: 'checkout',
        display_name: 'Checkout',
        status: 'active',
        window_days: 30,
        source: 'user',
        steps: [
          { step_index: 0, goal_id: 'add_to_cart', weight: null },
          { step_index: 1, goal_id: 'purchase', weight: '1.000' },
        ],
        components: [{ component_id: 'hero', step_index: 1 }],
      }],
    });
    const res = await server.tools['list_funnels']!.handler({ projectId: 'p1' });
    const text = res.content[0].text as string;
    expect(text).toContain('`checkout` (active) — `Checkout`: `add_to_cart` → `purchase`');
    const structured = res.structuredContent as { funnels: Array<{ steps: Array<{ weight: number | null }> }> };
    expect(structured.funnels[0]!.steps.map((s) => s.weight)).toEqual([null, 1]);
  });

  it('explains how to create one when none exist', async () => {
    const server = setup({ funnels: [] });
    const res = await server.tools['list_funnels']!.handler({ projectId: 'p1' });
    expect(res.content[0].text as string).toMatch(/No funnels defined yet/);
  });
});
