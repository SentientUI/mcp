import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { projectIdSchema, withApiErrorGuidance } from './common.js';

// get_internal_traffic_rules: what Settings → Internal traffic shows, for an
// agent asked "why did my staging visits disappear?" or "is my team excluded?".
// Without it an agent could see the "Your team / test sites" slice in
// get_traffic_breakdown but not which rule put a visit there, and guessed.
//
// The rules change what every report counts. Agents change them with
// manage_settings (set_internal_sites, add_internal_email,
// remove_internal_email), under the Project settings switch of Agent access.

/** The same label the dashboard and get_traffic_breakdown use for the slice. */
export const INTERNAL_TRAFFIC_LABEL = 'Your team / test sites';

type Reason = 'site' | 'code' | 'email_rule' | 'domain_rule' | 'browser';

// GET /v1/mgmt/projects/:id/internal-traffic (plan 2026-11-04 internal traffic
// exclusion, "Interfaces"). The fields this tool reads.
type InternalTrafficResponse = {
  internalOrigins?: string[];
  allowedOrigins?: string[];
  emailDomains?: string[];
  emails?: Array<{ hash: string; masked: string }>;
  browserLink?: { token: string } | null;
  counts7d?: Partial<Record<Reason | 'total', number>>;
  recordingSince?: string | null;
};

const REASONS: ReadonlyArray<{ key: Reason; words: string }> = [
  { key: 'site', words: 'internal sites' },
  { key: 'code', words: 'code flag' },
  { key: 'email_rule', words: 'team emails' },
  { key: 'domain_rule', words: 'team domains' },
  { key: 'browser', words: 'browser link' },
];

export function registerInternalTrafficTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_internal_traffic_rules',
    {
      title: 'Internal traffic rules',
      description:
        "Read how this project keeps its own team and test sites out of its numbers (dashboard Settings → Internal traffic): " +
        'which allowed domains are internal sites, the team email domains and masked exact emails, whether a "mark this browser" link exists, ' +
        'and how many sessions each way marked internal in the last 7 days. ' +
        `Internal visits still see versions (QA works) but never count in any report or teach the optimizer; get_traffic_breakdown lists them as "${INTERNAL_TRAFFIC_LABEL}". ` +
        'Exact emails are stored only as a hash — this tool returns the masked form, never an address or the hash. ' +
        'Rules apply from when they are turned on. To change them: manage_settings set_internal_sites, add_internal_email, remove_internal_email.',
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        internalOrigins: z.array(z.string()).describe('Allowed domains whose every visit is marked internal'),
        allowedOrigins: z.array(z.string()).describe('Every allowed domain — only these can be made internal'),
        emailDomains: z.array(z.string()).describe('Email domains (no leading @) whose identified visitors are marked internal'),
        emails: z.array(z.string()).describe('Exact team emails, masked (c***@example.com); stored only as a hash'),
        browserLinkExists: z
          .boolean()
          .describe('Whether a "mark this browser internal" link has been created (copy or rotate it in Settings → Internal traffic)'),
        counts7d: z
          .object({
            site: z.number(),
            code: z.number(),
            email_rule: z.number(),
            domain_rule: z.number(),
            browser: z.number(),
            total: z.number(),
          })
          .describe('Sessions marked internal in the last 7 days, by the way that marked them first'),
        recordingSince: z
          .string()
          .nullable()
          .describe('When sessions began recording which site they came from; visits before it cannot be separated'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId }: { projectId: string }) => {
      const r = await client.get<InternalTrafficResponse>(
        `/projects/${encodeURIComponent(projectId)}/internal-traffic`,
      );
      const internalOrigins = r.internalOrigins ?? [];
      const allowedOrigins = r.allowedOrigins ?? [];
      const emailDomains = r.emailDomains ?? [];
      // The hash is personal data in its own right (it identifies one address
      // to anyone holding a list); an agent needs the masked form to talk
      // about the rule, never the hash.
      const emails = (r.emails ?? []).map((e) => e.masked);
      const c = r.counts7d ?? {};
      const counts7d = {
        site: c.site ?? 0,
        code: c.code ?? 0,
        email_rule: c.email_rule ?? 0,
        domain_rule: c.domain_rule ?? 0,
        browser: c.browser ?? 0,
        total: c.total ?? 0,
      };
      const recordingSince = r.recordingSince ?? null;
      // Not the token: it would put a working "hide my visits" link into every
      // agent transcript that read this. People copy it from Settings.
      const browserLinkExists = r.browserLink != null;

      // Printed as-is, unlike visitor-minted names elsewhere: every value here
      // was set by a project editor and normalized by the API (origins by
      // normalizeOrigin, domains lowercased, emails masked server-side).
      const notInternal = allowedOrigins.filter((o) => !internalOrigins.includes(o));
      const lines = [
        `Internal traffic — reported as "${INTERNAL_TRAFFIC_LABEL}": these visits still see versions but never count and never teach the optimizer.`,
        `Internal sites: ${internalOrigins.length ? internalOrigins.join(', ') : 'none'}.`,
        ...(notInternal.length ? [`Allowed but counted normally: ${notInternal.join(', ')}.`] : []),
        `Team domains: ${emailDomains.length ? emailDomains.map((d) => `@${d}`).join(', ') : 'none'}.`,
        `Team emails: ${emails.length ? emails.join(', ') : 'none'} (stored only as a hash; they match visitors the site identifies with identify(userId, { email })).`,
        `Browser link: ${browserLinkExists ? 'created — copy or rotate it in Settings → Internal traffic' : 'not created'}.`,
        `Sessions marked internal, last 7 days: ${counts7d.total} (${REASONS.map((x) => `${x.words} ${counts7d[x.key]}`).join(', ')}).`,
        recordingSince
          ? `Applies from when each rule is turned on; visits before ${recordingSince.slice(0, 10)} cannot be separated (which site a visit came from was not recorded).`
          : 'Applies from when each rule is turned on; earlier visits cannot be separated.',
        'To change these, a person uses Settings → Internal traffic in the dashboard.',
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: { internalOrigins, allowedOrigins, emailDomains, emails, browserLinkExists, counts7d, recordingSince },
      };
    }),
  );
}
