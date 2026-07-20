import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from '../api-client.js';
import { registerInsightTools } from './insights.js';
import { registerPersonaTools } from './personas.js';
import { registerGoalTools } from './goals.js';
import { registerGuardrailTools } from './guardrails.js';
import { registerLayoutTools } from './layout.js';

function makeServer() {
  const tools: Record<string, { handler: Function }> = {};
  return {
    tool: vi.fn((name: string, _d: unknown, _s: unknown, handler: Function) => { tools[name] = { handler }; }),
    tools,
  };
}

describe('get_insights', () => {
  it('returns narrator bullets when status is ok', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      status: 'ok',
      narratorBullets: ['v_a CVR is up 5pp this week.'],
      advisorBullets: [],
      isStale: false,
      generatedAt: '2026-06-10T10:00:00.000Z',
    });
    const server = makeServer();
    registerInsightTools(server as any, client);
    const result = await server.tools['get_insights']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('v_a CVR is up 5pp');
  });

  it('returns empty message when status is empty', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({ status: 'empty' });
    const server = makeServer();
    registerInsightTools(server as any, client);
    const result = await server.tools['get_insights']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('No insights');
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
    expect(result.content[0].text).toContain('No active guardrail events');
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
