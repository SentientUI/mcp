import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient, ApiError } from '../api-client.js';
import { registerTrafficTools } from './traffic.js';

function makeServer() {
  const tools: Record<string, { config: any; handler: ToolHandler }> = {};
  return {
    registerTool: vi.fn((name: string, config: unknown, handler: ToolHandler) => { tools[name] = { config, handler }; }),
    tools,
  };
}

const BREAKDOWN = {
  window: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T00:00:00.000Z' },
  total: 100,
  groups: [
    { group: 'people', label: 'People', count: 40, evidence: [] },
    { group: 'loaded_no_interaction', label: "Loaded but didn't interact", count: 20, evidence: [] },
    { group: 'not_verified', label: 'Not verified — no browser activity', count: 10, evidence: [] },
    { group: 'being_analysed', label: 'Being analysed', count: 3, evidence: [] },
    { group: 'ai_assistant', label: 'AI assistants', count: 5, evidence: [{ code: 'x', label: 'Named AI assistant', count: 5 }] },
    { group: 'crawler', label: 'Search & AI crawlers', count: 12, evidence: [] },
    { group: 'other_automated', label: 'Other automated', count: 10, evidence: [] },
  ],
  agents: [{ name: 'ChatGPT-User', group: 'ai_assistant', count: 5 }],
  conversions: { total: 9, fromPeople: 6 },
  notices: ['no_interaction_evidence'],
};

function setup(getImpl: (path: string) => unknown) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  const get = vi.spyOn(client, 'get').mockImplementation(async (path: string) => getImpl(path) as any);
  const server = makeServer();
  registerTrafficTools(server as any, client);
  return { server, get };
}

describe('get_traffic_breakdown', () => {
  it('calls the traffic endpoint with the range and returns the API shape verbatim', async () => {
    const { server, get } = setup(() => BREAKDOWN);
    const res = await server.tools['get_traffic_breakdown']!.handler({ projectId: 'p1', range: '30d' });
    expect(get).toHaveBeenCalledWith('/projects/p1/traffic?range=30d');
    expect(res.structuredContent).toEqual(BREAKDOWN);
  });

  it('lists every group with label and count, the being-analysed sentence and notices', async () => {
    const { server } = setup(() => BREAKDOWN);
    const text = (await server.tools['get_traffic_breakdown']!.handler({ projectId: 'p1' })).content[0]!.text;
    for (const g of BREAKDOWN.groups) expect(text).toContain(`${g.label}: ${g.count}`);
    expect(text).toContain('3 visitors are being analysed — usually settled within 3 hours');
    expect(text).toContain("Your integration isn't reporting clicks or scrolls, so we can't confirm anyone as a person yet.");
    expect(text).toContain('ChatGPT-User');
    expect(text).toContain('9 conversions in total, 6 from People');
    expect(text).not.toContain("couldn't confirm");
  });

  it('omits the being-analysed sentence when nobody is being analysed', async () => {
    const { server } = setup(() => ({
      ...BREAKDOWN,
      groups: BREAKDOWN.groups.map((g) => (g.group === 'being_analysed' ? { ...g, count: 0 } : g)),
      notices: [],
    }));
    const text = (await server.tools['get_traffic_breakdown']!.handler({ projectId: 'p1' })).content[0]!.text;
    expect(text).not.toContain('being analysed —');
  });

  it('defines People in the description', () => {
    const { server } = setup(() => BREAKDOWN);
    expect(server.tools['get_traffic_breakdown']!.config.description).toContain(
      'ran the page, interacted (click, scroll, mouse, touch or key) and passed the bot check',
    );
  });

  it('turns range_too_large into a friendly error, not a throw', async () => {
    const { server } = setup(() => { throw new ApiError(503, 'range_too_large'); });
    const res = await server.tools['get_traffic_breakdown']!.handler({ projectId: 'p1', range: 'all' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/shorter range/i);
  });

  it('calls the endpoint without a query string when no range is given', async () => {
    const { server, get } = setup(() => BREAKDOWN);
    await server.tools['get_traffic_breakdown']!.handler({ projectId: 'p1' });
    expect(get).toHaveBeenCalledWith('/projects/p1/traffic');
  });

  it('appends the server detail to the range_too_large guidance', async () => {
    const { server } = setup(() => { throw new ApiError(503, 'range_too_large', 'Narrow the window'); });
    const res = await server.tools['get_traffic_breakdown']!.handler({ projectId: 'p1', range: 'all' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/shorter range/i);
    expect(res.content[0]!.text).toContain('Narrow the window');
  });
});
