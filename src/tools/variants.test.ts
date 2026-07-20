import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from '../api-client.js';
import { registerVariantWriteTools } from './variants.js';

function makeServer() {
  const tools: Record<string, { handler: Function }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: Function) => { tools[name] = { handler }; }),
    tools,
  };
}

describe('create_variant', () => {
  it('calls POST /projects/:id/variants and confirms creation', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    const postSpy = vi.spyOn(client, 'post').mockResolvedValue({ variantId: 'v_new', displayName: 'V2' });
    const server = makeServer();
    registerVariantWriteTools(server as any, client);

    const result = await server.tools['create_variant']!.handler({
      projectId: '00000000-0000-0000-0000-000000000001',
      componentId: 'hero',
      displayName: 'V2',
    });

    expect(postSpy).toHaveBeenCalledWith(
      '/projects/00000000-0000-0000-0000-000000000001/variants',
      { componentId: 'hero', displayName: 'V2' },
    );
    expect(result.content[0].text).toContain('v_new');
  });
});

describe('pause_variant', () => {
  it('calls POST /projects/:id/variants/pause and confirms', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    const postSpy = vi.spyOn(client, 'post').mockResolvedValue({ ok: true });
    const server = makeServer();
    registerVariantWriteTools(server as any, client);

    const result = await server.tools['pause_variant']!.handler({
      projectId: '00000000-0000-0000-0000-000000000001',
      componentId: 'hero',
      variantId: 'v_b',
    });

    expect(postSpy).toHaveBeenCalledWith(
      '/projects/00000000-0000-0000-0000-000000000001/variants/pause',
      { componentId: 'hero', variantId: 'v_b' },
    );
    expect(result.content[0].text).toContain('paused');
  });
});

describe('refresh_insights', () => {
  it('calls POST /projects/:id/insights/refresh and confirms', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    const postSpy = vi.spyOn(client, 'post').mockResolvedValue({ status: 'generating' });
    const server = makeServer();
    registerVariantWriteTools(server as any, client);

    const result = await server.tools['refresh_insights']!.handler({
      projectId: '00000000-0000-0000-0000-000000000001',
    });

    expect(postSpy).toHaveBeenCalledWith('/projects/00000000-0000-0000-0000-000000000001/insights/refresh');
    expect(result.content[0].text).toContain('generating');
  });
});
