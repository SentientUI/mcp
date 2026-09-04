import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerComponentTools } from './components.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => { tools[name] = { handler }; }),
    tools,
  };
}

describe('list_components', () => {
  it('returns component names and variant counts', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    // The mgmt API returns a paginated envelope, not a bare array.
    vi.spyOn(client, 'get').mockResolvedValue({
      components: [
        { component_id: 'hero', total_impressions: 500, total_conversions: 75, variants: [{ variant_id: 'v_a' }, { variant_id: 'v_b' }] },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });
    const server = makeServer();
    registerComponentTools(server as any, client);
    const result = await server.tools['list_components']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('hero');
    expect(result.content[0].text).toContain('2 variants');
    expect(result.content[0].text).toContain('500');
  });

  it('shows no-components message when list is empty', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({ components: [], total: 0, page: 1, limit: 50 });
    const server = makeServer();
    registerComponentTools(server as any, client);
    const result = await server.tools['list_components']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('No components');
  });

  // Destructuring only page one of the paginated envelope silently capped the
  // "list ALL components" tool at the API default of 50 — component #51 never
  // existed as far as any agent could tell.
  it('follows nextCursor across pages and asks for the 200-per-page maximum', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    const mk = (id: string) => ({ component_id: id, total_impressions: 1, total_conversions: 0, variants: [] });
    const get = vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
      if (path.includes('cursor=page1end')) {
        return { components: [mk('zz_late')], total: 2, nextCursor: null } as any;
      }
      return { components: [mk('aa_early')], total: 2, nextCursor: 'page1end' } as any;
    });
    const server = makeServer();
    registerComponentTools(server as any, client);
    const result = await server.tools['list_components']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('zz_late');
    expect((result.structuredContent as { components: unknown[] }).components).toHaveLength(2);
    expect((result.structuredContent as { truncated: boolean }).truncated).toBe(false);
    expect(get.mock.calls[0]![0]).toContain('limit=200');
  });

  it('says so when the page cap cuts the listing short', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    // Every page claims another page follows — the cap must kick in and be surfaced.
    let n = 0;
    vi.spyOn(client, 'get').mockImplementation(async () => ({
      components: [{ component_id: `c${n}`, total_impressions: 1, total_conversions: 0, variants: [] }],
      total: 5000,
      nextCursor: `c${n++}`,
    }) as any);
    const server = makeServer();
    registerComponentTools(server as any, client);
    const result = await server.tools['list_components']!.handler({ projectId: 'p1' });
    expect((result.structuredContent as { truncated: boolean }).truncated).toBe(true);
    expect(result.content[0].text).toContain('fetch cap reached');
    expect(result.content[0].text).toContain('5000');
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
