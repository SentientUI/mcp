import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import {
  projectIdSchema,
  rangeInputSchema,
  rangeQuery,
  windowLine,
  windowOutputSchema,
  withApiErrorGuidance,
  type RangeArgs,
  type WindowMeta,
} from './common.js';

type KnownPeople = {
  mainGoal: string | null;
  identifiedIsConverted: boolean;
  visitors: { total: number; new: number; returning: number; known: number; identified: number };
  conversions: { firstTime: number; repeats: number; events: number };
  knownPeople: { total: number; pastMainGoal: number; bySource: { event: number; shopify: number; import: number; identified: number } };
  liftBeforeGate?: LiftBeforeGate | null;
  window?: WindowMeta;
};
type LiftBeforeGate = {
  evidence: string;
  liftPct: number | null;
  diffInterval: { lower: number; upper: number } | null;
  rates: { personalized: number; control: number } | null;
  samples: { personalized: { visitors: number; conversions: number }; control: { visitors: number; conversions: number } };
  /** Absent from an API deployed before the comparison was People only. */
  splitCheck?: { state: string; observedShare: number | null; expectedShare: number | null };
  reach?: { shown: number; people: number };
};

/** What to add when the comparison itself needs a caveat, or explains its own silence. */
function liftCaveats(l: LiftBeforeGate): string {
  const out: string[] = [];
  if (l.splitCheck?.state === 'mismatch') {
    out.push('The control group among the people compared is not the expected size, so this comparison may not be fair — do not quote it as a result.');
  }
  if (l.reach && l.reach.people > 0 && l.reach.shown < l.reach.people * 0.25) {
    out.push(`Only ${l.reach.shown} of ${l.reach.people} people have visited a page where an adaptive component runs.`);
  }
  return out.length ? ` ${out.join(' ')}` : '';
}

/** One sentence per state — only the two "significant" ones state a number. */
function liftLine(l: LiftBeforeGate | null | undefined): string {
  if (!l) return 'Lift among people who could still convert: not available (no main goal).';
  const n = `${l.samples.personalized.visitors} personalized vs ${l.samples.control.visitors} control`;
  switch (l.evidence) {
    case 'collecting':
      return `Lift among people who could still convert: still collecting (${n}) — not a result yet.`;
    case 'awaiting_conversions':
      return `Lift among people who could still convert: waiting for conversions in the control group (${n}) — not a result yet.`;
    case 'significant_positive':
    case 'significant_negative':
      return `Lift among people who could still convert: ${l.liftPct !== null && l.liftPct > 0 ? '+' : ''}${l.liftPct?.toFixed(1)}% vs the control group, significant (${n}).`;
    default:
      return `Lift among people who could still convert: about the same as the control group — no significant difference (${n}).`;
  }
}

const share = (n: number, of: number) => (of > 0 ? ` (${((n / of) * 100).toFixed(1)}%)` : '');

export function registerKnownPeopleTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_known_people',
    {
      title: 'Known people: new, returning, already converted',
      // Mirrors GET /projects/:id/known-people. "Known" is a second word next
      // to "People" (the bot-check population), so the description says how
      // they relate before an agent reports one as the other.
      description:
        'How many visitors the project already knows. Counts People (visitors who ran the page, interacted and passed ' +
        'the bot check) active in the window, one per person (an identified user\'s browsers are one person), each in ' +
        'exactly one group by their status at the START of their time in the window: `known` = already past the ' +
        'project\'s main goal (signed up, bought) before the window; `new` = first seen in it; `returning` = seen ' +
        'before and not past the main goal. Someone who converts inside the window is still new or returning for that ' +
        'window. `conversions.firstTime` is people who reached the main goal for the first time; `repeats` is ' +
        'main-goal events from someone already past it (a second order, a sign-up goal firing again on login) — the ' +
        'amount a per-event conversion count overstates. So the honest conversion rate before the main goal is ' +
        'firstTime / (new + returning), not events / total. `knownPeople` is the stored list itself and how each ' +
        'person was learnt: a recorded conversion, the Shopify customer list, an import of your own user ids, or ' +
        'being identified when the main goal is sign-up. `liftBeforeGate` is the control-group lift on the main goal ' +
        'among people who had NOT already reached it when they were first exposed — people already past it are left ' +
        'out of both groups, by a status fixed before exposure. It counts People only, one per person (`samples.*.visitors`); ' +
        '`splitCheck` tests the split among exactly those people (`mismatch` = not a fair comparison) and `reach` is how ' +
        'many people are in it out of all people seen. It is all-time (the window does not apply) and its ' +
        '`evidence` is collecting, awaiting_conversions, not_significant, significant_positive or significant_negative: ' +
        'only the two "significant" values are a result. A person is recognised across devices only where the site ' +
        'identifies them; an anonymous visitor on a new browser counts as new. Recording began when this feature ' +
        'shipped, so earlier conversions show only after the project\'s backfill. REPORTING ONLY: nothing is served ' +
        'or learned differently for known people yet. Defaults to the last 30 days; pass range or from/to.',
      inputSchema: { projectId: projectIdSchema, ...rangeInputSchema('30d') },
      outputSchema: {
        mainGoal: z.string().nullable().describe('The project\'s main goal id; null = none set, so nobody can be known'),
        identifiedIsConverted: z.boolean().describe('True when the project said reaching its main goal creates the account, so an identified visitor counts as past it'),
        visitors: z.object({
          total: z.number().describe('People active in the window, one per person'),
          new: z.number().describe('First seen in the window'),
          returning: z.number().describe('Seen before the window, not past the main goal'),
          known: z.number().describe('Already past the main goal before the window'),
          identified: z.number().describe('Of total: people the site identified with its own user id'),
        }),
        conversions: z.object({
          firstTime: z.number().describe('People who reached the main goal for the first time in the window'),
          repeats: z.number().describe('Main-goal events from someone already past it'),
          events: z.number().describe('Every main-goal event in the window, as a per-event count reports it'),
        }),
        knownPeople: z.object({
          total: z.number().describe('People on the stored list (imported or recorded), all time'),
          pastMainGoal: z.number().describe('Of those, people past the current main goal'),
          bySource: z.object({ event: z.number(), shopify: z.number(), import: z.number(), identified: z.number() })
            .describe('How each person past the main goal was learnt'),
        }),
        liftBeforeGate: z.object({
          evidence: z.string().describe('collecting | awaiting_conversions | not_significant | significant_positive | significant_negative'),
          liftPct: z.number().nullable().describe('Relative lift %, null while collecting or awaiting conversions'),
          diffInterval: z.object({ lower: z.number(), upper: z.number() }).nullable().describe('Always-valid range on the absolute rate difference (fractions)'),
          rates: z.object({ personalized: z.number(), control: z.number() }).nullable(),
          samples: z.object({
            personalized: z.object({ visitors: z.number(), conversions: z.number() }),
            control: z.object({ visitors: z.number(), conversions: z.number() }),
          }).describe('People, one per person, on each side'),
          splitCheck: z.object({
            state: z.string().describe('ok | mismatch | insufficient_data | not_applicable'),
            observedShare: z.number().nullable(),
            expectedShare: z.number().nullable(),
          }).optional().describe('Whether the control group among the people compared is the expected size'),
          reach: z.object({ shown: z.number(), people: z.number() }).optional()
            .describe('People in the comparison, out of all people seen (all-time)'),
        }).nullable().optional().describe('Main-goal lift among people not already past it at first exposure; all-time; null with no main goal'),
        window: windowOutputSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, range, from, to }: { projectId: string } & RangeArgs) => {
      const id = encodeURIComponent(projectId);
      const r = await client.get<KnownPeople>(`/projects/${id}/known-people${rangeQuery({ range, from, to })}`);
      const v = r.visitors;
      const couldConvert = v.new + v.returning;
      const lines: string[] = [];
      const win = windowLine(r.window);
      if (win) lines.push(win);
      if (!r.mainGoal) {
        lines.push('This project has no main goal, so nobody can be counted as already past it. Set a main goal first.');
      }
      lines.push(
        `People in the window: ${v.total}`,
        `  New (first seen in the window): ${v.new}${share(v.new, v.total)}`,
        `  Returning (seen before, not past the main goal): ${v.returning}${share(v.returning, v.total)}`,
        `  Known (already past the main goal): ${v.known}${share(v.known, v.total)}`,
        `  Identified by the site: ${v.identified}`,
        '',
        `Reached the main goal for the first time: ${r.conversions.firstTime}` +
          (couldConvert > 0 ? ` of ${couldConvert} who could (${((r.conversions.firstTime / couldConvert) * 100).toFixed(1)}%)` : ''),
        `Main-goal events from someone already past it (repeats): ${r.conversions.repeats} of ${r.conversions.events} events`,
        '',
        `Known-people list: ${r.knownPeople.total} (${r.knownPeople.pastMainGoal} past the main goal — ` +
          `recorded conversion ${r.knownPeople.bySource.event}, Shopify customers ${r.knownPeople.bySource.shopify}, ` +
          `imported ids ${r.knownPeople.bySource.import}, identified ${r.knownPeople.bySource.identified})`,
        '',
        liftLine(r.liftBeforeGate) + (r.liftBeforeGate ? liftCaveats(r.liftBeforeGate) : ''),
        '',
        'Reporting only: known people are not yet served or learned from differently.',
      );
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: {
          mainGoal: r.mainGoal,
          identifiedIsConverted: r.identifiedIsConverted,
          visitors: r.visitors,
          conversions: r.conversions,
          knownPeople: r.knownPeople,
          liftBeforeGate: r.liftBeforeGate ?? null,
          window: r.window,
        },
      };
    }),
  );
}
