import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerGuardrailTools } from './guardrails.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => { tools[name] = { handler }; }),
    tools,
  };
}

async function runFull(data: unknown) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  vi.spyOn(client, 'get').mockResolvedValue(data as any);
  const server = makeServer();
  registerGuardrailTools(server as any, client);
  return server.tools['list_guardrail_events']!.handler({ projectId: 'p1' });
}

async function run(data: unknown) {
  const result = await runFull(data);
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

  it('surfaces the protected funnel on funnel-guardrail pauses, defaulting to null', async () => {
    const result = await runFull({
      guardrailEvents: [
        { componentId: 'hero', variantIds: ['v_b'], pausedAt: null, funnelId: 'checkout' },
        { componentId: 'cta', variantIds: ['v_x'], pausedAt: null }, // older API — no funnelId
      ],
    });
    const sc = result.structuredContent as { events: Array<{ funnelId: string | null }> };
    expect(sc.events[0]!.funnelId).toBe('checkout');
    expect(sc.events[1]!.funnelId).toBeNull();
    const text = result.content[0].text as string;
    expect(text).toContain('- hero: variants [v_b] paused (protecting the "checkout" funnel)');
    expect(text).not.toContain('cta: variants [v_x] paused (protecting');
  });
});
