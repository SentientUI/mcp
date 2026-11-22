import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerTestTools } from './tests.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler; config: { annotations?: { readOnlyHint?: boolean } } }> = {};
  return { registerTool: vi.fn((name: string, config: never, handler: ToolHandler) => { tools[name] = { handler, config }; }), tools };
}
const base = { why: null, live: null, versions: [], startedAt: null, endsAt: null, endedAt: null, result: null, winner: null, keptAt: null, declinedAt: null };
const PLAN = {
  nowTesting: [{
    ...base, id: 't-run', component: { id: 'cta', name: 'Pricing button' }, state: 'running',
    live: { id: 'baseline', name: 'Your original', people: null, converted: null, left: false },
    versions: [{ id: 'short', name: 'Shorter', people: null, converted: null, left: false }],
    now: { daysRunning: 5.5, ofDays: 21, live: { id: 'baseline', people: 1204, converted: 96 }, versions: [{ id: 'short', people: 1190, converted: 110, call: 'no_call' }] },
  }],
  decide: [{ ...base, id: 't-win', component: { id: 'form', name: 'Sign-up form' }, state: 'ended', result: 'clear_winner', winner: { id: 'short', name: 'Shorter form' } }],
  upNext: [{ ...base, id: 't-next', component: { id: 'plan-table', name: 'Plan table' }, state: 'proposed', why: 'Of 5,100 people who got to Pricing, 3,800 went no further.', candidates: [{ id: 'bold', name: 'Bolder' }] }],
  learned: [{ ...base, id: 't-old', component: { id: 'nav', name: 'Top menu' }, state: 'ended', result: 'no_clear_difference' }],
  limits: { running: 1, max: 3 }, note: null, tooFew: 0,
};

async function run(tool: string, data: unknown, args: Record<string, unknown> = {}) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  const get = vi.spyOn(client, 'get').mockResolvedValue(data as never);
  const server = makeServer();
  registerTestTools(server as never, client);
  const result = await server.tools[tool]!.handler({ projectId: 'p1', ...args });
  return { result, get, server, text: result.content[0].text as string };
}

describe('get_plan', () => {
  it('is read-only and reads the plan', async () => {
    const { get, server } = await run('get_plan', PLAN);
    expect(get).toHaveBeenCalledWith('/projects/p1/plan');
    expect(server.tools.get_plan!.config.annotations?.readOnlyHint).toBe(true);
  });

  it('reads as the loop: running with its day and status words, waiting, proposed with what could be tested, learned', async () => {
    const { text } = await run('get_plan', PLAN);
    expect(text).toContain('Tests running: 1 of at most 3.');
    expect(text).toContain('`Pricing button` (test t-run), day 6 of 21');
    expect(text).toContain('`Shorter`: too early to tell — 1190 people, 110 reached the goal');
    expect(text).toContain('`Sign-up form` (test t-win): clear winner: `Shorter form`, waiting for a decision');
    expect(text).toContain('`Plan table` (test t-next): `Of 5,100 people who got to Pricing, 3,800 went no further.`');
    expect(text).toContain('could test: `Bolder` (`bold`)');
    expect(text).toContain('`Top menu`: no clear difference by the end date');
  });

  // An agent multiplies whatever it is given into a "lift". A rate here would be the first thing it quoted.
  it('never prints a percentage', async () => {
    expect((await run('get_plan', PLAN)).text).not.toMatch(/%/);
  });

  it('says why nothing is proposed', async () => {
    expect((await run('get_plan', { ...PLAN, upNext: [], note: 'no_main_goal' })).text).toContain('the project has no main goal');
    expect((await run('get_plan', { ...PLAN, upNext: [], note: 'nothing_to_test', tooFew: 2 })).text)
      .toContain('2 components passed over: too few people for a test to finish in eight weeks');
  });
});

describe('get_test', () => {
  it('reads one test: running with its counts, or ended with its result', async () => {
    const running = await run('get_test', { test: PLAN.nowTesting[0], now: PLAN.nowTesting[0]!.now }, { testId: '00000000-0000-4000-8000-000000000000' });
    expect(running.get).toHaveBeenCalledWith('/projects/p1/tests/00000000-0000-4000-8000-000000000000');
    expect(running.text).toContain('A test on `Pricing button`: running, day 6 of 21.');
    expect(running.text).toContain('What was live, `Your original`: 1204 people, 96 reached the goal');

    const ended = await run('get_test', { test: { ...PLAN.decide[0], keptAt: '2026-11-19T10:00:00Z', live: { id: 'baseline', name: 'Your original', people: 900, converted: 40, left: false }, versions: [{ id: 'short', name: 'Shorter form', people: 910, converted: 70, left: false }] } }, { testId: 'x' });
    expect(ended.text).toContain('Result: clear winner: `Shorter form`, kept.');
    expect(ended.text).toContain('`Shorter form` — 910 people, 70 reached the goal');
    expect(ended.text).not.toMatch(/%/);
  });
});
