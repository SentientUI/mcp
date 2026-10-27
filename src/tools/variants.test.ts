import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod/v3';
import type { ToolHandler } from './test-utils.js';
import { ApiClient, ApiError } from '../api-client.js';
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

const PID = '00000000-0000-0000-0000-000000000001';

function setupWrite() {
  const client = new ApiClient({ apiKey: 'sk_test' });
  const server = makeServer();
  registerVariantWriteTools(server as any, client);
  return { client, server };
}

// Audit M3: the API always supported undoing these writes, but the MCP had no
// tool for any of them — pause_variant was documented as irreversible.
describe('reversal tools', () => {
  it('pause_variant is destructive and points at resume_variant', async () => {
    const { client, server } = setupWrite();
    vi.spyOn(client, 'post').mockResolvedValue({ ok: true });
    const ann = (server.tools['pause_variant']!.config as { annotations?: Record<string, unknown> }).annotations;
    expect(ann).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const result = await server.tools['pause_variant']!.handler({ projectId: PID, componentId: 'hero', variantId: 'v_b' });
    expect(result.content[0].text).toContain('resume_variant');
  });

  it('resume_variant unpauses through the guardrail unpause route', async () => {
    const { client, server } = setupWrite();
    const postSpy = vi.spyOn(client, 'post').mockResolvedValue({ ok: true });
    await server.tools['resume_variant']!.handler({ projectId: PID, componentId: 'hero cta', variantId: 'v_b' });
    expect(postSpy).toHaveBeenCalledWith(`/projects/${PID}/guardrails/hero%20cta/unpause`, { variantIds: ['v_b'] });
  });

  it('update_variant PATCHes the managed variant and says when it goes live', async () => {
    const { client, server } = setupWrite();
    const patchSpy = vi.spyOn(client, 'patch').mockResolvedValue({ ok: true });
    const result = await server.tools['update_variant']!.handler({
      projectId: PID, componentId: 'hero', variantId: 'dm_1', status: 'active',
    });
    expect(patchSpy).toHaveBeenCalledWith(`/projects/${PID}/variants`, {
      componentId: 'hero', variantId: 'dm_1', displayName: undefined, content: undefined, status: 'active',
    });
    expect(result.content[0].text).toContain('ACTIVE');
  });

  it('update_variant refuses an empty update instead of reporting success', async () => {
    const { client, server } = setupWrite();
    const patchSpy = vi.spyOn(client, 'patch');
    const result = await server.tools['update_variant']!.handler({ projectId: PID, componentId: 'hero', variantId: 'dm_1' });
    expect(result.isError).toBe(true);
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('delete_variant_draft DELETEs and explains a not_found', async () => {
    const { client, server } = setupWrite();
    const delSpy = vi.spyOn(client, 'delete').mockResolvedValue({ ok: true });
    await server.tools['delete_variant_draft']!.handler({ projectId: PID, componentId: 'hero', variantId: 'dm_1' });
    expect(delSpy).toHaveBeenCalledWith(`/projects/${PID}/variants`, { componentId: 'hero', variantId: 'dm_1' });

    delSpy.mockRejectedValue(new ApiError(404, 'not_found'));
    const result = await server.tools['delete_variant_draft']!.handler({ projectId: PID, componentId: 'hero', variantId: 'v_live' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('pause_variant or retire_variant');
  });

  it('retire_variant maps variant_promoted and keeps the server sentence', async () => {
    const { client, server } = setupWrite();
    vi.spyOn(client, 'post').mockRejectedValue(new ApiError(409, 'variant_promoted', 'Unpromote this variant before hiding it.'));
    const result = await server.tools['retire_variant']!.handler({ projectId: PID, componentId: 'hero', variantId: 'v_b' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unpromote it in the dashboard');
    expect(result.content[0].text).toContain('Unpromote this variant before hiding it.');
  });

  it('restore_variant posts to /variants/restore and reminds that a pause is separate', async () => {
    const { client, server } = setupWrite();
    const postSpy = vi.spyOn(client, 'post').mockResolvedValue({ ok: true });
    const result = await server.tools['restore_variant']!.handler({ projectId: PID, componentId: 'hero', variantId: 'v_b' });
    expect(postSpy).toHaveBeenCalledWith(`/projects/${PID}/variants/restore`, { componentId: 'hero', variantId: 'v_b' });
    expect(result.content[0].text).toContain('resume_variant');
  });

  it('create_variant points at update_variant to activate, not the dashboard', async () => {
    const { client, server } = setupWrite();
    vi.spyOn(client, 'post').mockResolvedValue({ variantId: 'dm_2', displayName: 'V2' });
    const result = await server.tools['create_variant']!.handler({ projectId: PID, componentId: 'hero', displayName: 'V2', content: 'Hi' });
    expect(result.content[0].text).toContain("update_variant (status 'active')");
  });

  it('refresh_insights documents its plan and role gates', () => {
    const { server } = setupWrite();
    const desc = (server.tools['refresh_insights']!.config as { description?: string }).description ?? '';
    expect(desc).toContain('Starter');
    expect(desc).toContain('editor/admin');
  });
});
