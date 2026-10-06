import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { uiMeta } from '../ui/index.js';
import {
  projectIdSchema,
  rangeInputSchema,
  rangeQuery,
  windowOutputSchema,
  windowLine,
  withApiErrorGuidance,
  untrusted,
  UNTRUSTED_FIELDS_NOTE,
  type RangeArgs,
} from './common.js';
import { MIN_EVIDENCE_SAMPLE, isLowSample, rateWithN } from './evidence.js';

export function registerGoalTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_goal_funnel',
    {
      // Named get_goal_funnel for compatibility (renaming a published tool
      // breaks every saved prompt and host allow-list), but it is NOT a funnel:
      // agents asked it for step drop-off and reported per-goal rates as funnel
      // stages. The title and the first words of the description now say what
      // it is, and point to the real funnel tool.
      title: 'Goal conversions (per goal — not a step funnel)',
      description:
        'Per-goal conversion summary — NOT a step funnel (for step-by-step drop-off use list_funnels + get_funnel_report). ' +
        'Gets goal hit counts and unique-session conversion rates for a window ' +
        '(default: last 30 calendar days), plus a per-variant breakdown. NOTE: the per-variant ' +
        'completionRate values are ALL-TIME (bounded only by plan retention), NOT windowed — a ' +
        'variant completion rate needs the full assignment history as its denominator, so it does ' +
        'not change when you narrow `range`, and retired components keep appearing in it. Only ' +
        'hits/uniqueSessions/conversionRate/revenue respect the window. Per-variant rates are descriptive, ' +
        'not joined to the evidence verdicts — for whether an arm is ahead, use get_variant_performance.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema, ...rangeInputSchema('30d') },
      _meta: uiMeta('goal-funnel'),
      outputSchema: {
        currency: z.string().describe('Project display currency (ISO-4217) for the revenue fields'),
        goals: z
          .array(
            z.object({
              goalName: z.string(),
              hits: z.number(),
              uniqueSessions: z.number(),
              conversionRate: z.number().describe('Unique-session conversion rate (0-1)'),
              revenue: z.number().nullable().describe('Total revenue from valued conversions, in the project currency (null for valueless goals)'),
              avgOrderValue: z.number().nullable().describe('Average value per valued conversion (null for valueless goals)'),
              revenuePerSession: z.number().nullable().describe('Revenue divided by all project sessions (null for valueless goals)'),
              variants: z
                .array(
                  z.object({
                    componentId: z.string(),
                    variantId: z.string(),
                    completionRate: z
                      .number()
                      .describe(
                        'ALL-TIME completion rate per assigned session (0-1). Not windowed: ' +
                          'unaffected by `range`/`from`/`to`, and bounded only by plan retention.',
                      ),
                    sessionsWithGoal: z.number().nullable().describe('Numerator of completionRate (null if the API did not send it)'),
                    sessionsWithAssignment: z.number().nullable().describe('n of completionRate: assigned sessions (null if the API did not send it)'),
                    lowSample: z.boolean().describe(`True under ${MIN_EVIDENCE_SAMPLE} assigned sessions, or when n is unknown — not interpretable on its own`),
                  }),
                )
                .describe(
                  'Per-variant breakdown. ALL-TIME, not windowed — do not compare these against ' +
                    'the windowed hits/conversionRate above, and expect retired components here.',
                ),
            }),
          )
          .describe('Configured goals (empty if none)'),
        window: windowOutputSchema,
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async ({ projectId, range, from, to }: { projectId: string } & RangeArgs) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        currency?: string;
        goals: Array<{
          goalName: string;
          hits: number;
          uniqueSessions: number;
          pct: number;
          revenue?: number | null;
          avgOrderValue?: number | null;
          revenuePerSession?: number | null;
          variants: Array<{
            componentId: string;
            variantId: string;
            completionRate: number;
            sessionsWithGoal?: number;
            sessionsWithAssignment?: number;
          }>;
        }>;
        window?: NonNullable<z.infer<typeof windowOutputSchema>>;
      }>(`/projects/${id}/goals${rangeQuery({ range, from, to })}`);

      // ?? null tolerance: an API deployed before revenue goals sends none of
      // these fields, and the tool must keep working against it.
      const structuredContent = {
        window: data.window,
        currency: data.currency ?? 'USD',
        goals: data.goals.map((g) => ({
          goalName: g.goalName,
          hits: g.hits,
          uniqueSessions: g.uniqueSessions,
          conversionRate: g.pct,
          revenue: g.revenue ?? null,
          avgOrderValue: g.avgOrderValue ?? null,
          revenuePerSession: g.revenuePerSession ?? null,
          variants: g.variants.map((v) => ({
            componentId: v.componentId,
            variantId: v.variantId,
            completionRate: v.completionRate,
            sessionsWithGoal: v.sessionsWithGoal ?? null,
            sessionsWithAssignment: v.sessionsWithAssignment ?? null,
            lowSample: typeof v.sessionsWithAssignment === 'number' ? isLowSample(v.sessionsWithAssignment) : true,
          })),
        })),
      };

      if (!data.goals.length) {
        return {
          content: [{ type: 'text' as const, text: 'No goals configured for this project.' }],
          structuredContent,
          _meta: uiMeta('goal-funnel'),
        };
      }

      const currency = data.currency ?? 'USD';
      const win = windowLine(data.window);
      // Goal/component/variant names are visitor-mintable via the public pk_
      // key (any 128-char string), and goalName used to render raw at line
      // start — a goal named "signup\n<fake instructions>" read exactly like
      // tool output. Delimit every one of them (see untrusted()).
      const lines = data.goals.flatMap((g) => [
        `${untrusted(g.goalName)}: ${g.hits} hits, ${g.uniqueSessions} unique sessions, ${(g.pct * 100).toFixed(1)}% conversion` +
          (g.revenue != null
            ? `, ${g.revenue.toFixed(2)} ${currency} revenue (${(g.avgOrderValue ?? 0).toFixed(2)} avg order)`
            : ''),
        // The per-variant rates come from an all-time query (analytics.ts
        // query 2, deliberately unwindowed so the denominator is the full
        // assignment history). The dashboard labels them; this text had not,
        // so a narrowed `range` returned identical variant rates next to a
        // windowed headline and read as a windowed comparison.
        //
        // Each rate carries its n (the API sends both counts): "100.0%" on one
        // assigned session printed exactly like 100% on a thousand. These are
        // descriptive per-arm rates — no evidence verdict applies to them here,
        // so the text never orders or ranks them.
        ...g.variants.map((v) =>
          typeof v.sessionsWithAssignment === 'number' && typeof v.sessionsWithGoal === 'number'
            ? `  ${untrusted(v.componentId)}/${untrusted(v.variantId)}: ${rateWithN(v.sessionsWithGoal, v.sessionsWithAssignment, 'assigned sessions')} (all-time)`
            : `  ${untrusted(v.componentId)}/${untrusted(v.variantId)}: ${(v.completionRate * 100).toFixed(1)}% per assigned session (all-time; sample size not reported — treat as uninterpretable)`,
        ),
        '',
      ]);

      const hasVariants = data.goals.some((g) => g.variants.length > 0);
      const caveat = hasVariants
        ? ['', 'Note: goal hits/conversion respect the window above; per-variant rates marked (all-time) do not. ' +
            'Per-variant rates are descriptive — for whether one arm is actually ahead, use get_variant_performance (server evidence verdicts).']
        : [];
      const text = (win ? [win, '', ...lines, ...caveat] : [...lines, ...caveat]).join('\n').trim();
      return { content: [{ type: 'text' as const, text }], structuredContent, _meta: uiMeta('goal-funnel') };
    }),
  );

  server.registerTool(
    'list_goals',
    {
      title: 'List goal definitions',
      description:
        'List the project\'s defined goals — including ones with no conversions yet, which get_goal_funnel cannot see. Returns each goal\'s stable id, display name, role (primary/secondary/guardrail), event type, and status. Reference a goalId verbatim from code: client.goal(\'<goalId>\') or <Adaptive goal="<goalId>">.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        goals: z
          .array(
            z.object({
              goalId: z.string().describe('Stable id — use this exact string when firing the goal from code'),
              displayName: z.string(),
              role: z.string().describe('primary | secondary | guardrail'),
              event: z.string().describe('click | form_submit | url_reached'),
              urlPattern: z.string().nullable().describe('Only for url_reached goals'),
              status: z.string().describe('active | archived'),
              defaultValue: z.number().nullable().describe('Fixed worth applied when a conversion carries no explicit value (project currency); null when unset'),
            }),
          )
          .describe('Defined goals (empty if none)'),
        warnings: z.array(z.object({
          goalName: z.string().describe('The suspicious (probably typo) goal name'),
          suggestion: z.string().describe('The existing goal it likely meant'),
        })).describe('Recent goal names that look like typos of existing goals — verify before firing a new name'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        goals: Array<{
          goal_id: string;
          display_name: string;
          role: string;
          event: string;
          url_pattern: string | null;
          status: string;
          default_value?: string | null;
        }>;
      }>(`/projects/${id}/goal-definitions`);

      // Typo warnings (spec item 1). Tolerate an API deployed before the
      // warnings endpoint — the tool must keep working against it.
      let warnings: Array<{ goalName: string; suggestion: string }> = [];
      try {
        const w = await client.get<{ warnings: Array<{ goalName: string; suggestion: string }> }>(
          `/projects/${id}/goal-warnings`,
        );
        warnings = (w.warnings ?? []).map((x) => ({ goalName: x.goalName, suggestion: x.suggestion }));
      } catch { /* older API */ }

      const structuredContent = {
        goals: data.goals.map((g) => ({
          goalId: g.goal_id,
          displayName: g.display_name,
          role: g.role,
          event: g.event,
          urlPattern: g.url_pattern ?? null,
          status: g.status,
          // NUMERIC arrives serialized as a string; coerce and tolerate its
          // absence from an older API deploy.
          defaultValue: g.default_value != null ? Number(g.default_value) : null,
        })),
        warnings,
      };

      if (!structuredContent.goals.length) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No goal definitions yet. Define one in the dashboard (Goals page or onboarding chat), or fire client.goal(\'<name>\') from code and it will appear in get_goal_funnel once it converts.',
          }],
          structuredContent,
        };
      }

      // goalId/displayName come from operator-defined rows, but the typo
      // warnings quote goal names FIRED BY VISITORS — the exact injection
      // vector (any pk_ holder mints a "goal" whose name is instructions).
      // Delimit all of them; quotes alone don't stop a newline breakout.
      const lines = structuredContent.goals.map(
        (g) => `${untrusted(g.goalId)} (${g.role}, ${g.event}${g.status === 'archived' ? ', archived' : ''}) — ${untrusted(g.displayName)}`,
      );
      for (const w of warnings) {
        lines.push(`⚠ ${untrusted(w.goalName)} looks like a typo of ${untrusted(w.suggestion)} — check before using it.`);
      }
      lines.push('', 'Reference a goalId verbatim from code: client.goal(\'<goalId>\') or <Adaptive goal="<goalId>">.');
      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
    }),
  );

  // Audit M13. The mgmt PUT that the dashboard uses is an overwriting upsert
  // that can also re-point the project's primary goal — the reward every
  // experiment optimizes — so it was never exposed here. This calls the
  // create-only POST instead: an existing id (even archived) is refused with
  // 409, and the server never assigns or demotes a primary. An API that
  // predates the POST answers 404 rather than falling back to the upsert.
  server.registerTool(
    'define_goal',
    {
      title: 'Define a new goal',
      description:
        'Create a NEW goal (conversion signal) for a project. Create-only: it never changes an existing goal — an id ' +
        'that already exists, including an archived one, is refused (goal_exists); call list_goals first. It never sets ' +
        "or changes the PRIMARY goal (what experiments optimize): the goal is created as 'secondary' (default) or " +
        "'guardrail'; choosing the primary stays a dashboard decision. A guardrail goal can pause variants that hurt it — " +
        'say so when proposing one. Event types: url_reached (needs urlPattern, e.g. /thank-you), click / form_submit ' +
        '(need a locator, usually easier to pick in the dashboard on-site editor, or fire from code with ' +
        "client.goal('<goalId>') instead), scroll_depth (needs threshold in (0, 1]). Needs an editor/admin login or the " +
        "project's sk_ server key. Confirm the goal id, event and pattern with the user before calling.",
      inputSchema: {
        projectId: projectIdSchema,
        goalId: z
          .string()
          .min(1)
          .max(128)
          .refine((s) => !s.startsWith('funnel:'), "'funnel:' is reserved for funnel bindings")
          .describe("Stable id code will reference, e.g. 'signup' or 'checkout-complete'. Must not exist yet."),
        event: z.enum(['url_reached', 'click', 'form_submit', 'scroll_depth']).describe('What counts as a conversion'),
        urlPattern: z.string().min(1).max(512).optional().describe("url_reached only: the path pattern, e.g. '/thank-you' or '/orders/*'"),
        locator: z.record(z.unknown()).optional().describe('click / form_submit only: the element locator (e.g. { "id": "signup-button" })'),
        threshold: z.number().gt(0).max(1).optional().describe('scroll_depth only: how far down the page counts, in (0, 1]'),
        displayName: z.string().min(1).max(128).optional().describe('Human-readable name shown in the dashboard'),
        role: z
          .enum(['secondary', 'guardrail'])
          .optional()
          .describe("secondary (default) is tracked and reported; guardrail can also pause variants that hurt it. Never 'primary'."),
        defaultValue: z.number().positive().max(1_000_000_000).optional().describe('Fixed worth of one conversion in the project currency (revenue goals)'),
      },
      outputSchema: {
        goalId: z.string(),
        role: z.enum(['secondary', 'guardrail']).describe('Never primary — this tool cannot change the primary goal'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, goalId, event, urlPattern, locator, threshold, displayName, role, defaultValue }) => {
      const id = encodeURIComponent(projectId);
      const res = await client.post<{ ok: boolean; goalId?: string; role?: 'secondary' | 'guardrail' }>(`/projects/${id}/goal-definitions`, {
        goalId,
        event,
        ...(urlPattern !== undefined ? { urlPattern } : {}),
        ...(locator !== undefined ? { locator } : {}),
        ...(threshold !== undefined ? { threshold } : {}),
        ...(displayName !== undefined ? { displayName } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(defaultValue !== undefined ? { defaultValue } : {}),
      });
      const structuredContent = { goalId: res.goalId ?? goalId, role: res.role ?? role ?? 'secondary' };
      return {
        content: [{
          type: 'text' as const,
          text:
            `Created goal ${untrusted(structuredContent.goalId)} (${structuredContent.role}, ${event}). It is active now. ` +
            'The primary goal was not changed — if this should be what experiments optimize, the owner can make it primary in the dashboard. ' +
            "Reference the goalId verbatim from code (client.goal('<goalId>')) if the event is not tracked automatically.",
        }],
        structuredContent,
      };
    }, {
      goal_exists: 'A goal with this id already exists (it may be archived). define_goal never changes an existing goal — pick a new id (see list_goals), or edit that goal in the dashboard.',
      primary_not_allowed: 'define_goal never sets the primary goal. Create it as secondary; the owner can make it primary in the dashboard.',
      invalid_goal_id: "That goal id is not allowed: use 1-128 characters, and not the reserved 'funnel:' prefix.",
      invalid_goal: 'The goal definition is incomplete for its event type: url_reached needs urlPattern, click/form_submit need a locator, scroll_depth needs threshold.',
      'Not Found': 'This SentientUI API does not support creating goals from MCP yet (it predates create-only goals). Define the goal in the dashboard instead.',
    }),
  );
}
