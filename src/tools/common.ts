import { z } from 'zod';
import { ApiError } from '../api-client.js';

/** Shared input schema for the project UUID, used by every project-scoped tool. */
export const projectIdSchema = z.string().uuid().describe('The project UUID');

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
