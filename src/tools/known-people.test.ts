import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerKnownPeopleTools } from './known-people.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler; config: { description?: string; annotations?: { readOnlyHint?: boolean } } }> = {};
  return {
    registerTool: vi.fn((name: string, config: never, handler: ToolHandler) => { tools[name] = { handler, config }; }),
    tools,
  };
}

const WINDOW = {
  range: '30d', start: '2026-10-18T00:00:00.000Z', end: '2026-11-17T00:00:00.000Z',
  timezone: 'UTC', bucketUnit: 'week', retentionDays: 90, earliestAvailable: '2026-08-19',
};
const DATA = {
  mainGoal: 'sign_up',
  identifiedIsConverted: true,
  visitors: { total: 1000, new: 700, returning: 100, known: 200, identified: 230 },
  conversions: { firstTime: 40, repeats: 25, events: 65 },
  knownPeople: { total: 520, pastMainGoal: 500, bySource: { event: 60, shopify: 0, import: 400, identified: 40 } },
  window: WINDOW,
};

async function run(data: unknown, args: Record<string, unknown> = {}) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  const get = vi.spyOn(client, 'get').mockResolvedValue(data as never);
  const server = makeServer();
  registerKnownPeopleTools(server as never, client);
  const result = await server.tools['get_known_people']!.handler({ projectId: 'p 1', ...args });
  return { result, get, server };
}

describe('get_known_people', () => {
  it('is a read-only tool hitting the windowed known-people report', async () => {
    const { get, server } = await run(DATA, { range: '7d' });
    expect(get).toHaveBeenCalledWith('/projects/p%201/known-people?range=7d');
    expect(server.tools['get_known_people']!.config.annotations?.readOnlyHint).toBe(true);
  });

  // The number a per-event count hides: 40 first-time conversions among the
  // 800 who could still convert is 5.0%, not 65 events over 1,000 visitors.
  it('states the first-time rate over the people who could still convert', async () => {
    const { result } = await run(DATA);
    const text = result.content[0].text;
    expect(text).toContain('Reached the main goal for the first time: 40 of 800 who could (5.0%)');
    expect(text).toContain('repeats): 25 of 65 events');
    expect(text).toContain('Known (already past the main goal): 200 (20.0%)');
    expect(result.structuredContent).toMatchObject({ visitors: DATA.visitors, conversions: DATA.conversions, mainGoal: 'sign_up' });
  });

  it('says so when there is no main goal, instead of reporting zero known people as a finding', async () => {
    const { result } = await run({
      ...DATA, mainGoal: null,
      visitors: { total: 10, new: 10, returning: 0, known: 0, identified: 0 },
      conversions: { firstTime: 0, repeats: 0, events: 0 },
    });
    expect(result.content[0].text).toContain('no main goal');
  });

  it('divides by nothing when nobody could convert', async () => {
    const { result } = await run({
      ...DATA,
      visitors: { total: 0, new: 0, returning: 0, known: 0, identified: 0 },
      conversions: { firstTime: 0, repeats: 0, events: 0 },
    });
    expect(result.content[0].text).not.toContain('NaN');
    expect(result.content[0].text).toContain('Reached the main goal for the first time: 0\n');
  });

  // Only a significant result may state a percentage; the other three states
  // must read as "no result", or an agent reports +12% from 40 visitors.
  it('states the before-the-gate lift only when it is a result', async () => {
    const samples = { personalized: { visitors: 900, conversions: 60 }, control: { visitors: 100, conversions: 4 } };
    const say = async (lift: unknown) => (await run({ ...DATA, liftBeforeGate: lift })).result.content[0].text as string;

    expect(await say({ evidence: 'significant_positive', liftPct: 66.7, diffInterval: { lower: 0.01, upper: 0.05 }, rates: null, samples }))
      .toContain('+66.7% vs the control group, significant (900 personalized vs 100 control)');
    const flat = await say({ evidence: 'not_significant', liftPct: 12, diffInterval: null, rates: null, samples });
    expect(flat).toContain('about the same as the control group');
    expect(flat).not.toContain('12');
    expect(await say({ evidence: 'collecting', liftPct: null, diffInterval: null, rates: null, samples })).toContain('still collecting');
    expect(await say({ evidence: 'awaiting_conversions', liftPct: null, diffInterval: null, rates: null, samples })).toContain('waiting for conversions');
    expect(await say(null)).toContain('not available (no main goal)');
  });

  // An agent must not report these counts as a change in what visitors see.
  // A lift that stays "still collecting" for months reads as "you need more
  // traffic". On one project the real reason was that 39 of 1,538 people had
  // ever visited a page with an adaptive component.
  it('says why there is no answer when the comparison reaches few people, and when it is not a fair one', async () => {
    const lift = (over: object) => ({
      evidence: 'collecting', liftPct: null, diffInterval: null, rates: null,
      samples: { personalized: { visitors: 36, conversions: 0 }, control: { visitors: 3, conversions: 0 } },
      ...over,
    });
    const say = async (l: unknown) => (await run({ ...DATA, liftBeforeGate: l })).result.content[0].text as string;
    expect(await say(lift({ reach: { shown: 39, people: 1538 } }))).toContain('Only 39 of 1538 people have visited a page where an adaptive component runs.');
    expect(await say(lift({ reach: { shown: 900, people: 1538 } }))).not.toContain('have visited a page');
    expect(await say(lift({ splitCheck: { state: 'mismatch', observedShare: 0.24, expectedShare: 0.5 } }))).toContain('may not be fair');
    expect(await say(lift({ splitCheck: { state: 'ok', observedShare: 0.1, expectedShare: 0.1 } }))).not.toContain('may not be fair');
    // An API from before these fields: nothing added, nothing broken.
    expect(await say(lift({}))).not.toMatch(/may not be fair|have visited a page/);
  });

  it('says it is reporting only, in the description and in the answer', async () => {
    const { result, server } = await run(DATA);
    expect(server.tools['get_known_people']!.config.description).toContain('REPORTING ONLY');
    expect(result.content[0].text).toContain('Reporting only');
  });
});
