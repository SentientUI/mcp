import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { projectIdSchema, untrusted, withApiErrorGuidance, UNTRUSTED_FIELDS_NOTE } from './common.js';

// The elements Sentient found on the site (the site check's targets), for
// outside agents. Without this an agent could call manage_generation open_pr
// but had no way to learn the `targetId` it needs — the in-dashboard
// assistant reads the same list through rank_targets_for_goal. Selectors stay
// server-side, as there: an agent grounds on the element's id and label,
// never on a raw locator it might paste into code.

type Target = { id: string; kind?: string; label?: string; text?: string; pageUrl?: string; confidence?: string };
type Audit = { status: string; report?: { targets?: Target[] } | null; auditedAt?: string | null; checking?: boolean; crawlable?: boolean; error?: string | null };

/** At most this many elements in one answer: a page has a handful worth changing, not hundreds. */
export const MAX_ELEMENTS = 60;

export function registerPageElementTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_page_elements',
    {
      title: 'Page elements Sentient found on your site',
      description:
        'The buttons, headlines, forms and other elements the latest site check found, each with an `id`, what kind it is, its label, ' +
        'its current text and the page it is on. Use an `id` as `targetId` for manage_generation open_pr, which writes the change into ' +
        'your site\'s code and sends it to your developers as a pull request (the project needs a connected GitHub repo first — that one ' +
        'step is done in the dashboard, Settings → GitHub, because GitHub asks the repo owner to approve the app). An element with no ' +
        'text (a whole form, an image with no id) cannot be found in the code and is refused for open_pr — offer the no-code path for it. ' +
        'open_pr body: { targetId, label, goalId, ' +
        'arms: [{ displayName, ops }] } with 2–4 arms, the first being the element as it is now (ops {}). ops may set: text (plain text), ' +
        'hidden (boolean), href and imageSrc (https URLs), imageAlt, and style with these properties only: color, background, fontSize, ' +
        'fontWeight, textAlign, padding, margin, borderRadius, width, height, maxWidth, border, boxShadow, opacity, lineHeight, ' +
        'letterSpacing, textTransform, gap, fontFamily. Pass `pageUrl` to keep one page. When the site has not been checked yet, ask for a ' +
        'check with manage_settings rescan_site; results land in a few minutes.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: {
        projectId: projectIdSchema,
        pageUrl: z.string().max(500).optional().describe('Only elements on this page (a path like /pricing, or a full URL)'),
      },
      outputSchema: {
        status: z.string().describe('ok | pending (never checked, or the first check is running) | error'),
        checkedAt: z.string().nullable(),
        checking: z.boolean().describe('A new check is running now'),
        elements: z.array(z.object({
          id: z.string(), kind: z.string().nullable(), label: z.string().nullable(), text: z.string().nullable(),
          pageUrl: z.string().nullable(), confidence: z.string().nullable(),
        })),
        more: z.number().describe('Elements left out beyond the first ' + MAX_ELEMENTS),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, pageUrl }: { projectId: string; pageUrl?: string }) => {
      const a = await client.get<Audit>(`/projects/${encodeURIComponent(projectId)}/site-audit`);
      const pathOf = (u: string | undefined) => {
        if (!u) return '';
        try { return new URL(u, 'https://x.invalid').pathname.replace(/\/+$/, '') || '/'; } catch { return u; }
      };
      const want = pageUrl ? pathOf(pageUrl) : null;
      const all = (a.report?.targets ?? []).filter((t) => typeof t?.id === 'string' && (want === null || pathOf(t.pageUrl) === want));
      const shown = all.slice(0, MAX_ELEMENTS);
      const elements = shown.map((t) => ({
        id: t.id, kind: t.kind ?? null, label: t.label ?? null, text: t.text ?? null, pageUrl: t.pageUrl ?? null, confidence: t.confidence ?? null,
      }));
      const lines: string[] = [];
      if (a.status !== 'ok') {
        lines.push(a.status === 'error'
          ? `The last site check failed${a.error ? ` (${untrusted(a.error, 200)})` : ''}. Ask for another with manage_settings rescan_site.`
          : a.checking
            ? 'The site is being checked now. Ask again in a few minutes.'
            : 'The site has not been checked yet. Ask for a check with manage_settings rescan_site; results land in a few minutes.');
      } else {
        lines.push(`${all.length} element${all.length === 1 ? '' : 's'}${want ? ` on ${untrusted(want)}` : ''}${a.auditedAt ? `, from the check on ${a.auditedAt.slice(0, 10)}` : ''}${a.checking ? ' (a newer check is running)' : ''}.`);
        for (const e of elements) {
          lines.push(`  ${untrusted(e.id)} — ${e.kind ?? 'element'}: ${untrusted(e.label ?? e.text ?? e.id)}${e.text && e.text !== e.label ? ` · text ${untrusted(e.text, 80)}` : ''}${e.pageUrl ? ` · on ${untrusted(pathOf(e.pageUrl))}` : ''}`);
        }
        if (all.length > shown.length) lines.push(`  …and ${all.length - shown.length} more. Pass pageUrl to see one page.`);
      }
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: { status: a.status, checkedAt: a.auditedAt ?? null, checking: a.checking === true, elements, more: all.length - shown.length },
      };
    }),
  );
}
