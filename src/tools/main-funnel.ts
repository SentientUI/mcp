import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import {
  projectIdSchema,
  rangeInputSchema,
  rangeQuery,
  untrusted,
  windowLine,
  windowOutputSchema,
  withApiErrorGuidance,
  UNTRUSTED_FIELDS_NOTE,
  type RangeArgs,
  type WindowMeta,
} from './common.js';

type GroupStep = {
  reached: number; reachedControl: number; shareOfGroup: number | null; dropFromPrevious: number | null;
  stoppedHere?: number; wentQuiet?: number | null;
};
type Group = { people: number; peopleControl: number; steps: GroupStep[] };
type Step = { index: number; goalId: string | null; name: string | null; isMainGoal: boolean; health: string | null; lastEventAt: string | null };
type MainFunnel = {
  mainGoal: string | null;
  funnel: null | {
    source: string;
    funnelId: string | null;
    displayName: string | null;
    outOfDate: null | { funnelId: string; reason: string; endsAt: string | null };
  };
  steps: Step[];
  new: Group | null;
  returning: Group | null;
  known: { people: number } | null;
  unreliable: boolean;
  window?: WindowMeta;
};

const pct = (v: number | null) => (v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const HEALTH_NOTE: Record<string, string> = {
  quiet: ' — no event in 14 days: the rows after this one understate',
  never_fired: ' — has never fired: nothing sends it, so the rows after this one understate',
};

const groupStep = z.object({
  reached: z.number().describe('People who reached this step OR A LATER ONE'),
  reachedControl: z.number().describe('Of those, people in the control group (a plain count, no verdict)'),
  shareOfGroup: z.number().nullable().describe('reached / the group\'s people; null when the group is empty'),
  dropFromPrevious: z.number().nullable().describe('Share of the previous step\'s people who did not get here; null at Arrived'),
  stoppedHere: z.number().optional().describe('People whose furthest step is exactly this one (at the main goal: they converted)'),
  wentQuiet: z.number().nullable().optional().describe('Of stoppedHere, people not seen for 14 days by the window\'s end; null when the window is too short to tell'),
});
const group = z.object({ people: z.number(), peopleControl: z.number(), steps: z.array(groupStep) });

export function registerMainFunnelTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_main_funnel',
    {
      title: 'Main funnel: people at each step to the main goal',
      // Mirrors GET /projects/:id/main-funnel. Unlike get_funnel_report this
      // counts people over their whole history and leaves out those who had
      // already converted, so the description says how the two differ before
      // an agent adds one to the other.
      description:
        'How the project\'s funnel is doing: People (visitors who ran the page, interacted and passed the bot check), ' +
        'one per person, on the journey that ends at the project\'s main goal. Step 0 is Arrived (everyone with a ' +
        'visit); the rest are the main funnel\'s steps, the main goal last. Two groups go down it, by a person\'s ' +
        'status at the START of their time in the window: `new` (first seen in it) and `returning` (seen before, not ' +
        'yet past the main goal). People who had ALREADY reached the main goal are `known` and are in no row — they ' +
        'cannot convert again. A step counts everyone who reached it OR A LATER ONE, so a row never exceeds the one ' +
        'above it, and someone who skipped a step still counts at it. A person\'s position is the furthest step they ' +
        'have ever reached, on any visit, so progress made before the window still counts. `dropFromPrevious` is the ' +
        'share lost between two steps. `stoppedHere` is the people whose furthest step is exactly that one, and ' +
        '`wentQuiet` how many of them have not been seen for 14 days — the ones who left, as opposed to those still ' +
        'coming back (null when the window is 14 days or shorter). `reachedControl` is the part of a count in the control group — a plain count; ' +
        'the tested answer to "is SentientUI helping" is get_known_people\'s liftBeforeGate, not a comparison of these ' +
        'rows. A step whose `health` is `quiet` or `never_fired` is not being sent, so every row after it understates ' +
        '(`unreliable: true`). `funnel.source` is `implicit` when no main funnel is chosen (the journey is then just ' +
        'Arrived → main goal); `funnel.outOfDate` says a funnel is marked main but no longer ends at the main goal. ' +
        'Choose the main funnel with manage_goals set_main_funnel. This is NOT get_funnel_report, which counts one ' +
        'funnel\'s goals inside a window and includes people who had already converted. Defaults to the last 30 days; ' +
        'pass range or from/to.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema, ...rangeInputSchema('30d') },
      outputSchema: {
        mainGoal: z.string().nullable().describe('The project\'s main goal id; null = none set, so there is no funnel'),
        funnel: z.object({
          source: z.string().describe('main (a chosen funnel ending at the main goal) | implicit (Arrived → main goal)'),
          funnelId: z.string().nullable(),
          displayName: z.string().nullable(),
          outOfDate: z.object({ funnelId: z.string(), reason: z.string(), endsAt: z.string().nullable() }).nullable()
            .describe('A funnel is marked main but was not used: ends_at_another_goal | not_active'),
        }).nullable(),
        steps: z.array(z.object({
          index: z.number(),
          goalId: z.string().nullable().describe('null = Arrived'),
          name: z.string().nullable(),
          isMainGoal: z.boolean(),
          health: z.string().nullable().describe('ok | quiet (no event in 14 days) | never_fired; null for Arrived'),
          lastEventAt: z.string().nullable(),
        })),
        new: group.nullable().describe('People first seen in the window'),
        returning: group.nullable().describe('People seen before the window, not past the main goal'),
        known: z.object({ people: z.number() }).nullable().describe('People already past the main goal — in no row'),
        unreliable: z.boolean().describe('True when a step before the main goal is not being sent'),
        window: windowOutputSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, range, from, to }: { projectId: string } & RangeArgs) => {
      const id = encodeURIComponent(projectId);
      const r = await client.get<MainFunnel>(`/projects/${id}/main-funnel${rangeQuery({ range, from, to })}`);
      const lines: string[] = [];
      const win = windowLine(r.window);
      if (win) lines.push(win);
      if (!r.mainGoal || !r.funnel || !r.new || !r.returning || !r.known) {
        lines.push('This project has no main goal, so there is no funnel to report. Set a main goal first.');
      } else {
        const label = (s: Step) => (s.goalId === null ? 'Arrived' : untrusted(s.name ?? s.goalId)) + (s.isMainGoal ? ' (main goal)' : '');
        lines.push(
          r.funnel.source === 'main'
            ? `Main funnel: ${untrusted(r.funnel.displayName ?? r.funnel.funnelId ?? '')}`
            : 'No main funnel chosen: showing Arrived → main goal. Choose one with manage_goals set_main_funnel to see the steps in between.',
        );
        if (r.funnel.outOfDate) {
          lines.push(
            r.funnel.outOfDate.reason === 'not_active'
              ? `The funnel marked main (${untrusted(r.funnel.outOfDate.funnelId)}) is not active, so it was not used.`
              : `The funnel marked main (${untrusted(r.funnel.outOfDate.funnelId)}) ends at ${untrusted(r.funnel.outOfDate.endsAt ?? 'nothing')}, not at the main goal (${untrusted(r.mainGoal)}), so it was not used.`,
          );
        }
        const table = (title: string, g: Group): void => {
          lines.push('', `${title}: ${g.people} people`);
          g.steps.forEach((gs, i) => {
            const step = r.steps[i]!;
            lines.push(
              `  ${label(step)}: ${gs.reached} (${pct(gs.shareOfGroup)})` +
                (gs.dropFromPrevious != null ? `, ${pct(gs.dropFromPrevious)} lost from the step before` : '') +
                // Not on the main goal's row: stopping there is converting.
                (!step.isMainGoal && gs.stoppedHere != null && gs.stoppedHere > 0
                  ? `; ${gs.stoppedHere} went no further` +
                    (gs.wentQuiet != null ? ` (${gs.wentQuiet} not seen for 14 days)` : '')
                  : '') +
                (step.health ? (HEALTH_NOTE[step.health] ?? '') : ''),
            );
          });
        };
        table('New (first seen in the window)', r.new);
        table('Returning (seen before, not yet past the main goal)', r.returning);
        lines.push('', `Known (already past the main goal, in no row above): ${r.known.people} people`);
        if (r.unreliable) lines.push('', 'A step before the main goal is not being sent, so the rows after it understate.');
      }
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: {
          mainGoal: r.mainGoal, funnel: r.funnel, steps: r.steps, new: r.new, returning: r.returning,
          known: r.known, unreliable: r.unreliable, window: r.window,
        },
      };
    }),
  );
}
