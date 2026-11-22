import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerMainFunnelTools } from './main-funnel.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler; config: { description?: string; annotations?: { readOnlyHint?: boolean } } }> = {};
  return {
    registerTool: vi.fn((name: string, config: never, handler: ToolHandler) => { tools[name] = { handler, config }; }),
    tools,
  };
}
const step = (reached: number, reachedControl: number, shareOfGroup: number | null, dropFromPrevious: number | null) =>
  ({ reached, reachedControl, shareOfGroup, dropFromPrevious });
const DATA = {
  mainGoal: 'sign_up',
  funnel: { source: 'main', funnelId: 'signup-journey', displayName: 'Sign-up journey', outOfDate: null },
  steps: [
    { index: 0, goalId: null, name: 'Arrived', isMainGoal: false, health: null, lastEventAt: null },
    { index: 1, goalId: 'viewed_pricing', name: 'Viewed pricing', isMainGoal: false, health: 'ok', lastEventAt: '2026-11-16T00:00:00Z' },
    { index: 2, goalId: 'sign_up', name: 'Sign up', isMainGoal: true, health: 'ok', lastEventAt: '2026-11-16T00:00:00Z' },
  ],
  new: { people: 1000, peopleControl: 100, steps: [step(1000, 100, 1, null), step(300, 28, 0.3, 0.7), step(40, 3, 0.04, 0.8667)] },
  returning: { people: 200, peopleControl: 20, steps: [step(200, 20, 1, null), step(120, 11, 0.6, 0.4), step(30, 2, 0.15, 0.75)] },
  known: { people: 150 },
  unreliable: false,
};

async function run(data: unknown, args: Record<string, unknown> = {}) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  const get = vi.spyOn(client, 'get').mockResolvedValue(data as never);
  const server = makeServer();
  registerMainFunnelTools(server as never, client);
  const result = await server.tools['get_main_funnel']!.handler({ projectId: 'p1', ...args });
  return { result, get, server };
}

describe('get_main_funnel', () => {
  it('is a read-only tool hitting the windowed main-funnel report', async () => {
    const { get, server } = await run(DATA, { range: '7d' });
    expect(get).toHaveBeenCalledWith('/projects/p1/main-funnel?range=7d');
    expect(server.tools['get_main_funnel']!.config.annotations?.readOnlyHint).toBe(true);
  });

  it('reads as a funnel: each group down the steps, known people apart', async () => {
    const text = (await run(DATA)).result.content[0].text as string;
    expect(text).toContain('Main funnel: `Sign-up journey`');
    expect(text).toContain('New (first seen in the window): 1000 people');
    expect(text).toContain('  `Viewed pricing`: 300 (30.0%), 70.0% lost from the step before');
    expect(text).toContain('  `Sign up` (main goal): 40 (4.0%), 86.7% lost from the step before');
    expect(text).toContain('Returning (seen before, not yet past the main goal): 200 people');
    expect(text).toContain('Known (already past the main goal, in no row above): 150 people');
  });

  // A step nothing sends looks exactly like a step everyone abandons.
  it('says when a step is not being sent, on the step and for the report', async () => {
    const data = { ...DATA, unreliable: true, steps: DATA.steps.map((s) => (s.index === 1 ? { ...s, health: 'never_fired' } : s)) };
    const text = (await run(data)).result.content[0].text as string;
    expect(text).toContain('`Viewed pricing`: 300 (30.0%), 70.0% lost from the step before — has never fired');
    expect(text).toContain('the rows after it understate');
  });

  it('says so when nothing is chosen, and when the chosen funnel went out of date', async () => {
    const implicit = { ...DATA, funnel: { source: 'implicit', funnelId: null, displayName: null, outOfDate: null } };
    expect((await run(implicit)).result.content[0].text).toContain('No main funnel chosen');
    const stale = { ...DATA, funnel: { source: 'implicit', funnelId: null, displayName: null, outOfDate: { funnelId: 'old', reason: 'ends_at_another_goal', endsAt: 'trial_started' } } };
    expect((await run(stale)).result.content[0].text).toContain('ends at `trial_started`, not at the main goal (`sign_up`)');
  });

  it('a project with no main goal gets a sentence, not an empty funnel', async () => {
    const { result } = await run({ mainGoal: null, funnel: null, steps: [], new: null, returning: null, known: null, unreliable: false });
    expect(result.content[0].text).toContain('no main goal');
  });

  // A drop-off mixes people who left with people still coming back.
  it('says who went no further, and how many of those have gone quiet — but not on the main goal', async () => {
    const data = {
      ...DATA,
      new: {
        people: 1000, peopleControl: 100,
        steps: [
          { ...step(1000, 100, 1, null), stoppedHere: 700, wentQuiet: 520 },
          { ...step(300, 28, 0.3, 0.7), stoppedHere: 260, wentQuiet: null },
          { ...step(40, 3, 0.04, 0.8667), stoppedHere: 40, wentQuiet: 0 },
        ],
      },
    };
    const text = (await run(data)).result.content[0].text as string;
    expect(text).toContain('  Arrived: 1000 (100.0%); 700 went no further (520 not seen for 14 days)');
    // Too short a window to tell: no claim about who left.
    expect(text).toContain('70.0% lost from the step before; 260 went no further\n');
    // Stopping at the main goal is converting.
    expect(text).toContain('  `Sign up` (main goal): 40 (4.0%), 86.7% lost from the step before\n');
  });

  // The rows are not a test of anything; the description must send an agent
  // to the lift instead of letting it compare control and personalized rows.
  it('points to the tested lift rather than inviting a comparison of rows', async () => {
    const { server } = await run(DATA);
    expect(server.tools['get_main_funnel']!.config.description).toContain('liftBeforeGate');
    expect(server.tools['get_main_funnel']!.config.description).toContain('NOT get_funnel_report');
  });
});
