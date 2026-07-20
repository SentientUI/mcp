import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from '../api-client.js';
import { registerLayoutTools } from './layout.js';

function makeServer() {
  const tools: Record<string, { handler: Function }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: Function) => { tools[name] = { handler }; }),
    tools,
  };
}

async function run(data: unknown) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  vi.spyOn(client, 'get').mockResolvedValue(data as any);
  const server = makeServer();
  registerLayoutTools(server as any, client);
  const result = await server.tools['get_layout_stats']!.handler({ projectId: 'p1' });
  return result.content[0].text as string;
}

describe('get_layout_stats — rendering', () => {
  it('joins layoutOrder with arrows and formats avgReward to 2 decimals', async () => {
    const text = await run([
      { persona: 'buyers', layoutOrder: ['pricing', 'hero', 'faq'], avgReward: 0.8, pulls: 120 },
    ]);
    expect(text).toContain('- buyers: [pricing → hero → faq] (avg reward: 0.80, 120 pulls)');
  });

  it('pads avgReward to two decimals (0.8 -> 0.80; 0.125.toFixed(2) -> 0.13 per V8)', async () => {
    const text = await run([
      { persona: 'a', layoutOrder: ['x'], avgReward: 0.125, pulls: 5 },
      { persona: 'b', layoutOrder: ['y'], avgReward: 0.8, pulls: 1 },
    ]);
    expect(text).toContain('avg reward: 0.13');
    expect(text).toContain('avg reward: 0.80');
  });

  it('renders one line per persona', async () => {
    const text = await run([
      { persona: 'buyers', layoutOrder: ['hero'], avgReward: 0.5, pulls: 10 },
      { persona: 'browsers', layoutOrder: ['faq', 'hero'], avgReward: 0.33, pulls: 7 },
    ]);
    expect(text.split('\n')).toHaveLength(2);
    expect(text).toContain('- browsers: [faq → hero] (avg reward: 0.33, 7 pulls)');
  });

  it('shows empty-state message when array is empty', async () => {
    const text = await run([]);
    expect(text).toContain('No layout data yet. More visitor sessions are needed.');
  });
});
