import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerPageElementTools } from './page-elements.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler; config: { description?: string; annotations?: { readOnlyHint?: boolean } } }> = {};
  return { registerTool: vi.fn((name: string, config: never, handler: ToolHandler) => { tools[name] = { handler, config }; }), tools };
}
async function run(data: unknown, args: Record<string, unknown> = {}) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  const get = vi.spyOn(client, 'get').mockResolvedValue(data as never);
  const server = makeServer();
  registerPageElementTools(server as never, client);
  const result = await server.tools.get_page_elements!.handler({ projectId: 'p1', ...args });
  return { result, get, server, text: result.content[0].text as string };
}
const AUDIT = {
  status: 'ok', auditedAt: '2026-11-17T09:00:00Z', checking: false,
  report: { targets: [
    { id: 'hero-cta', kind: 'button', label: 'Start free', text: 'Start free', pageUrl: 'https://acme.test/', confidence: 'high', locator: { css: '#hero > a' } },
    { id: 'plan-table', kind: 'section', label: 'Plans', pageUrl: 'https://acme.test/pricing/', confidence: 'medium', locator: { css: '.plans' } },
  ] },
};

describe('get_page_elements', () => {
  it('is read-only and reads the site check', async () => {
    const { get, server } = await run(AUDIT);
    expect(get).toHaveBeenCalledWith('/projects/p1/site-audit');
    expect(server.tools.get_page_elements!.config.annotations?.readOnlyHint).toBe(true);
    // The description carries everything open_pr needs.
    expect(server.tools.get_page_elements!.config.description).toContain('targetId');
    expect(server.tools.get_page_elements!.config.description).toContain('arms: [{ displayName, ops }]');
  });

  it('lists each element by id, kind, label and page — never its selector', async () => {
    const { result, text } = await run(AUDIT);
    expect(text).toContain('2 elements, from the check on 2026-11-17.');
    expect(text).toContain('`hero-cta` — button: `Start free` · on `/`');
    expect(text).toContain('`plan-table` — section: `Plans` · on `/pricing`');
    expect(JSON.stringify(result)).not.toContain('#hero > a');
    expect(JSON.stringify(result)).not.toContain('locator');
  });

  it('keeps one page when asked, whatever the address looks like', async () => {
    const ids = async (pageUrl: string) => ((await run(AUDIT, { pageUrl })).result.structuredContent as { elements: Array<{ id: string }> }).elements.map((e) => e.id);
    expect(await ids('/pricing')).toEqual(['plan-table']);
    expect(await ids('https://acme.test/pricing')).toEqual(['plan-table']);
  });

  it('says what to do when there is no check yet, or it failed', async () => {
    expect((await run({ status: 'pending', checking: false })).text).toContain('manage_settings rescan_site');
    expect((await run({ status: 'pending', checking: true })).text).toContain('being checked now');
    expect((await run({ status: 'error', error: 'timeout' })).text).toContain('The last site check failed');
  });
});
