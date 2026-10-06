import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient, ApiError } from '../api-client.js';
import { apiErrorGuidance } from './common.js';
import { registerProjectTools } from './projects.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      tools[name] = { handler };
    }),
    tools,
  };
}

describe('list_projects', () => {
  let client: ApiClient;
  let server: ReturnType<typeof makeServer>;

  beforeEach(() => {
    client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue([
      { id: 'p1', name: 'My Shop', context_type: 'ecommerce', created_at: '2026-01-01T00:00:00Z' },
    ]);
    server = makeServer();
    registerProjectTools(server as any, client);
  });

  it('registers list_projects and get_project_stats tools', () => {
    expect(server.registerTool).toHaveBeenCalledWith(
      'list_projects',
      expect.objectContaining({ inputSchema: {} }),
      expect.any(Function),
    );
    expect(server.registerTool).toHaveBeenCalledWith(
      'get_project_stats',
      expect.objectContaining({ inputSchema: expect.objectContaining({ projectId: expect.anything() }) }),
      expect.any(Function),
    );
  });

  it('list_projects returns formatted project list', async () => {
    const result = await server.tools['list_projects']!.handler({});
    expect(result.content[0].text).toContain('My Shop');
    expect(result.content[0].text).toContain('p1');
  });
});

describe('get_project_stats', () => {
  let client: ApiClient;
  let server: ReturnType<typeof makeServer>;

  beforeEach(() => {
    client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({
      status: 'healthy',
      events24h: 500,
      sessions24h: 120,
      agentCalls: 8,
      lastEventAt: '2026-06-10T10:00:00.000Z',
    });
    server = makeServer();
    registerProjectTools(server as any, client);
  });

  it('get_project_stats returns health data', async () => {
    const result = await server.tools['get_project_stats']!.handler({ projectId: 'p1' });
    expect(result.content[0].text).toContain('healthy');
    expect(result.content[0].text).toContain('500');
  });
});

describe('create_project', () => {
  let client: ApiClient;
  let server: ReturnType<typeof makeServer>;

  beforeEach(() => {
    client = new ApiClient({ apiKey: 'oauth_token' });
    server = makeServer();
    registerProjectTools(server as any, client);
  });

  it('posts to /projects and returns the new id + pk_ key + next steps', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue({ id: 'proj-1', apiKey: 'pk_live_abc' });

    const result = await server.tools['create_project']!.handler({
      name: 'My App',
      contextType: 'saas',
      framework: 'react',
      websiteUrl: 'https://example.com',
    });

    // websiteUrl is mapped to the endpoint's `origin` field.
    expect(post).toHaveBeenCalledWith('/projects', {
      name: 'My App',
      contextType: 'saas',
      framework: 'react',
      origin: 'https://example.com',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('proj-1');
    expect(result.content[0].text).toContain('pk_live_abc');
    expect(result.content[0].text).toContain('get_integration_guide');
  });

  it('returns actionable guidance (isError) when a scoped server key is used', async () => {
    vi.spyOn(client, 'post').mockRejectedValue(new ApiError(403, 'insufficient_scope'));

    const result = await server.tools['create_project']!.handler({ name: 'My App' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/account login/i);
  });

  it('surfaces the SINGLE shared guidance source for insufficient_scope (no divergent copy)', async () => {
    vi.spyOn(client, 'post').mockRejectedValue(new ApiError(403, 'insufficient_scope'));

    const result = await server.tools['create_project']!.handler({ name: 'My App' });

    // Verbatim-equal to the shared mapper: create_project routes through the same
    // withApiErrorGuidance path rather than re-implementing its own wording.
    expect(result.content[0].text).toBe(apiErrorGuidance(new ApiError(403, 'insufficient_scope')));
  });

  it('maps project_limit_reached to upgrade guidance', async () => {
    vi.spyOn(client, 'post').mockRejectedValue(new ApiError(402, 'project_limit_reached'));

    const result = await server.tools['create_project']!.handler({ name: 'X' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/limit/i);
  });

  it('rethrows unmapped API errors', async () => {
    vi.spyOn(client, 'post').mockRejectedValue(new ApiError(500, 'create_failed'));

    await expect(server.tools['create_project']!.handler({ name: 'X' })).rejects.toThrow('create_failed');
  });
});

describe('add_origin', () => {
  it('posts the origin and echoes the allow-list delimited', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    const postSpy = vi.spyOn(client, 'post').mockResolvedValue({ origins: ['https://shop.example.com'] });
    const server = makeServer();
    registerProjectTools(server as any, client);
    const result = await server.tools['add_origin']!.handler({
      projectId: '00000000-0000-0000-0000-000000000001',
      origin: 'https://shop.example.com/cart',
    });
    expect(postSpy).toHaveBeenCalledWith('/projects/00000000-0000-0000-0000-000000000001/origins', {
      origin: 'https://shop.example.com/cart',
    });
    expect(result.content[0].text).toContain('`https://shop.example.com`');
  });
});

// Audit M18: agentCalls was described as "MCP/API" calls, but the API counts
// agent_events — /v1/agent calls only.
describe('get_project_stats agentCalls wording', () => {
  it('names the /v1/agent API, not MCP', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    vi.spyOn(client, 'get').mockResolvedValue({ status: 'ok', events24h: 1, sessions24h: 1, agentCalls: 7, lastEventAt: null });
    const server = makeServer();
    registerProjectTools(server as any, client);
    const result = await server.tools['get_project_stats']!.handler({ projectId: '00000000-0000-0000-0000-000000000001' });
    expect(result.content[0].text).toContain('Agent API calls (/v1/agent, all-time): 7');
    expect(result.content[0].text).not.toMatch(/MCP/);
  });
});
