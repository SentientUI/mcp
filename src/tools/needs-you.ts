import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { projectIdSchema, untrusted, withApiErrorGuidance, UNTRUSTED_FIELDS_NOTE } from './common.js';

// Needs you, for outside agents: the work in motion as cards (spec
// 2026-11-18 "The card's record"). Before this an agent could approve
// versions or open a pull request but could not see what was waiting, or how
// its pull request was getting on — the dashboard and the in-dashboard
// assistant (get_needs_you there too) were the only places that said.

type Card = {
  id: string; kind: string; subject: { kind: string; key: string }; title: string; state: string;
  steps: string[]; step: number; outcome: string | null; detail: Record<string, unknown>;
  undo?: { possible: boolean; reason: string | null };
};

const OPEN = 'needs_you,failed,waiting,working';

/** One card, one line: what it is, where it is, and what it waits for. */
export function cardLine(c: Card): string {
  const step = c.steps[c.step];
  const d = c.detail;
  const extra =
    c.kind === 'pull_request'
      ? [typeof d.prUrl === 'string' ? `pull request ${d.prUrl}` : null, d.checks ? `checks ${String(d.checks)}` : null, d.review ? `review ${String(d.review)}` : null].filter(Boolean).join(', ')
      : c.kind === 'versions' && Array.isArray(d.versions)
        ? `${(d.versions as Array<{ state?: string }>).filter((v) => v.state === 'waiting').length} waiting for approval`
        : c.kind === 'test' && typeof d.testId === 'string' ? `test ${d.testId}` : '';
  return `${untrusted(c.title)} (${c.kind}, card ${c.id}) — ${step ?? c.state}${extra ? `; ${extra}` : ''}${c.outcome ? `. ${untrusted(c.outcome, 200)}` : ''}`;
}

export function registerNeedsYouTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_needs_you',
    {
      title: 'Needs you: what is waiting, and the work in motion',
      description:
        'The work Sentient is doing for this project, as cards — the dashboard\'s Needs you page. `needsYou`: new versions waiting for ' +
        'approval (approve with review_cell), work that failed, and tests with a clear winner (keep with manage_approvals keep_winner). ' +
        '`withDevelopers`: changes sent to the site\'s code as pull requests, with their link, checks and review — they move by themselves ' +
        'as GitHub reports (up to ten minutes late) and end when the change is seen on the site. `inMotion`: versions being written, site ' +
        'checks, running tests. `justFinished`: the last cards that ended, with whether they can still be undone (undo is done in the ' +
        'dashboard). Use it for "what do I need to do?" and to follow a pull request after manage_generation open_pr.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        needsYou: z.array(z.object({}).passthrough()), withDevelopers: z.array(z.object({}).passthrough()),
        inMotion: z.array(z.object({}).passthrough()), justFinished: z.array(z.object({}).passthrough()),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId }: { projectId: string }) => {
      const id = encodeURIComponent(projectId);
      const [open, done] = await Promise.all([
        client.get<{ cards: Card[] }>(`/projects/${id}/cards?state=${OPEN}`),
        client.get<{ cards: Card[] }>(`/projects/${id}/cards?state=done&limit=5&kind=versions,pull_request,site_check,test`),
      ]);
      const needsYou = open.cards.filter((c) => c.state === 'needs_you' || c.state === 'failed');
      const withDevelopers = open.cards.filter((c) => c.state === 'waiting');
      const inMotion = open.cards.filter((c) => c.state === 'working');
      const justFinished = done.cards;
      const section = (title: string, cards: Card[], empty: string) =>
        [title, ...(cards.length ? cards.map((c) => `  ${cardLine(c)}`) : [`  ${empty}`])];
      const lines = [
        ...section('Needs you:', needsYou, 'nothing'),
        '', ...section('With your developers:', withDevelopers, 'nothing'),
        '', ...section('In motion:', inMotion, 'nothing'),
        '', ...section('Just finished:', justFinished.map((c) => ({ ...c, outcome: [c.outcome, c.undo?.possible ? 'Can still be undone in the dashboard.' : null].filter(Boolean).join(' ') || null })), 'nothing'),
      ];
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: { needsYou, withDevelopers, inMotion, justFinished },
      };
    }),
  );
}
