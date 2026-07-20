import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from '../api-client.js';
import { registerGuardrailTools } from './guardrails.js';

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
  registerGuardrailTools(server as any, client);
  const result = await server.tools['list_guardrail_events']!.handler({ projectId: 'p1' });
  return result.content[0].text as string;
}

describe('list_guardrail_events — rendering', () => {
  it('joins multiple variant ids and appends "at <pausedAt>" when present', async () => {
    const text = await run({
      guardrailEvents: [
        { componentId: 'hero', variantIds: ['v_b', 'v_c'], pausedAt: '2026-06-10T08:00:00Z' },
      ],
    });
    expect(text).toContain('- hero: variants [v_b, v_c] paused at 2026-06-10T08:00:00Z');
  });

  it('omits the "at ..." suffix when pausedAt is null', async () => {
    const text = await run({
      guardrailEvents: [
        { componentId: 'cta', variantIds: ['v_x'], pausedAt: null },
      ],
    });
    expect(text).toContain('- cta: variants [v_x] paused');
    expect(text).not.toContain('paused at');
  });

  it('renders one line per event', async () => {
    const text = await run({
      guardrailEvents: [
        { componentId: 'hero', variantIds: ['v_a'], pausedAt: null },
        { componentId: 'footer', variantIds: ['v_z'], pausedAt: '2026-06-11T00:00:00Z' },
      ],
    });
    expect(text.split('\n')).toHaveLength(2);
    expect(text).toContain('- hero: variants [v_a] paused');
    expect(text).toContain('- footer: variants [v_z] paused at 2026-06-11T00:00:00Z');
  });

  it('shows empty-state message when there are no events', async () => {
    const text = await run({ guardrailEvents: [] });
    expect(text).toContain('No active guardrail events in the last 24 hours.');
  });
});
