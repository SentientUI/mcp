import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient, ApiError } from '../api-client.js';
import { registerInternalTrafficTools } from './internal-traffic.js';

const P = '11111111-1111-4111-8111-111111111111';
const HASH = 'a'.repeat(64);

function makeServer() {
  const tools: Record<string, { handler: ToolHandler; config: any }> = {};
  return {
    registerTool: vi.fn((name: string, config: unknown, handler: ToolHandler) => { tools[name] = { handler, config }; }),
    tools,
  };
}

function setup(answer: unknown) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  const get = vi.spyOn(client, 'get').mockImplementation(async () => {
    if (answer instanceof Error) throw answer;
    return answer as any;
  });
  const server = makeServer();
  registerInternalTrafficTools(server as any, client);
  return { server, get };
}

const RULES = {
  internalOrigins: ['https://staging.example.com'],
  allowedOrigins: ['http://localhost:3000', 'https://www.example.com', 'https://staging.example.com'],
  emailDomains: ['example.com'],
  emails: [{ hash: HASH, masked: 'c***@example.com' }],
  browserLink: { token: 'tok_secret_value' },
  counts7d: { site: 12, code: 3, email_rule: 0, domain_rule: 5, browser: 1, total: 21 },
  recordingSince: '2026-11-05T10:00:00.000Z',
};

describe('get_internal_traffic_rules', () => {
  it('registers one read-only tool', () => {
    const { server } = setup(RULES);
    expect(Object.keys(server.tools)).toEqual(['get_internal_traffic_rules']);
    expect(server.tools['get_internal_traffic_rules']!.config.annotations.readOnlyHint).toBe(true);
  });

  it('reads GET /internal-traffic and reports each rule and the 7-day counts', async () => {
    const { server, get } = setup(RULES);
    const r = await server.tools['get_internal_traffic_rules']!.handler({ projectId: P });
    expect(get).toHaveBeenCalledWith(`/projects/${P}/internal-traffic`);
    expect(r.structuredContent).toEqual({
      internalOrigins: ['https://staging.example.com'],
      allowedOrigins: RULES.allowedOrigins,
      emailDomains: ['example.com'],
      emails: ['c***@example.com'],
      browserLinkExists: true,
      counts7d: RULES.counts7d,
      recordingSince: '2026-11-05T10:00:00.000Z',
    });
    const text = r.content[0]!.text;
    expect(text).toContain('"Your team / test sites"');
    expect(text).toContain('Internal sites: https://staging.example.com.');
    expect(text).toContain('Allowed but counted normally: http://localhost:3000, https://www.example.com.');
    expect(text).toContain('Team domains: @example.com.');
    expect(text).toContain('c***@example.com');
    expect(text).toContain('Sessions marked internal, last 7 days: 21 (internal sites 12, code flag 3, team emails 0, team domains 5, browser link 1).');
    expect(text).toContain('visits before 2026-11-05 cannot be separated');
  });

  it('never returns the email hash or the browser-link token', async () => {
    const { server } = setup(RULES);
    const r = await server.tools['get_internal_traffic_rules']!.handler({ projectId: P });
    const all = JSON.stringify(r);
    expect(all).not.toContain(HASH);
    expect(all).not.toContain('tok_secret_value');
  });

  it('reads an empty project as no rules and zeros', async () => {
    const { server } = setup({ internalOrigins: [], allowedOrigins: [], emailDomains: [], emails: [], browserLink: null, counts7d: {}, recordingSince: null });
    const r = await server.tools['get_internal_traffic_rules']!.handler({ projectId: P });
    expect((r.structuredContent as any).browserLinkExists).toBe(false);
    expect((r.structuredContent as any).counts7d.total).toBe(0);
    expect(r.content[0]!.text).toContain('Internal sites: none.');
    expect(r.content[0]!.text).toContain('Browser link: not created.');
    expect(r.content[0]!.text).toContain('earlier visits cannot be separated');
  });

  it('turns an API error into guidance instead of throwing', async () => {
    const { server } = setup(new ApiError(403, 'forbidden'));
    const r = await server.tools['get_internal_traffic_rules']!.handler({ projectId: P });
    expect(r.isError).toBe(true);
  });
});
