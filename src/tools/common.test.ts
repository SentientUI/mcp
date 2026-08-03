import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient, ApiError } from '../api-client.js';
import { apiErrorGuidance, withApiErrorGuidance } from './common.js';
import { registerInsightTools } from './insights.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      tools[name] = { handler };
    }),
    tools,
  };
}

describe('apiErrorGuidance', () => {
  it('maps insufficient_scope to a login hint', () => {
    expect(apiErrorGuidance(new ApiError(403, 'insufficient_scope'))).toMatch(/account login/i);
  });

  it('maps demo_read_only to a demo hint', () => {
    expect(apiErrorGuidance(new ApiError(403, 'demo_read_only'))).toMatch(/read-only/i);
  });

  it('maps 402 to an upgrade hint', () => {
    const g = apiErrorGuidance(new ApiError(402, 'tier_locked'));
    expect(g).toMatch(/higher plan/i);
    expect(g).toContain('tier_locked');
  });

  it('returns null for unmapped errors', () => {
    expect(apiErrorGuidance(new ApiError(500, 'kaboom'))).toBeNull();
  });
});

describe('withApiErrorGuidance', () => {
  it('converts a mapped ApiError into an isError result', async () => {
    const wrapped = withApiErrorGuidance(async () => {
      throw new ApiError(403, 'insufficient_scope');
    });
    const result = await wrapped({});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/account login/i);
  });

  it('rethrows unmapped ApiErrors', async () => {
    const wrapped = withApiErrorGuidance(async () => {
      throw new ApiError(500, 'kaboom');
    });
    await expect(wrapped({})).rejects.toThrow('kaboom');
  });

  it('passes through successful results untouched', async () => {
    const wrapped = withApiErrorGuidance(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));
    expect((await wrapped({})).content[0]!.text).toBe('ok');
  });

  it('applies to a real registered tool (get_insights returns guidance on 402)', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockRejectedValue(new ApiError(402, 'growth_tier_required'));
    const server = makeServer();
    registerInsightTools(server as any, client);
    const result = await server.tools['get_insights']!.handler({ projectId: 'p1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/higher plan/i);
  });
});
