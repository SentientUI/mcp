import { z } from 'zod';
import { ApiError } from '../api-client.js';

/** Shared input schema for the project UUID, used by every project-scoped tool. */
export const projectIdSchema = z.string().uuid().describe('The project UUID');

/** Shared optional time-window inputs for windowed read tools. Mirrors the
 *  mgmt API contract (domain/date-window.ts): calendar days cut at midnight in
 *  the project's reporting timezone; unknown tokens are a 400, and a custom
 *  `from` older than the plan's data retention is a 403 the error mapper turns
 *  into upgrade guidance — never a silent fallback. */
export function rangeInputSchema(defaultRange: '7d' | '30d' | '90d' | 'all'): {
  range: z.ZodOptional<z.ZodEnum<['7d', '30d', '90d', 'all']>>;
  from: z.ZodOptional<z.ZodString>;
  to: z.ZodOptional<z.ZodString>;
} {
  return {
    range: z
      .enum(['7d', '30d', '90d', 'all'])
      .optional()
      .describe(
        `Calendar window in the project's reporting timezone (default ${defaultRange}). ` +
          `'all' means all retained data — the plan's retention window bounds every lookback.`,
      ),
    from: z
      .string()
      .optional()
      .describe(
        'Custom window start (YYYY-MM-DD; overrides range). Must be within the plan retention window.',
      ),
    to: z.string().optional().describe('Custom window end (YYYY-MM-DD, inclusive; default today).'),
  };
}

export type RangeArgs = { range?: string; from?: string; to?: string };

/** Serialize the window args for a mgmt GET path ('' when none given, so the
 *  endpoint's own default applies). Custom from/to wins over a preset token. */
export function rangeQuery(args: RangeArgs): string {
  const p = new URLSearchParams();
  if (args.from) {
    p.set('from', args.from);
    if (args.to) p.set('to', args.to);
  } else if (args.range) {
    p.set('range', args.range);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** The `window` metadata block windowed mgmt responses carry — surfaced to the
 *  calling agent so it knows exactly what period the numbers cover. */
export const windowOutputSchema = z
  .object({
    range: z.string(),
    start: z.string().nullable(),
    end: z.string().nullable(),
    timezone: z.string(),
    bucketUnit: z.string(),
    retentionDays: z.number().describe("The plan's effective data retention in days"),
    earliestAvailable: z.string().describe('First date retention still holds data for (YYYY-MM-DD)'),
  })
  .optional()
  .describe('The window the server actually used for every count in this response');

export type WindowMeta = z.infer<typeof windowOutputSchema>;

/** One-line human label for a window echo, for tool text output. */
export function windowLine(window: WindowMeta): string {
  if (!window) return '';
  if (window.start && window.end) {
    return `Window: ${window.start.slice(0, 10)} to ${window.end.slice(0, 10)} (${window.timezone}, exclusive end)`;
  }
  return `Window: all retained data (${window.retentionDays}-day retention)`;
}

/** The shape every tool handler returns (a superset — extra keys like
 *  structuredContent / _meta pass through untouched). */
export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  [key: string]: unknown;
};

/**
 * Per-tool extra/override guidance: maps an ApiError.message to bespoke advice.
 * Entries here take precedence over the shared cases below, letting a tool add
 * codes the shared mapper doesn't know (e.g. create_project's
 * project_limit_reached) without forking the whole mapper.
 */
export type ExtraGuidance = Record<string, string>;

/**
 * Translate a common ApiError into actionable, human-readable MCP guidance.
 * Returns null when the error isn't one we have specific advice for (the caller
 * should then rethrow so the host surfaces the raw error). Callers may pass
 * `extra` to add or override cases while still funneling through this one source.
 */
export function apiErrorGuidance(err: ApiError, extra?: ExtraGuidance): string | null {
  if (extra && Object.prototype.hasOwnProperty.call(extra, err.message)) {
    return extra[err.message]!;
  }
  switch (err.message) {
    case 'insufficient_scope':
      return 'This action needs an account login. Connect via the hosted MCP URL (https://api.sentient-ui.com/mcp) and sign in — a project-scoped server key (sk_…) or anonymous demo token cannot do this.';
    case 'demo_read_only':
      return 'Demo mode is read-only. Create a SentientUI account and sign in (or use a project server key) to make changes.';
    case 'insufficient_role':
      return 'Your account role does not permit this action — it needs the account owner or an admin.';
    default:
      break;
  }
  // Time-window contract errors (domain/date-window.ts): a custom window older
  // than the plan's retention is a 403 with the upgrade facts; an unknown range
  // token is a 400. Neither is an access problem, so map them before the
  // generic 403 case.
  if (err.message === 'range_out_of_retention') {
    return (
      'The requested window starts before this plan retains data — older events have been deleted ' +
      'by the retention purge and cannot be recovered. Ask for a more recent window, or upgrade ' +
      'the SentientUI plan for longer history (Growth keeps 180 days, Scale 365).'
    );
  }
  if (err.message === 'invalid_range') {
    return "Invalid time window. Use range '7d', '30d', '90d' or 'all', or from/to as YYYY-MM-DD dates.";
  }
  // 402 Payment Required = a plan/tier gate; 403 with an unmapped message = an
  // access problem. Give generic-but-actionable advice for both.
  if (err.status === 402) {
    return `This feature requires a higher plan (${err.message}). Upgrade your SentientUI plan, then try again.`;
  }
  if (err.status === 403) {
    return `Access denied (${err.message}). Check that your key or login has access to this project.`;
  }
  return null;
}

/**
 * Wrap a tool handler so any ApiError with known guidance is converted into a
 * clean, actionable MCP error result ({ isError: true }) instead of a bare
 * error code. Unmapped errors are rethrown unchanged so hosts still see them.
 */
export function withApiErrorGuidance<Args>(
  fn: (args: Args) => Promise<ToolResult>,
  extra?: ExtraGuidance,
): (args: Args) => Promise<ToolResult> {
  return async (args: Args) => {
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof ApiError) {
        const guidance = apiErrorGuidance(err, extra);
        if (guidance) {
          return { content: [{ type: 'text' as const, text: guidance }], isError: true };
        }
      }
      throw err;
    }
  };
}
