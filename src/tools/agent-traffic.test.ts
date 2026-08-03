import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient, ApiError } from '../api-client.js';
import { registerAgentTrafficTools } from './agent-traffic.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => { tools[name] = { handler }; }),
    tools,
  };
}

function setup(getImpl: (path: string) => unknown) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  vi.spyOn(client, 'get').mockImplementation(async (path: string) => getImpl(path) as any);
  const server = makeServer();
  registerAgentTrafficTools(server as any, client);
  return server;
}

describe('get_agent_traffic', () => {
  it('summarizes engines and paths', async () => {
    const server = setup(() => ({
      totals: { crawler: 10, api: 2, browser: 1 },
      engines: [{ engine: 'GPTBot', intent: 'training', count: 8, sharePct: 80, lastSeen: '2026-08-02T00:00:00Z', firstSeenInRange: false }],
      intents: { user: 1, search: 0, training: 8, other: 0 },
      topPaths: [{ path: '/pricing', count: 6, engines: 1 }],
      daily: [],
    }));
    const res = await server.tools['get_agent_traffic']!.handler({ projectId: 'p1' });
    expect(res.content[0].text).toContain('GPTBot');
    expect(res.content[0].text).toContain('/pricing');
    expect(res.content[0].text).toContain('Live user fetches: 1');
    expect((res.structuredContent as { totals: unknown }).totals).toEqual({ crawler: 10, api: 2, browser: 1 });
    expect((res.structuredContent as { intents: unknown }).intents).toEqual({ user: 1, search: 0, training: 8, other: 0 });
  });

  it('shows an empty state with the middleware hint', async () => {
    const server = setup(() => ({ totals: { crawler: 0, api: 0, browser: 0 }, engines: [], topPaths: [], daily: [] }));
    const res = await server.tools['get_agent_traffic']!.handler({ projectId: 'p1' });
    expect(res.content[0].text).toContain('No agent traffic observed yet');
    expect(res.content[0].text).toContain('AdaptiveRoot');
  });

  it('returns upgrade guidance (not a throw) on the plan gate', async () => {
    const server = setup(() => { throw new ApiError(403, 'agent_analytics_requires_paid_plan'); });
    const res = await server.tools['get_agent_traffic']!.handler({ projectId: 'p1' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('paid');
  });
});

describe('get_agent_legibility', () => {
  it('lists failing checks and empty blocks', async () => {
    const server = setup(() => ({
      paths: [{
        path: '/pricing', score: 50,
        checks: { price: false, name: true, positioning: true, cta: false, notes: ['No price found in the server HTML.'] },
        lastChecked: '2026-08-03T00:00:00Z',
      }],
      emptyBlocks: [{ block: 'hero', variant: 'B', occurrences: 12 }],
    }));
    const res = await server.tools['get_agent_legibility']!.handler({ projectId: 'p1' });
    const text = res.content[0].text as string;
    expect(text).toContain('/pricing');
    expect(text).toContain('price');
    expect(text).toContain('No price found');
    expect(text).toContain('hero');
  });

  it('shows an empty state when nothing has been scored', async () => {
    const server = setup(() => ({ paths: [], emptyBlocks: [] }));
    const res = await server.tools['get_agent_legibility']!.handler({ projectId: 'p1' });
    expect(res.content[0].text).toContain('No legibility results yet');
  });
});
