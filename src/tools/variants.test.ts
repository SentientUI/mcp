import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerVariantWriteTools } from './variants.js';

type ToolConfig = {
  inputSchema?: Record<string, z.ZodTypeAny>;
  outputSchema?: Record<string, z.ZodTypeAny>;
};

function makeServer() {
  const tools: Record<string, { config: ToolConfig; handler: ToolHandler }> = {};
  return {
    registerTool: vi.fn((name: string, config: ToolConfig, handler: ToolHandler) => {
      tools[name] = { config, handler };
    }),
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

  it('output schema accepts a null displayName (API returns displayName ?? null)', () => {
    const server = makeServer();
    registerVariantWriteTools(server as any, new ApiClient({ apiKey: 'sk_test' }));
    const out = z.object(server.tools['create_variant']!.config.outputSchema!);
    // A successful create whose displayName came back null must still validate.
    expect(() =>
      out.parse({
        variantId: 'v1',
        displayName: null,
        componentId: 'hero',
        state: 'draft',
        hasContent: false,
      }),
    ).not.toThrow();
  });

  it('input schema requires non-empty componentId and displayName', () => {
    const server = makeServer();
    registerVariantWriteTools(server as any, new ApiClient({ apiKey: 'sk_test' }));
    const input = z.object(server.tools['create_variant']!.config.inputSchema!);
    const base = {
      projectId: '00000000-0000-0000-0000-000000000001',
      componentId: 'hero',
      displayName: 'V2',
    };
    expect(input.safeParse(base).success).toBe(true);
    expect(input.safeParse({ ...base, componentId: '' }).success).toBe(false);
    expect(input.safeParse({ ...base, displayName: '' }).success).toBe(false);
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
