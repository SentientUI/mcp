import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerPageGroupTools } from './page-groups.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler; config: { description?: string; annotations?: { readOnlyHint?: boolean } } }> = {};
  return {
    registerTool: vi.fn((name: string, config: never, handler: ToolHandler) => { tools[name] = { handler, config }; }),
    tools,
  };
}
const group = (over: Record<string, unknown>) => ({
  id: 'home', name: 'Home', patterns: ['/'], placement: 'arrived', stepGoalId: null, placementValid: true,
  viewers: 0, knownViewers: 0, components: [], layoutVisits: 0, layoutOrders: 0, ...over,
});
const DATA = {
  saved: true,
  groups: [
    group({ viewers: 900, knownViewers: 60, components: [{ componentId: 'hero', sessions: 850, shareOfComponent: 0.98 }], layoutVisits: 700, layoutOrders: 3 }),
    group({ id: 'pricing', name: 'Pricing', patterns: ['/pricing', '/pricing/*'], placement: 'step', stepGoalId: 'viewed_pricing', viewers: 300 }),
    group({ id: 'old', name: 'Old page', patterns: ['/old'], placement: 'step', stepGoalId: 'dropped_step', placementValid: false }),
    group({ id: null, name: 'Other pages', patterns: [], placement: 'unplaced', viewers: 40 }),
  ],
  siteWide: [{ componentId: 'header', sessions: 1200, groups: 4 }],
  funnelSteps: [{ goalId: 'viewed_pricing', name: 'Viewed pricing' }, { goalId: 'sign_up', name: 'Sign up' }],
  pathCoverage: 0.97,
};

async function run(data: unknown, args: Record<string, unknown> = {}) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  const get = vi.spyOn(client, 'get').mockResolvedValue(data as never);
  const server = makeServer();
  registerPageGroupTools(server as never, client);
  const result = await server.tools['get_page_groups']!.handler({ projectId: 'p1', ...args });
  return { result, get, server };
}

describe('get_page_groups', () => {
  it('is a read-only tool hitting the windowed page-groups report', async () => {
    const { get, server } = await run(DATA, { range: '7d' });
    expect(get).toHaveBeenCalledWith('/projects/p1/page-groups?range=7d');
    expect(server.tools['get_page_groups']!.config.annotations?.readOnlyHint).toBe(true);
  });

  it('reads as pages: where each group sits, who saw it, what runs there', async () => {
    const text = (await run(DATA)).result.content[0].text as string;
    expect(text).toContain('`Home` — `/` — where people arrive');
    expect(text).toContain('  900 people viewed it (60 already past the main goal)');
    expect(text).toContain('  Components here: `hero` (850 visits)');
    expect(text).toContain('  Page layout served on 700 visits, in 3 different orders');
    expect(text).toContain('`Pricing` — `/pricing`, `/pricing/*` — at the step `Viewed pricing`');
    expect(text).toContain('Other pages (in no group)');
    expect(text).toContain('Site-wide components (shown across several groups): `header` (1200 visits, 4 groups)');
  });

  // A placement the funnel no longer has must not read as a real step.
  it('says when a group is placed at a step the main funnel no longer has', async () => {
    const text = (await run(DATA)).result.content[0].text as string;
    expect(text).toContain('placed at `dropped_step`, which is no longer a step of the main funnel');
  });

  it('says a suggestion is a suggestion, and when the counts understate', async () => {
    const text = (await run({ ...DATA, saved: false, pathCoverage: 0.4 })).result.content[0].text as string;
    expect(text).toContain('No page groups are saved yet. This is a suggestion');
    expect(text).toContain('Only 40% of page views carry a page');
  });

  // A group's place organises the view; it is not where a person is.
  it('sends an agent to the main funnel for where people are', async () => {
    const { server } = await run(DATA);
    expect(server.tools['get_page_groups']!.config.description).toContain('get_main_funnel does');
  });
});
