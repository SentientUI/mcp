import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerNeedsYouTools } from './needs-you.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler; config: { annotations?: { readOnlyHint?: boolean } } }> = {};
  return { registerTool: vi.fn((name: string, config: never, handler: ToolHandler) => { tools[name] = { handler, config }; }), tools };
}
const card = (over: Record<string, unknown>) => ({ id: 'c1', kind: 'versions', subject: { kind: 'component', key: 'cta' }, title: '2 new versions of Pricing button', state: 'needs_you', steps: ['Written', 'Checked', 'Waiting for you', 'Live'], step: 2, outcome: null, detail: {}, ...over });

async function run(open: unknown[], done: unknown[]) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  const get = vi.spyOn(client, 'get').mockImplementation(async (path: string) => ({ cards: path.includes('state=done') ? done : open }) as never);
  const server = makeServer();
  registerNeedsYouTools(server as never, client);
  const result = await server.tools.get_needs_you!.handler({ projectId: 'p1' });
  return { result, get, server, text: result.content[0].text as string };
}

describe('get_needs_you', () => {
  it('is read-only and reads the open cards and the last ones that ended', async () => {
    const { get, server } = await run([], []);
    expect(get).toHaveBeenCalledWith('/projects/p1/cards?state=needs_you,failed,waiting,working');
    expect(get).toHaveBeenCalledWith('/projects/p1/cards?state=done&limit=5&kind=versions,pull_request,site_check,test');
    expect(server.tools.get_needs_you!.config.annotations?.readOnlyHint).toBe(true);
  });

  it('sorts the work the way Needs you does, and says how a pull request is getting on', async () => {
    const { text, result } = await run([
      card({ detail: { versions: [{ state: 'waiting' }, { state: 'waiting' }] } }),
      card({ id: 'c2', kind: 'pull_request', title: 'Adds a hero headline test to your site’s code', state: 'waiting', steps: ['Sent', 'Checks passed', 'Approved by a developer', 'Live'], step: 1, detail: { prUrl: 'https://github.com/acme/web/pull/7', checks: 'passed', review: 'pending' } }),
      card({ id: 'c3', kind: 'test', title: 'A test on Pricing button', state: 'working', steps: ['Proposed', 'Running', 'Result', 'Kept'], step: 1, detail: { testId: 't1' } }),
    ], [card({ id: 'c4', state: 'done', step: 3, outcome: 'Live for 2 audiences.', undo: { possible: true, reason: null } })]);
    expect(text).toContain('Needs you:\n  `2 new versions of Pricing button` (versions, card c1) — Waiting for you; 2 waiting for approval');
    expect(text).toContain('With your developers:\n  `Adds a hero headline test to your site’s code` (pull_request, card c2) — Checks passed; pull request https://github.com/acme/web/pull/7, checks passed, review pending');
    expect(text).toContain('In motion:\n  `A test on Pricing button` (test, card c3) — Running; test t1');
    expect(text).toContain('Can still be undone in the dashboard.');
    expect((result.structuredContent as { needsYou: unknown[] }).needsYou).toHaveLength(1);
  });

  it('says nothing is waiting rather than printing an empty list', async () => {
    expect((await run([], [])).text).toContain('Needs you:\n  nothing');
  });
});
