import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerGoalTools } from './goals.js';
import { registerFunnelTools } from './funnels.js';
import { registerComponentTools } from './components.js';
import { registerStageTools } from './stages.js';
import { registerLayoutTools } from './layout.js';

// Task 12 made every client-visible rate People ÷ People and put the other
// converters beside it as `unconfirmed*`. These pin that the tools say so, and
// pass the API's remainder fields through instead of recomputing them.
const REMAINDER = "from visitors we couldn't confirm as people";

function setup(register: (s: any, c: ApiClient) => void, data: unknown) {
  const tools: Record<string, { config: any; handler: ToolHandler }> = {};
  const server = { registerTool: vi.fn((n: string, config: unknown, handler: ToolHandler) => { tools[n] = { config, handler }; }) };
  const client = new ApiClient({ apiKey: 'sk_test' });
  vi.spyOn(client, 'get').mockResolvedValue(data as any);
  register(server, client);
  return tools;
}

describe('get_goal_funnel', () => {
  const data = {
    currency: 'USD',
    goals: [{
      goalName: 'signup', hits: 8, uniqueSessions: 7, pct: 0.14,
      unconfirmedHits: 3, unconfirmedSessions: 2, revenue: 120, unconfirmedRevenue: 40,
      avgOrderValue: 20, revenuePerSession: 2, variants: [],
    }],
  };
  it('says conversion rate among People and passes the unconfirmed fields through', async () => {
    const t = setup(registerGoalTools, data);
    const res = await t['get_goal_funnel']!.handler({ projectId: 'p1' });
    expect(t['get_goal_funnel']!.config.description).toContain('conversion rate among People');
    expect(res.structuredContent).toMatchObject({
      goals: [{ unconfirmedHits: 3, unconfirmedSessions: 2, unconfirmedRevenue: 40, revenue: 120 }],
    });
    expect(res.content[0]!.text).toContain('14.0% conversion rate among People');
    expect(res.content[0]!.text).toContain(`3 hits (2 sessions) ${REMAINDER}`);
    expect(res.content[0]!.text).toContain(`40.00 USD revenue ${REMAINDER}`);
  });
  it('tolerates an API without the unconfirmed fields', async () => {
    const t = setup(registerGoalTools, { goals: [{ goalName: 'g', hits: 1, uniqueSessions: 1, pct: 0.1, variants: [] }] });
    const res = await t['get_goal_funnel']!.handler({ projectId: 'p1' });
    expect(res.content[0]!.text).not.toContain(REMAINDER);
  });
});

describe('get_funnel_report', () => {
  it('reached is People, unconfirmedReached is passed through and labelled', async () => {
    const t = setup(registerFunnelTools, {
      funnelId: 'c', displayName: 'C', windowDays: 30, currency: 'USD',
      steps: [{ stepIndex: 0, goalId: 'a', displayName: 'A', reached: 10, unconfirmedReached: 4, dropOffFromPrevious: null, neverFired: false, variants: [], personas: [] }],
      revenue: null, avgOrderValue: null, revenuePerEnteringVisitor: null, holdoutCompletion: null,
    });
    const res = await t['get_funnel_report']!.handler({ projectId: 'p1', funnelId: 'c' });
    expect(t['get_funnel_report']!.config.description).toContain('People');
    expect(res.content[0]!.text).toContain('10 People reached');
    expect(res.content[0]!.text).toContain(`4 more ${REMAINDER}`);
    expect(res.structuredContent).toMatchObject({ steps: [{ unconfirmedReached: 4 }] });
  });
});

describe('get_variant_performance / list_components', () => {
  const comp = {
    component_id: 'hero', total_impressions: 50, total_conversions: 5, total_unconfirmed_conversions: 6,
    variants: [{ variant_id: 'control', impressions: 50, exposed_sessions: 50, conversions: 5, unconfirmed_conversions: 6 }],
  };
  const page = { components: [comp], total: 1, page: 1, limit: 50 };
  it('variant rows carry the remainder and the description says among People', async () => {
    const t = setup(registerComponentTools, page);
    const res = await t['get_variant_performance']!.handler({ projectId: 'p1' });
    expect(t['get_variant_performance']!.config.description).toContain('conversion rate among People');
    expect((res.structuredContent as any).variants[0].unconfirmedConversions).toBe(6);
    expect(res.content[0]!.text).toContain(`6 conversions ${REMAINDER}`);
  });
  it('list_components passes total_unconfirmed_conversions through', async () => {
    const t = setup(registerComponentTools, page);
    const res = await t['list_components']!.handler({ projectId: 'p1' });
    expect((res.structuredContent as any).components[0].unconfirmedConversions).toBe(6);
    expect(res.content[0]!.text).toContain(REMAINDER);
  });
});

describe('descriptions that must not over-claim People', () => {
  it('get_stage_breakdown says People, and names the lift test as the exception', () => {
    const t = setup(registerStageTools, {});
    const d: string = t['get_stage_breakdown']!.config.description;
    expect(d).toContain('People');
    expect(d).not.toMatch(/human sessions/);
    expect(d).toMatch(/lift test[^.]*(own|not People)/i);
  });
  it('get_layout_stats stays the optimizer\'s own learning state, not People', () => {
    const t = setup(registerLayoutTools, []);
    expect(t['get_layout_stats']!.config.description).not.toMatch(/People/);
  });
});
