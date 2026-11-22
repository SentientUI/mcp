import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { projectIdSchema, untrusted, withApiErrorGuidance, UNTRUSTED_FIELDS_NOTE } from './common.js';

// Tests by hand (spec 2026-11-18): the plan and one test, for outside agents.
// Mirrors GET /projects/:id/plan and GET /projects/:id/tests/:testId. The
// actions (propose, start, stop, skip, decline, keep) are manage_tests and
// manage_approvals actions, so a project's agent-access switches govern them
// like every other write.

type Version = { id: string; name: string; people: number | null; converted: number | null; left: boolean };
type Test = {
  id: string; component: { id: string; name: string }; state: string; why: string | null;
  live: Version | null; versions: Version[]; startedAt: string | null; endsAt: string | null; endedAt: string | null;
  result: string | null; winner: { id: string; name: string } | null; keptAt: string | null; declinedAt: string | null;
  proposedBy?: { kind: string; label: string | null };
};
type Reading = { daysRunning: number; ofDays: number; live: { id: string; people: number; converted: number }; versions: Array<{ id: string; people: number; converted: number; call: string }> };
type Plan = {
  nowTesting: Array<Test & { now: Reading | null }>;
  decide: Test[];
  upNext: Array<Test & { candidates: Array<{ id: string; name: string }> }>;
  learned: Test[];
  limits: { running: number; max: number };
  note: string | null;
  tooFew: number;
};

/** The status word for a version in a running test — the same words the dashboard uses. */
export const CALL_WORDS: Record<string, string> = {
  clearly_ahead: 'clearly ahead',
  clearly_behind: 'clearly behind',
  not_enough: 'not enough people yet',
  unfair_split: 'cannot be compared fairly (the split is not the 50/50 the test drew)',
  no_call: 'too early to tell',
};
const RESULT_WORDS: Record<string, string> = {
  clear_winner: 'clear winner',
  live_is_better: 'what was live was clearly better',
  no_clear_difference: 'no clear difference by the end date',
  stopped: 'stopped before it could finish',
};

const day = (r: Pick<Reading, 'daysRunning' | 'ofDays'>) => {
  const of = Math.max(1, Math.round(r.ofDays));
  return `day ${Math.min(of, Math.floor(r.daysRunning) + 1)} of ${of}`;
};
const counts = (v: { people: number | null; converted: number | null }) =>
  v.people == null ? '' : ` — ${v.people} people, ${v.converted ?? 0} reached the goal`;

/** One ended test, one line: what it found, and what was done about it. */
export function resultLine(t: Test): string {
  const found = RESULT_WORDS[t.result ?? ''] ?? 'ended';
  if (t.result !== 'clear_winner') return found;
  const who = t.winner ? untrusted(t.winner.name) : 'the winner';
  return t.keptAt ? `${found}: ${who}, kept` : t.declinedAt ? `${found}: ${who}, not kept` : `${found}: ${who}, waiting for a decision`;
}

const item = z.object({}).passthrough();

export function registerTestTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_plan',
    {
      title: 'Sentient\'s plan: tests running, proposed and learned',
      description:
        'What Sentient is testing, what it proposes to test next, and what was learned. A test compares one or two new versions of ONE ' +
        'component with what was live, on people split evenly at random while it runs — the one time Sentient stops choosing for that ' +
        'component. `nowTesting`: running tests, each with its day and, per new version, a status word (clearly ahead, clearly behind, ' +
        'not enough people yet, too early to tell, cannot be compared fairly) and the people counted; never a percentage. `decide`: tests ' +
        'that ended with a clear winner nobody has kept or turned down; their versions stay evenly split until someone decides ' +
        '(manage_approvals keep_winner, or manage_tests decline_winner). `upNext`: proposals — each a place and a reason in facts (where ' +
        'people stop on the main funnel, the page, how many visits showed the component, what was tested there before), never an expected ' +
        'gain — with `candidates`, the versions that could be tested against what is live (manage_tests start_test with body { versions: ' +
        '[one or two ids] }, or skip_test). `learned`: recent ended tests. At most `limits.max` tests run at once. `note` says why nothing ' +
        'is proposed (no_main_goal, nothing_to_test); `tooFew` counts components passed over because their pages see too few people for ' +
        'a test to finish in eight weeks. Reading the plan brings proposals up to date at most once a day.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        nowTesting: z.array(item), decide: z.array(item), upNext: z.array(item), learned: z.array(item),
        limits: z.object({ running: z.number(), max: z.number() }),
        note: z.string().nullable().describe('Why nothing is proposed: no_main_goal | nothing_to_test; null otherwise'),
        tooFew: z.number(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId }: { projectId: string }) => {
      const r = await client.get<Plan>(`/projects/${encodeURIComponent(projectId)}/plan`);
      const lines: string[] = [`Tests running: ${r.limits.running} of at most ${r.limits.max}.`];
      lines.push('', 'Now testing:');
      if (r.nowTesting.length === 0) lines.push('  nothing');
      for (const t of r.nowTesting) {
        lines.push(`  ${untrusted(t.component.name)} (test ${t.id})${t.now ? `, ${day(t.now)}` : ''}`);
        if (t.now) {
          const live = t.now.live;
          lines.push(`    what was live, ${untrusted(t.live?.name ?? live.id)}: ${live.people} people, ${live.converted} reached the goal`);
          for (const v of t.now.versions) {
            const name = t.versions.find((x) => x.id === v.id)?.name ?? v.id;
            lines.push(`    ${untrusted(name)}: ${CALL_WORDS[v.call] ?? v.call} — ${v.people} people, ${v.converted} reached the goal`);
          }
        }
      }
      if (r.decide.length > 0) {
        lines.push('', 'Waiting for a decision (the versions stay evenly split until someone decides):');
        for (const t of r.decide) lines.push(`  ${untrusted(t.component.name)} (test ${t.id}): ${resultLine(t)}`);
      }
      lines.push('', 'Up next:');
      if (r.upNext.length === 0) {
        lines.push(r.note === 'no_main_goal'
          ? '  nothing — the project has no main goal, so there is no funnel to propose from'
          : '  nothing proposed' + (r.tooFew > 0 ? ` (${r.tooFew} component${r.tooFew === 1 ? '' : 's'} passed over: too few people for a test to finish in eight weeks)` : ''));
      }
      for (const t of r.upNext) {
        lines.push(`  ${untrusted(t.component.name)} (test ${t.id}): ${untrusted(t.why ?? 'no reason given', 400)}`);
        lines.push(`    could test: ${t.candidates.length ? t.candidates.map((c) => `${untrusted(c.name)} (${untrusted(c.id)})`).join(', ') : 'no version yet — write one first'}`);
      }
      lines.push('', 'Learned:');
      if (r.learned.length === 0) lines.push('  nothing yet');
      for (const t of r.learned) lines.push(`  ${untrusted(t.component.name)}: ${resultLine(t)}`);
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: { nowTesting: r.nowTesting, decide: r.decide, upNext: r.upNext, learned: r.learned, limits: r.limits, note: r.note, tooFew: r.tooFew },
      };
    }),
  );

  server.registerTool(
    'get_test',
    {
      title: 'One test: its versions, its counts and how it ended',
      description:
        'One test by id (ids come from get_plan). While it runs: its day, and per new version the people counted, how many reached the ' +
        'goal and a status word. Once it has ended: the result (clear winner, what was live clearly better, no clear difference, stopped), ' +
        'the winner, whether it was kept or turned down, and the final counts. A test never carries a percentage: compare people, not rates ' +
        'you compute yourself — the status word is the tested answer.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema, testId: z.string().uuid().describe('The test id, from get_plan') },
      outputSchema: { test: item, now: item.nullable() },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, testId }: { projectId: string; testId: string }) => {
      const r = await client.get<{ test: Test; now?: Reading }>(`/projects/${encodeURIComponent(projectId)}/tests/${encodeURIComponent(testId)}`);
      const t = r.test;
      const lines = [`A test on ${untrusted(t.component.name)}: ${t.state}${r.now ? `, ${day(r.now)}` : ''}.`];
      if (t.why) lines.push(`Why: ${untrusted(t.why, 400)}`);
      if (t.state === 'ended') lines.push(`Result: ${resultLine(t)}.`);
      if (r.now) {
        lines.push(`What was live, ${untrusted(t.live?.name ?? r.now.live.id)}: ${r.now.live.people} people, ${r.now.live.converted} reached the goal`);
        for (const v of r.now.versions) {
          const name = t.versions.find((x) => x.id === v.id)?.name ?? v.id;
          lines.push(`${untrusted(name)}: ${CALL_WORDS[v.call] ?? v.call} — ${v.people} people, ${v.converted} reached the goal`);
        }
      } else {
        if (t.live) lines.push(`What was live: ${untrusted(t.live.name)}${counts(t.live)}`);
        for (const v of t.versions) lines.push(`${untrusted(v.name)}${counts(v)}${v.left ? ' (left the test: clearly behind)' : ''}`);
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent: { test: t, now: r.now ?? null } };
    }),
  );
}
