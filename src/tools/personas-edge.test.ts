import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from '../api-client.js';
import { registerPersonaTools } from './personas.js';

function makeServer() {
  const tools: Record<string, { handler: Function }> = {};
  return {
    tool: vi.fn((name: string, _d: unknown, _s: unknown, handler: Function) => { tools[name] = { handler }; }),
    tools,
  };
}

async function run(data: unknown) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  vi.spyOn(client, 'get').mockResolvedValue(data as any);
  const server = makeServer();
  registerPersonaTools(server as any, client);
  const result = await server.tools['get_persona_breakdown']!.handler({ projectId: 'p1' });
  return result.content[0].text as string;
}

describe('get_persona_breakdown — percentage math', () => {
  it('computes sessionCount/totalSessions*100 to 1 decimal and reliability to 0 decimals', async () => {
    // 75/200 = 37.5%, reliability 0.66 -> 66%
    const text = await run({
      clusters: [{ label: 'browsers', sessionCount: 75, avgReliability: 0.66 }],
      totalSessions: 200,
    });
    expect(text).toContain('Total sessions: 200');
    expect(text).toContain('- browsers: 75 sessions (37.5% of traffic, reliability 66%)');
  });

  it('renders each cluster on its own line', async () => {
    const text = await run({
      clusters: [
        { label: 'buyers', sessionCount: 100, avgReliability: 0.9 },
        { label: 'lurkers', sessionCount: 300, avgReliability: 0.5 },
      ],
      totalSessions: 400,
    });
    expect(text).toContain('- buyers: 100 sessions (25.0% of traffic, reliability 90%)');
    expect(text).toContain('- lurkers: 300 sessions (75.0% of traffic, reliability 50%)');
  });

  it('shows empty-state message when there are no clusters', async () => {
    const text = await run({ clusters: [], totalSessions: 0 });
    expect(text).toContain('No persona clusters yet');
  });
});

describe('get_persona_breakdown — totalSessions === 0 (divide-by-zero guard)', () => {
  it('renders 0.0% (not Infinity) for a positive sessionCount when totalSessions is 0', async () => {
    // Guard in personas.ts: totalSessions > 0 ? (count/total)*100 : 0.
    const text = await run({
      clusters: [{ label: 'ghost', sessionCount: 5, avgReliability: 0.4 }],
      totalSessions: 0,
    });
    expect(text).toContain('- ghost: 5 sessions (0.0% of traffic, reliability 40%)');
    expect(text).toContain('Total sessions: 0');
    expect(text).not.toContain('Infinity');
  });

  it('renders 0.0% (not NaN) when both sessionCount and totalSessions are 0', async () => {
    const text = await run({
      clusters: [{ label: 'ghost', sessionCount: 0, avgReliability: 0.4 }],
      totalSessions: 0,
    });
    expect(text).toContain('- ghost: 0 sessions (0.0% of traffic, reliability 40%)');
    expect(text).not.toContain('NaN');
  });
});
