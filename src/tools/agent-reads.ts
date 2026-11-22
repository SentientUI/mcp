import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import {
  projectIdSchema,
  rangeInputSchema,
  rangeQuery,
  settled,
  throwIfNotDegradable,
  untrusted,
  UNTRUSTED_FIELDS_NOTE,
  withApiErrorGuidance,
  type ToolResult,
} from './common.js';

// Read tools that let an agent see what the dashboard shows for the Agent
// access areas: the switches themselves, campaigns and retargeting, the
// audiences, the captured site styles, and a region's publish history. Before
// these, an agent that was allowed to act in an area had no way to look at it
// first, so it either guessed or asked the person to paste a dashboard screen.
// Each tool maps the real mgmt payload (apps/api/src/routes/mgmt) — the
// shapes below are the fields it reads, not the whole response.

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

// Display names pinned by the plan (and the dashboard's Settings → Agent access).
const AREA_NAMES = {
  generate: 'Generate',
  approve: 'Approve and publish',
  tests: 'Run tests',
  goals: 'Goals and funnels',
  campaigns: 'Campaigns and audiences',
  settings: 'Project settings',
} as const;
type AreaKey = keyof typeof AREA_NAMES;

const text = (t: string, structuredContent: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text' as const, text: t }],
  structuredContent,
});

const pct = (n: number): string => `${Math.round(n * 100)}%`;

// ── get_agent_access ────────────────────────────────────────────────────────

type AgentAccessResponse = { areas?: Partial<Record<AreaKey, boolean>>; canEdit?: boolean };

// ── campaigns ───────────────────────────────────────────────────────────────

type CampaignRow = {
  id: string;
  personaKey?: string;
  name: string;
  arrivalType?: string;
  status?: string;
  startsAt?: string;
  endsAt?: string | null;
  landingPaths?: string[];
};
type GroupRow = { id: string; campaignId?: string; name: string; status?: string; endsAt?: string; memberCount?: number };
type ObservedRow = { campaign: string; sessions?: number; channel?: string | null; platform?: string | null };
type CampaignListResponse = { named?: CampaignRow[]; retargeting?: GroupRow[]; observed?: ObservedRow[] };
type CampaignReportResponse = {
  campaign?: CampaignRow;
  report?: {
    clicks?: number;
    servedAsCampaign?: number;
    servedOtherwise?: number;
    controlGroup?: number;
    newPeople?: number;
    cameBack?: number;
    versions?: Array<{ label: string; shown?: number; conversions?: number; effect?: string | null }>;
    becameGroups?: Array<{ label: string; count: number }>;
    retargeting?: { groupId: string; label: string; status: string; endsAt: string } | null;
    vsControl?: {
      goal?: { id: string | null; name: string };
      sentient?: { people?: number; conversions?: number };
      control?: { people?: number; conversions?: number };
      rates?: { sentient: number; control: number } | null;
      interval?: { lo: number; hi: number } | null;
      verdict?: 'helping' | 'hurting' | 'not_proven';
      moreNeeded?: number;
      splitCheck?: string;
    };
  };
};

const VERDICT_WORDS = { helping: 'Helping', hurting: 'Hurting', not_proven: 'Not proven yet' } as const;
/** A rate as people per hundred, one decimal; a difference signed. */
const per100 = (x: number) => (x * 100).toFixed(1);
const signedPer100 = (x: number) => {
  const r = Number((x * 100).toFixed(1));
  return r === 0 ? '0.0' : `${r > 0 ? '+' : '-'}${Math.abs(r).toFixed(1)}`;
};

// ── audiences ───────────────────────────────────────────────────────────────

type DeclaredResponse = { source?: string; version?: number; members?: Array<{ key: string; displayName: string; description?: string | null; status?: string }> };
type DiscoveredMember = {
  key: string;
  displayName: string;
  description?: string | null;
  sessions?: number;
  trafficShare?: number;
  evidence?: { status?: string } | null;
};
type DiscoveredResponse = { set?: { version?: number; members?: DiscoveredMember[] } | null };
type PromotionResponse = { eligible?: boolean; blockers?: string[] };

/** The server's evidence status in the words the dashboard uses. */
function evidenceWords(status: string | undefined): string {
  switch (status) {
    case 'validated_strong': return 'strong_evidence';
    case 'validated_moderate': return 'moderate_evidence';
    case 'no_differential_response': return 'no_clear_difference';
    case 'insufficient_sample': return 'not_enough_data';
    default: return 'not_checked_yet';
  }
}

/**
 * A promotion blocker code in plain words. The API sends codes like
 * `segment_insufficient_sample:d-audience_1`; an agent (and the person it
 * relays to) should read the audience's name, not its key.
 */
export function blockerWords(code: string, names: Map<string, string>): string {
  const m = /^segment_(.+?):(.+)$/.exec(code);
  if (m) {
    const [, status, key] = m as unknown as [string, string, string];
    const name = names.get(key) ?? key;
    if (status === 'insufficient_sample') return `not enough data yet for ${name}`;
    if (status === 'no_differential_response') return `no clear difference yet between ${name} and everyone else`;
    if (status === 'unvalidated') return `${name} has not been checked yet`;
    return `${name} is not ready (${status.replace(/_/g, ' ')})`;
  }
  if (code === 'no_candidate_set') return 'no discovered audiences yet';
  if (code === 'candidate_too_small') return 'fewer than two discovered audiences so far';
  return code.replace(/_/g, ' ');
}

// ── site styles ─────────────────────────────────────────────────────────────

type StyleEntryRow = {
  id: string;
  role: string;
  classes?: string;
  source?: string;
  computed?: { color?: string; bg?: string; bgDark?: string; fontSize?: string; fontWeight?: string; radius?: string };
  seen?: { url?: string; count?: number; at?: string };
};
type StyleVocabResponse = { entries?: StyleEntryRow[]; images?: unknown[]; sources?: { editorAt?: string | null; crawlAt?: string | null } };
type SiteAuditResponse = { status?: string; overallScore?: number | null; auditedAt?: string | null; checking?: boolean; crawlable?: boolean | null; error?: string | null };

// ── region history ──────────────────────────────────────────────────────────

type HistoryResponse = {
  currentVersion?: number;
  versions?: Array<{ version: number; published_by?: string | null; created_at?: string; isCurrent?: boolean }>;
  decisions?: Array<{ action?: string; created_at?: string; from_version?: number | null; to_version?: number | null }>;
};
type DriftResponse = { verdict?: string; message?: string; checkedUrl?: string | null };

export function registerAgentReadTools(server: McpServer, client: Pick<ApiClient, 'get'> & ApiClient): void {
  // 1. get_agent_access ──────────────────────────────────────────────────────
  server.registerTool(
    'get_agent_access',
    {
      title: 'Agent access',
      description:
        'See which areas of this project a person has allowed agents to change: Generate, Approve and publish, Run tests, ' +
        'Goals and funnels, Campaigns and audiences, Project settings. Reading is always allowed; this tells you what a write ' +
        'tool will be refused for before you try it. Agents cannot change these switches — only a person can, in Settings → Agent access.',
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        areas: z.object({
          generate: z.boolean(), approve: z.boolean(), tests: z.boolean(),
          goals: z.boolean(), campaigns: z.boolean(), settings: z.boolean(),
        }).describe('true = agents may act in this area'),
        canEdit: z.boolean().describe('Whether THIS credential could change the switches (always false for an agent)'),
      },
      annotations: READ_ONLY,
    },
    withApiErrorGuidance(async ({ projectId }: { projectId: string }) => {
      const data = await client.get<AgentAccessResponse>(`/projects/${encodeURIComponent(projectId)}/agent-access`);
      // An absent key means on (the plan's default), so only an explicit false is off.
      const areas = Object.fromEntries(
        (Object.keys(AREA_NAMES) as AreaKey[]).map((k) => [k, data.areas?.[k] !== false]),
      ) as Record<AreaKey, boolean>;
      const off = (Object.keys(AREA_NAMES) as AreaKey[]).filter((k) => !areas[k]);
      const lines = off.length === 0
        ? ['All areas are on: agents may act everywhere in this project.']
        : [
            ...off.map((k) => `${AREA_NAMES[k]} is off: agents cannot make changes there. A person can turn it on in Settings → Agent access.`),
            `Allowed: ${(Object.keys(AREA_NAMES) as AreaKey[]).filter((k) => areas[k]).map((k) => AREA_NAMES[k]).join(', ') || 'none'}.`,
          ];
      return text(lines.join('\n'), { areas, canEdit: data.canEdit === true });
    }),
  );

  // 2. list_campaigns ────────────────────────────────────────────────────────
  server.registerTool(
    'list_campaigns',
    {
      title: 'Campaigns',
      description:
        "List this project's named campaigns, their retargeting groups, and the campaigns seen in traffic. Pass campaignId to " +
        "get one campaign's card instead: clicks, new people, how many came back, conversions per version, the control group " +
        "(visitors held back on the original site), and the campaign's verdict against that control group: Helping, Hurting or " +
        'Not proven yet, with the likely range of the difference per 100 people. The verdict is an always-valid test (it stays ' +
        "honest however often it is re-checked) on the campaign's goal; \"Not proven yet\" is the usual answer with a small " +
        'control group and must be reported as such, never as a lean. The other numbers are counts, not lift.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: {
        projectId: projectIdSchema,
        campaignId: z.string().optional().describe("A campaign id from this tool's list; returns that campaign's card"),
        ...rangeInputSchema('30d'),
      },
      outputSchema: {
        campaigns: z.array(z.object({
          id: z.string(), name: z.string(), status: z.string().nullable(), arrivalType: z.string().nullable(),
          landingPaths: z.array(z.string()),
        })).optional(),
        retargeting: z.array(z.object({
          groupId: z.string(), campaignId: z.string().nullable(), name: z.string(), status: z.string().nullable(),
          endsAt: z.string().nullable(), memberCount: z.number(),
        })).optional(),
        observed: z.array(z.object({ campaign: z.string(), sessions: z.number(), channel: z.string().nullable() })).optional(),
        card: z.object({
          campaignId: z.string(), name: z.string(), status: z.string().nullable(),
          clicks: z.number(), people: z.number().describe('New people served as the campaign'),
          cameBack: z.number(),
          controlGroup: z.number().describe('Matched visits held back on the original site'),
          versions: z.array(z.object({ label: z.string(), shown: z.number(), conversions: z.number() })).describe('Per section and version; one visitor can appear in several rows, so do not add them up'),
          retargetingGroupId: z.string().nullable(),
          vsControl: z.object({
            verdict: z.enum(['helping', 'hurting', 'not_proven']).describe('helping iff the whole likely range is above 0, hurting iff below, else not_proven'),
            goal: z.string().describe("The goal judged: the campaign's, else the main goal"),
            sentient: z.object({ people: z.number(), conversions: z.number() }).describe('Clickers not in the control group, whatever they were shown (already-known visitors included)'),
            control: z.object({ people: z.number(), conversions: z.number() }).describe('Clickers in the control group, shown the original site'),
            per100People: z.object({ sentient: z.number(), control: z.number() }).nullable().describe('Conversions per 100 people on each side; null below 100 people per side'),
            differencePer100People: z.object({ low: z.number(), high: z.number() }).nullable().describe('Always-valid 95% range of sentient minus control, per 100 people; null until the test has started'),
            morePeopleNeeded: z.number().nullable().describe('About how many more clickers would give an 80% chance to show a 20% improvement; null when not estimable or not needed'),
            splitMismatch: z.boolean().describe('true when the control group is not the expected share of these clickers: the comparison may not be fair'),
          }).nullable().describe('Null from an API without the verdict'),
        }).optional().describe('Only when campaignId was given'),
      },
      annotations: READ_ONLY,
    },
    withApiErrorGuidance(async (args: { projectId: string; campaignId?: string; range?: string; from?: string; to?: string }) => {
      const id = encodeURIComponent(args.projectId);
      if (args.campaignId) {
        const data = await client.get<CampaignReportResponse>(
          `/projects/${id}/campaigns/${encodeURIComponent(args.campaignId)}/report${rangeQuery(args)}`,
        );
        const r = data.report ?? {};
        const versions = (r.versions ?? []).map((v) => ({ label: v.label, shown: v.shown ?? 0, conversions: v.conversions ?? 0 }));
        const vc = r.vsControl;
        const vsControl = vc && vc.verdict
          ? {
              verdict: vc.verdict,
              goal: vc.goal?.name ?? 'Any conversion goal',
              sentient: { people: vc.sentient?.people ?? 0, conversions: vc.sentient?.conversions ?? 0 },
              control: { people: vc.control?.people ?? 0, conversions: vc.control?.conversions ?? 0 },
              per100People: vc.rates ? { sentient: Number(per100(vc.rates.sentient)), control: Number(per100(vc.rates.control)) } : null,
              differencePer100People: vc.interval
                ? { low: Number((vc.interval.lo * 100).toFixed(2)), high: Number((vc.interval.hi * 100).toFixed(2)) }
                : null,
              morePeopleNeeded: vc.moreNeeded ?? null,
              splitMismatch: vc.splitCheck === 'mismatch',
            }
          : null;
        const card = {
          campaignId: data.campaign?.id ?? args.campaignId,
          name: data.campaign?.name ?? args.campaignId,
          status: data.campaign?.status ?? null,
          clicks: r.clicks ?? 0,
          people: r.newPeople ?? 0,
          cameBack: r.cameBack ?? 0,
          controlGroup: r.controlGroup ?? 0,
          versions,
          retargetingGroupId: r.retargeting?.groupId ?? null,
          vsControl,
        };
        const verdictLines = vsControl && vc
          ? [
              `Against the control group, on ${untrusted(vsControl.goal)}: ${VERDICT_WORDS[vsControl.verdict]}.`,
              `  ${vsControl.sentient.people} people with Sentient (${vsControl.sentient.conversions} converted), ` +
                `${vsControl.control.people} in the control group (${vsControl.control.conversions} converted). ` +
                'The Sentient side is every clicker outside the control group, already-known visitors included.',
              ...(vc.rates ? [`  ${per100(vc.rates.sentient)} vs ${per100(vc.rates.control)} conversions per 100 people.`] : []),
              ...(vc.interval
                ? [`  Difference likely between ${signedPer100(vc.interval.lo)} and ${signedPer100(vc.interval.hi)} per 100 people (always-valid: holds however often it is checked).`]
                : []),
              ...(vsControl.verdict === 'not_proven' ? ['  Not proven yet means the difference could still be zero: do not report it as a lean either way.'] : []),
              ...(vsControl.morePeopleNeeded ? [`  About ${vsControl.morePeopleNeeded} more clickers would give it a fair chance to show a 20% improvement, if there is one.`] : []),
              ...(vsControl.splitMismatch ? ['  Warning: the control group is not the expected share of these clickers, so this comparison may not be fair.'] : []),
            ]
          : [];
        const lines = [
          `${untrusted(card.name)} (${card.status ?? 'status unknown'})`,
          `${card.clicks} clicks · ${card.people} new people · ${card.cameBack} came back`,
          'Conversions are shown per version below (counted per section and version, so they are not a total number of people).',
          `${card.controlGroup} visits were in the control group (kept on the original site, so not shown the campaign).`,
          ...versions.map((v) => `  - ${untrusted(v.label)}: shown ${v.shown}, ${v.conversions} converted`),
          card.retargetingGroupId ? `Retargeting group: ${untrusted(card.retargetingGroupId)} (use get_retargeting_report).` : 'Not retargeted.',
          ...verdictLines,
        ];
        return text(lines.join('\n'), { card });
      }
      const data = await client.get<CampaignListResponse>(`/projects/${id}/campaigns${rangeQuery(args)}`);
      const campaigns = (data.named ?? []).map((c) => ({
        id: c.id, name: c.name, status: c.status ?? null, arrivalType: c.arrivalType ?? null, landingPaths: c.landingPaths ?? [],
      }));
      const retargeting = (data.retargeting ?? []).map((g) => ({
        groupId: g.id, campaignId: g.campaignId ?? null, name: g.name, status: g.status ?? null,
        endsAt: g.endsAt ?? null, memberCount: g.memberCount ?? 0,
      }));
      const observed = (data.observed ?? []).map((o) => ({ campaign: o.campaign, sessions: o.sessions ?? 0, channel: o.channel ?? null }));
      const lines: string[] = [];
      lines.push(campaigns.length ? `Campaigns (${campaigns.length}):` : 'No named campaigns yet.');
      for (const c of campaigns) lines.push(`  - ${untrusted(c.name)} id ${untrusted(c.id)} · ${c.status ?? 'unknown'} · ${c.arrivalType ?? 'no arrival type'}`);
      if (retargeting.length) {
        lines.push('', `Retargeting (${retargeting.length}):`);
        for (const g of retargeting) lines.push(`  - ${untrusted(g.name)} id ${untrusted(g.groupId)} · ${g.status ?? 'unknown'} · ${g.memberCount} people`);
      }
      if (observed.length) {
        lines.push('', 'Seen in traffic:');
        for (const o of observed) lines.push(`  - ${untrusted(o.campaign)}: ${o.sessions} visits${o.channel ? ` via ${untrusted(o.channel)}` : ''}`);
      }
      return text(lines.join('\n'), { campaigns, retargeting, observed });
    }),
  );

  // 3. get_retargeting_report ────────────────────────────────────────────────
  server.registerTool(
    'get_retargeting_report',
    {
      title: 'Retargeting report',
      description:
        "One retargeting group's numbers: how many people it started with, how many came back, clicks and conversions. " +
        'These are counts, not lift. Get the group id from list_campaigns.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema, groupId: z.string().describe('A retargeting group id from list_campaigns') },
      outputSchema: {
        groupId: z.string(), name: z.string(), status: z.string().nullable(), endsAt: z.string().nullable(),
        members: z.number(), cameBack: z.number(), converted: z.number(), clicks: z.number(),
        versions: z.array(z.object({ label: z.string(), shown: z.number(), conversions: z.number() })),
      },
      annotations: READ_ONLY,
    },
    withApiErrorGuidance(async ({ projectId, groupId }: { projectId: string; groupId: string }) => {
      const data = await client.get<{
        group?: GroupRow;
        report?: { members?: number; cameBack?: number; converted?: number; clicks?: number; versions?: Array<{ label: string; shown?: number; conversions?: number }> };
      }>(`/projects/${encodeURIComponent(projectId)}/retargeting/${encodeURIComponent(groupId)}/report`);
      const r = data.report ?? {};
      const out = {
        groupId: data.group?.id ?? groupId,
        name: data.group?.name ?? groupId,
        status: data.group?.status ?? null,
        endsAt: data.group?.endsAt ?? null,
        members: r.members ?? 0,
        cameBack: r.cameBack ?? 0,
        converted: r.converted ?? 0,
        clicks: r.clicks ?? 0,
        versions: (r.versions ?? []).map((v) => ({ label: v.label, shown: v.shown ?? 0, conversions: v.conversions ?? 0 })),
      };
      const lines = [
        `Retargeting ${untrusted(out.name)} (${out.status ?? 'status unknown'})`,
        `${out.cameBack} of ${out.members} came back · ${out.clicks} clicks · ${out.converted} converted`,
        ...out.versions.map((v) => `  - ${untrusted(v.label)}: shown ${v.shown}, ${v.conversions} converted`),
      ];
      return text(lines.join('\n'), out);
    }),
  );

  // 4. get_audiences ─────────────────────────────────────────────────────────
  server.registerTool(
    'get_audiences',
    {
      title: 'Audiences',
      description:
        'The audiences visitors are sorted into: the ones the site declares, the ones discovered from behaviour (with how many ' +
        'sessions, their share of traffic, and how much evidence there is), and whether the discovered set can be promoted to ' +
        'serving yet, with what is blocking it in plain words.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        declared: z.object({
          source: z.string().nullable(),
          members: z.array(z.object({ key: z.string(), displayName: z.string(), status: z.string().nullable() })),
        }).nullable(),
        discovered: z.object({
          members: z.array(z.object({
            key: z.string(), displayName: z.string(), sessions: z.number().nullable(), share: z.number().nullable(),
            evidence: z.string().describe('strong_evidence | moderate_evidence | no_clear_difference | not_enough_data | not_checked_yet'),
          })),
        }).nullable().describe('null when no discovered set exists yet'),
        promotion: z.object({ eligible: z.boolean(), blockers: z.array(z.string()) }).nullable(),
      },
      annotations: READ_ONLY,
    },
    withApiErrorGuidance(async ({ projectId }: { projectId: string }) => {
      const id = encodeURIComponent(projectId);
      const [declaredR, discoveredR, promotionR] = await Promise.all([
        settled(client.get<DeclaredResponse>(`/projects/${id}/personas`)),
        settled(client.get<DiscoveredResponse>(`/projects/${id}/personas/discovered`)),
        settled(client.get<PromotionResponse>(`/projects/${id}/personas/promotion`)),
      ]);
      // A 401/403 must surface; a lone failed section may degrade to "unavailable".
      throwIfNotDegradable([declaredR, discoveredR, promotionR]);

      const declared = declaredR.ok
        ? {
            source: declaredR.value.source ?? null,
            members: (declaredR.value.members ?? []).map((m) => ({ key: m.key, displayName: m.displayName, status: m.status ?? null })),
          }
        : null;
      const dMembers = discoveredR.ok ? discoveredR.value.set?.members : undefined;
      const discovered = discoveredR.ok && discoveredR.value.set
        ? {
            members: (dMembers ?? []).map((m) => ({
              key: m.key,
              displayName: m.displayName,
              sessions: typeof m.sessions === 'number' ? m.sessions : null,
              share: typeof m.trafficShare === 'number' ? m.trafficShare : null,
              evidence: evidenceWords(m.evidence?.status),
            })),
          }
        : null;
      const names = new Map((dMembers ?? []).map((m) => [m.key, m.displayName] as const));
      const promotion = promotionR.ok
        ? {
            eligible: promotionR.value.eligible === true,
            blockers: (promotionR.value.blockers ?? []).map((b) => blockerWords(b, names)),
          }
        : null;

      const lines: string[] = [];
      if (declared) {
        lines.push(declared.members.length ? 'Declared audiences:' : 'No declared audiences.');
        for (const m of declared.members) lines.push(`  - ${untrusted(m.displayName)} (key ${untrusted(m.key)})`);
      } else lines.push('Declared audiences: unavailable right now.');
      lines.push('');
      if (discovered) {
        lines.push('Discovered audiences:');
        for (const m of discovered.members) {
          const bits = [m.sessions !== null ? `${m.sessions} sessions` : null, m.share !== null ? `${pct(m.share)} of traffic` : null, m.evidence.replace(/_/g, ' ')];
          lines.push(`  - ${untrusted(m.displayName)} (key ${untrusted(m.key)}): ${bits.filter(Boolean).join(' · ')}`);
        }
      } else lines.push(discoveredR.ok ? 'No discovered audiences yet.' : 'Discovered audiences: unavailable right now.');
      lines.push('');
      if (promotion) {
        lines.push(promotion.eligible ? 'The discovered audiences are ready to be promoted to serving.' : 'The discovered audiences cannot be promoted yet:');
        for (const b of promotion.blockers) lines.push(`  - ${untrusted(b, 200)}`);
      }
      return text(lines.join('\n'), { declared, discovered, promotion });
    }),
  );

  // 5. get_site_styles ───────────────────────────────────────────────────────
  server.registerTool(
    'get_site_styles',
    {
      title: 'Site styles',
      description:
        "The styles captured from the site (what generated sections borrow), grouped by role, whether their colors were actually " +
        'measured, when the scan last ran, and the site audit score. Without measured colors a style cannot be checked for readable contrast.' +
        UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        colorsMeasured: z.boolean().describe('false when no captured style has a measured text or background color'),
        roles: z.array(z.object({
          role: z.string(), count: z.number(), measuredColors: z.number().describe('How many of these styles have a measured color'),
        })),
        lastScan: z.object({ editorAt: z.string().nullable(), crawlAt: z.string().nullable() }),
        audit: z.object({
          status: z.string().nullable(), score: z.number().nullable(), auditedAt: z.string().nullable(), checking: z.boolean(),
        }).nullable().describe('null when the audit could not be read'),
      },
      annotations: READ_ONLY,
    },
    withApiErrorGuidance(async ({ projectId }: { projectId: string }) => {
      const id = encodeURIComponent(projectId);
      const [vocabR, auditR] = await Promise.all([
        settled(client.get<StyleVocabResponse>(`/projects/${id}/style-vocabulary`)),
        settled(client.get<SiteAuditResponse>(`/projects/${id}/site-audit`)),
      ]);
      throwIfNotDegradable([vocabR, auditR]);
      // The styles are the point of the tool: if they failed, say so loudly
      // instead of returning an empty list that reads as "nothing captured".
      if (!vocabR.ok) throw vocabR.error;
      const entries = vocabR.value.entries ?? [];
      const measured = (e: StyleEntryRow) => !!(e.computed?.color || e.computed?.bg || e.computed?.bgDark);
      const byRole = new Map<string, { count: number; measuredColors: number }>();
      for (const e of entries) {
        const cur = byRole.get(e.role) ?? { count: 0, measuredColors: 0 };
        cur.count += 1;
        if (measured(e)) cur.measuredColors += 1;
        byRole.set(e.role, cur);
      }
      const roles = [...byRole.entries()].map(([role, v]) => ({ role, ...v })).sort((a, b) => a.role.localeCompare(b.role));
      const colorsMeasured = entries.some(measured);
      const lastScan = { editorAt: vocabR.value.sources?.editorAt ?? null, crawlAt: vocabR.value.sources?.crawlAt ?? null };
      const audit = auditR.ok
        ? {
            status: auditR.value.status ?? null,
            score: typeof auditR.value.overallScore === 'number' ? auditR.value.overallScore : null,
            auditedAt: auditR.value.auditedAt ?? null,
            checking: auditR.value.checking === true,
          }
        : null;

      const lines: string[] = [];
      if (entries.length === 0) lines.push('No styles captured from this site yet.');
      else {
        lines.push(`${entries.length} captured style${entries.length === 1 ? '' : 's'} across ${roles.length} role${roles.length === 1 ? '' : 's'}:`);
        for (const r of roles) lines.push(`  - ${untrusted(r.role)}: ${r.count} (${r.measuredColors} with measured colors)`);
        if (!colorsMeasured) lines.push('There are no measured colors yet, so generated sections cannot be checked for readable contrast.');
      }
      lines.push(
        `Last scan: ${lastScan.crawlAt ? `site crawl ${lastScan.crawlAt}` : 'no site crawl yet'}${lastScan.editorAt ? `; editor ${lastScan.editorAt}` : ''}.`,
      );
      if (!audit) lines.push('Site audit: unavailable right now.');
      else if (audit.score !== null) lines.push(`Site audit score: ${audit.score}/100${audit.auditedAt ? ` (${audit.auditedAt})` : ''}${audit.checking ? ', re-checking now' : ''}.`);
      else lines.push(audit.checking ? 'Site audit: running now.' : 'Site audit: no score yet.');
      return text(lines.join('\n'), { colorsMeasured, roles, lastScan, audit });
    }),
  );

  // 6. get_region_history ────────────────────────────────────────────────────
  server.registerTool(
    'get_region_history',
    {
      title: 'Region history',
      description:
        "A region's published versions over time (newest first, which one is live) and whether the region is still found on the live page. " +
        'Get the region id from list_components.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema, regionId: z.string().describe("The region's id (the slot id shown by list_components)") },
      outputSchema: {
        regionId: z.string(),
        currentVersion: z.number(),
        versions: z.array(z.object({ version: z.number(), publishedAt: z.string().nullable(), isCurrent: z.boolean() })),
        recentDecisions: z.array(z.object({ action: z.string(), at: z.string().nullable() })),
        drift: z.object({ verdict: z.string(), message: z.string(), checkedUrl: z.string().nullable() }).nullable()
          .describe('Whether the region is still found on the live page; null when the check could not run'),
      },
      annotations: READ_ONLY,
    },
    withApiErrorGuidance(async ({ projectId, regionId }: { projectId: string; regionId: string }) => {
      const base = `/projects/${encodeURIComponent(projectId)}/slot-definitions/${encodeURIComponent(regionId)}`;
      const [histR, driftR] = await Promise.all([
        settled(client.get<HistoryResponse>(`${base}/history`)),
        settled(client.get<DriftResponse>(`${base}/drift`)),
      ]);
      throwIfNotDegradable([histR, driftR]);
      // The drift check fetches the live page and may fail on its own; the
      // history is the payload, so only its failure is fatal.
      if (!histR.ok) throw histR.error;
      const h = histR.value;
      const versions = (h.versions ?? []).map((v) => ({ version: v.version, publishedAt: v.created_at ?? null, isCurrent: v.isCurrent === true }));
      const recentDecisions = (h.decisions ?? []).slice(0, 10).map((d) => ({ action: d.action ?? 'unknown', at: d.created_at ?? null }));
      const drift = driftR.ok && driftR.value.verdict
        ? { verdict: driftR.value.verdict, message: driftR.value.message ?? '', checkedUrl: driftR.value.checkedUrl ?? null }
        : null;
      const lines = [
        `Region ${untrusted(regionId)}: ${versions.length} published version${versions.length === 1 ? '' : 's'}, live is v${h.currentVersion ?? 0}.`,
        ...versions.map((v) => `  - v${v.version}${v.isCurrent ? ' (live)' : ''}${v.publishedAt ? ` published ${v.publishedAt}` : ''}`),
        drift ? `On the live page: ${drift.message || drift.verdict}` : 'On the live page: could not be checked right now.',
      ];
      return text(lines.join('\n'), { regionId, currentVersion: h.currentVersion ?? 0, versions, recentDecisions, drift });
    }),
  );
}
