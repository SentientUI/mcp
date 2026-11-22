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
    expect(text).toContain('`Added to cart`: 100 People reached');
    expect(text).toContain('`Purchase`: 20 People reached (80% drop-off from previous)');
    expect(text).toContain('Revenue: 900.50 EUR');
    // 45.025 is 45.02499… in IEEE754, so toFixed(2) → 45.02.
    expect(text).toContain('45.02 EUR avg order');
    expect(res.structuredContent).toMatchObject({ funnelId: 'checkout', revenue: 900.5 });
  });

  // revenue is the API's total (everyone's orders, as get_goal_funnel
  // states it), with the API's own remainder beside it. The tool passes both
  // through untouched: subtracting or adding here would print a figure no
  // dashboard shows.
  it('states the revenue remainder from visitors we couldn\'t confirm as people, as the API sent it', async () => {
    const server = setup({ ...REPORT, revenue: 1200, unconfirmedRevenue: 299.5 });
    const res = await server.tools['get_funnel_report']!.handler({ projectId: 'p1', funnelId: 'checkout' });
    const text = res.content[0].text as string;
    expect(text).toContain("Revenue: 1200.00 EUR (299.50 EUR from visitors we couldn't confirm as people)");
    expect(res.structuredContent).toMatchObject({ revenue: 1200, unconfirmedRevenue: 299.5 });
  });

  it('says nothing about a remainder when there is none, and reports null for an older API', async () => {
    const server = setup(REPORT);
    const res = await server.tools['get_funnel_report']!.handler({ projectId: 'p1', funnelId: 'checkout' });
    const text = res.content[0].text as string;
    expect(text).not.toContain("couldn't confirm as people)");
    expect((res.structuredContent as { unconfirmedRevenue: number | null }).unconfirmedRevenue).toBeNull();
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
    // An older API sends only neverFired: it reads as "nothing sends it", and
    // never as a typo hunt.
    expect(text).toContain('[Nothing sends `purchase` yet]');
    expect(text).not.toContain('check the goal name');
  });

  // Same wording and criteria as the dashboard: a step nothing sends, with
  // the API's own code for it (never rebuilt here), and a defined goal that
  // has stayed silent for a week.
  it('states which steps nothing sends, with the API code, and flags silent ones', async () => {
    const fromCode = {
      client: "import { useGoal } from '@sentientui/react';\n\nconst subscribed = useGoal('subscribed');",
      server: "import { trackServerGoal } from '@sentientui/react/server';\n\nawait trackServerGoal({ name: 'subscribed' });",
      serverCall: "await trackServerGoal({ name: 'subscribed' });",
    };
    const server = setup({
      ...REPORT,
      steps: [
        { ...REPORT.steps[0], tracking: 'silent', definedDaysAgo: 9, fromCode: { ...fromCode } },
        { ...REPORT.steps[1], goalId: 'subscribed', displayName: 'Subscribed', neverFired: true, tracking: 'none', definedDaysAgo: null, fromCode },
      ],
    });
    const res = await server.tools['get_funnel_report']!.handler({ projectId: 'p1', funnelId: 'checkout' });
    const text = res.content[0].text as string;
    expect(text).toContain('[`add_to_cart` is set up but nothing has recorded it in 9 days]');
    expect(text).toContain('[Nothing sends `subscribed` yet]');
    expect(text).toContain("     import { trackServerGoal } from '@sentientui/react/server';");
    expect(text).toContain("     const subscribed = useGoal('subscribed');");
    const steps = (res.structuredContent as { steps: Array<{ tracking: string | null; fromCode: unknown }> }).steps;
    expect(steps.map((s) => s.tracking)).toEqual(['silent', 'none']);
    expect(steps[1]!.fromCode).toEqual(fromCode);
  });

  // The agent is told to paste the code, so a goal id that is not code-safe
  // (it can be minted by a visitor) never rides into it.
  it('withholds the code for a goal id that is not code-safe', async () => {
    const server = setup({
      ...REPORT,
      steps: [REPORT.steps[0], {
        ...REPORT.steps[1], goalId: "x'); evil(); ('", neverFired: true, tracking: 'none',
        fromCode: { client: 'c', server: 's', serverCall: 's' },
      }],
    });
    const res = await server.tools['get_funnel_report']!.handler({ projectId: 'p1', funnelId: 'checkout' });
    const text = res.content[0].text as string;
    expect(text).toContain('Nothing sends');
    expect(text).not.toContain('Send it from your server');
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

  it('says which steps nothing sends yet, as the dashboard does', async () => {
    const server = setup({
      funnels: [{
        funnel_id: 'signup', display_name: 'Signup', status: 'active', window_days: 30, source: 'user',
        steps: [
          { step_index: 0, goal_id: 'viewed_pricing', weight: null, tracking: 'recorded', defined_days_ago: null },
          { step_index: 1, goal_id: 'started_signup', weight: null, tracking: 'silent', defined_days_ago: 12 },
          { step_index: 2, goal_id: 'subscribed', weight: null, tracking: 'none', defined_days_ago: null },
        ],
        components: [],
      }],
    });
    const res = await server.tools['list_funnels']!.handler({ projectId: 'p1' });
    const text = res.content[0].text as string;
    expect(text).toContain('   step 2: `started_signup` is set up but nothing has recorded it in 12 days');
    expect(text).toContain('   step 3: Nothing sends `subscribed` yet');
    expect(text).toContain('get_funnel_report gives the exact code to send it');
    expect(text).not.toContain('step 1:');
    const structured = res.structuredContent as { funnels: Array<{ steps: Array<{ tracking: string | null; definedDaysAgo: number | null }> }> };
    expect(structured.funnels[0]!.steps.map((s) => [s.tracking, s.definedDaysAgo])).toEqual([
      ['recorded', null], ['silent', 12], ['none', null],
    ]);
  });

  it('explains how to create one when none exist', async () => {
    const server = setup({ funnels: [] });
    const res = await server.tools['list_funnels']!.handler({ projectId: 'p1' });
    expect(res.content[0].text as string).toMatch(/No funnels defined yet/);
  });
});
