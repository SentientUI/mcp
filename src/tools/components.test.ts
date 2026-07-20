import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from '../api-client.js';
import { registerComponentTools } from './components.js';

function makeServer() {
  const tools: Record<string, { handler: Function }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: Function) => { tools[name] = { handler }; }),
    tools,
  };
}

describe('list_components', () => {
  it('returns component names and variant counts', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue([
      { component_id: 'hero', total_impressions: 500, total_conversions: 75, variants: [{ variant_id: 'v_a' }, { variant_id: 'v_b' }] },
    ]);
    const server = makeServer();
    registerComponentTools(server as any, client);
    const result = await server.tools['list_components']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('hero');
    expect(result.content[0].text).toContain('2 variants');
    expect(result.content[0].text).toContain('500');
  });

  it('shows no-components message when list is empty', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue([]);
    const server = makeServer();
    registerComponentTools(server as any, client);
    const result = await server.tools['list_components']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('No components');
  });
});

describe('get_variant_performance', () => {
  it('returns CVR and momentum for each variant', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      cvr: [
        { variantId: 'v_a', currentCvr: 0.15, priorCvr: 0.10, deltaPp: 5, relativeDelta: 0.5 },
        { variantId: 'v_b', currentCvr: 0.08, priorCvr: 0.11, deltaPp: -3, relativeDelta: -0.27 },
      ],
      momentum: [
        { variantId: 'v_a', direction: 'gaining', score: 0.5 },
        { variantId: 'v_b', direction: 'losing', score: -0.27 },
      ],
    });
    const server = makeServer();
    registerComponentTools(server as any, client);
    const result = await server.tools['get_variant_performance']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('v_a');
    expect(result.content[0].text).toContain('15.00%');
    expect(result.content[0].text).toContain('gaining');
    expect(result.content[0].text).toContain('v_b');
    expect(result.content[0].text).toContain('losing');
  });

  it('shows no-data message when cvr list is empty', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({ cvr: [], momentum: [] });
    const server = makeServer();
    registerComponentTools(server as any, client);
    const result = await server.tools['get_variant_performance']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('No variant data');
  });
});
