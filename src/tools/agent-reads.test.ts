import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient, ApiError } from '../api-client.js';
import { registerAgentReadTools } from './agent-reads.js';

const P = '11111111-1111-4111-8111-111111111111';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler; config: any }> = {};
  return {
    registerTool: vi.fn((name: string, config: unknown, handler: ToolHandler) => { tools[name] = { handler, config }; }),
    tools,
  };
}

/** Spy on client.get, answering by path prefix; returns the list of paths called. */
function setup(routes: Record<string, unknown>) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  const get = vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
    const key = Object.keys(routes).find((k) => path.startsWith(`/projects/${P}/${k}`));
    if (key === undefined) throw new ApiError(404, 'not_found');
    const v = routes[key];
    if (v instanceof Error) throw v;
    return v as any;
  });
  const server = makeServer();
  registerAgentReadTools(server as any, client);
  return { server, get, paths: () => get.mock.calls.map((c) => c[0] as string) };
}

describe('agent read tools registration', () => {
  it('registers the six tools, all read-only', () => {
    const { server } = setup({});
    expect(Object.keys(server.tools).sort()).toEqual(
      ['get_agent_access', 'get_audiences', 'get_region_history', 'get_retargeting_report', 'get_site_styles', 'list_campaigns'],
    );
    for (const t of Object.values(server.tools)) expect(t.config.annotations.readOnlyHint).toBe(true);
  });
});

describe('get_agent_access', () => {
  it('reports areas and says in words which are off', async () => {
    const areas = { generate: true, approve: false, tests: true, goals: true, campaigns: false, settings: true };
    const { server, paths } = setup({ 'agent-access': { areas, canEdit: true } });
    const r = await server.tools['get_agent_access']!.handler({ projectId: P });
    expect(paths()).toEqual([`/projects/${P}/agent-access`]);
    expect(r.structuredContent).toEqual({ areas, canEdit: true });
    expect(r.content[0]!.text).toContain('Approve and publish is off');
    expect(r.content[0]!.text).toContain('Campaigns and audiences is off');
    expect(r.content[0]!.text).toContain('Settings → Agent access');
    expect(r.content[0]!.text).not.toContain('Generate is off');
  });

  it('says everything is on when nothing is switched off', async () => {
    const areas = { generate: true, approve: true, tests: true, goals: true, campaigns: true, settings: true };
    const { server } = setup({ 'agent-access': { areas, canEdit: false } });
    const r = await server.tools['get_agent_access']!.handler({ projectId: P });
    expect(r.content[0]!.text).toContain('All areas are on');
  });
});

describe('list_campaigns', () => {
  const campaign = {
    id: 'c1', personaKey: 'c-spring', name: 'Spring sale', match: { campaign: 'spring' }, arrivalType: 'offer',
    goalId: null, landingPaths: ['/sale'], promise: null, discountCode: null, status: 'running', startsAt: '2026-10-01T00:00:00Z', endsAt: null,
  };

  it('lists named campaigns, retargeting groups and observed traffic', async () => {
    const { server, paths } = setup({
      campaigns: {
        named: [campaign],
        retargeting: [{ id: 'g1', campaignId: 'c1', personaKey: 'r-spring', name: 'Spring sale', status: 'running', startsAt: 'a', endsAt: 'b', memberCount: 12 }],
        observed: [{ campaign: 'spring', sessions: 40, carted: 0, paid: 0, channel: 'email', platform: null, tag: null, suggested: null }],
      },
    });
    const r = await server.tools['list_campaigns']!.handler({ projectId: P, range: '7d' });
    expect(paths()).toEqual([`/projects/${P}/campaigns?range=7d`]);
    const sc = r.structuredContent as any;
    expect(sc.campaigns[0].id).toBe('c1');
    expect(sc.retargeting[0].groupId).toBe('g1');
    expect(r.content[0]!.text).toContain('`Spring sale`');
  });

  it("shows one campaign's card when campaignId is given", async () => {
    const report = {
      clicks: 50, servedAsCampaign: 30, alreadyKnown: [], servedOtherwise: 5, controlGroup: 15,
      versions: [{ label: 'Original', shown: 10, conversions: 1, effect: null }, { label: 'Spring', shown: 20, conversions: 4, effect: null }],
      newPeople: 28, cameBack: 6, becameGroups: [], retargeting: { groupId: 'g1', label: 'Retargeting: Spring sale', status: 'running', endsAt: 'x' },
    };
    const { server, paths } = setup({ 'campaigns/c1/report': { campaign, report } });
    const r = await server.tools['list_campaigns']!.handler({ projectId: P, campaignId: 'c1' });
    expect(paths()).toEqual([`/projects/${P}/campaigns/c1/report`]);
    const sc = r.structuredContent as any;
    expect(sc.card).toMatchObject({ clicks: 50, people: 28, controlGroup: 15, cameBack: 6 });
    // Version rows are per section and arm: summing them would inflate conversions.
    expect(sc.card).not.toHaveProperty('conversions');
    expect(sc.card.versions).toHaveLength(2);
    expect(r.content[0]!.text).not.toMatch(/d+ conversions/);
    expect(r.content[0]!.text).toContain('control group');
    // An API from before the verdict: null, and no verdict line.
    expect(sc.card.vsControl).toBeNull();
    expect(r.content[0]!.text).not.toMatch(/Not proven yet|Helping|Hurting/);
  });

  it("carries the campaign's verdict against the control group, in readable fields and plain words", async () => {
    const vsControl = {
      goal: { id: 'signup', name: 'Sign-up' },
      sentient: { people: 2700, conversions: 113 },
      control: { people: 300, conversions: 9 },
      rates: { sentient: 0.04185, control: 0.03 },
      interval: { lo: -0.008, hi: 0.0212 },
      verdict: 'not_proven',
      moreNeeded: 174000,
      minPeoplePerSide: 100,
      epochs: 1,
      splitCheck: 'ok',
    };
    const report = {
      clicks: 3200, servedAsCampaign: 2500, alreadyKnown: [], servedOtherwise: 0, controlGroup: 320,
      versions: [], newPeople: 2400, cameBack: 300, becameGroups: [], retargeting: null, vsControl,
    };
    const { server } = setup({ 'campaigns/c1/report': { campaign, report } });
    const r = await server.tools['list_campaigns']!.handler({ projectId: P, campaignId: 'c1' });
    const sc = r.structuredContent as any;
    expect(sc.card.vsControl).toEqual({
      verdict: 'not_proven',
      goal: 'Sign-up',
      sentient: { people: 2700, conversions: 113 },
      control: { people: 300, conversions: 9 },
      per100People: { sentient: 4.2, control: 3 },
      differencePer100People: { low: -0.8, high: 2.12 },
      morePeopleNeeded: 174000,
      splitMismatch: false,
    });
    const text = r.content[0]!.text;
    expect(text).toContain('Against the control group, on `Sign-up`: Not proven yet.');
    expect(text).toContain('Difference likely between -0.8 and +2.1 per 100 people');
    expect(text).toContain('do not report it as a lean');
    expect(text).toContain('already-known visitors included');
    expect(text).toContain('About 174000 more clickers');
  });
});

describe('get_retargeting_report', () => {
  it('returns who came back, clicks and conversions', async () => {
    const group = { id: 'g1', campaignId: 'c1', personaKey: 'r-x', name: 'Spring sale', status: 'ended', startsAt: 'a', endsAt: 'b', memberCount: 20 };
    const { server, paths } = setup({
      'retargeting/g1/report': { group, report: { members: 20, cameBack: 7, converted: 3, clicks: 9, versions: [] } },
    });
    const r = await server.tools['get_retargeting_report']!.handler({ projectId: P, groupId: 'g1' });
    expect(paths()).toEqual([`/projects/${P}/retargeting/g1/report`]);
    expect(r.structuredContent).toMatchObject({ members: 20, cameBack: 7, converted: 3, clicks: 9 });
    expect(r.content[0]!.text).toContain('7 of 20 came back');
  });
});

describe('get_audiences', () => {
  const discovered = {
    set: {
      version: 3,
      members: [
        { key: 'd-audience_1', displayName: 'Navigation-focused direct visitors', sessions: 120, trafficShare: 0.4, evidence: { status: 'insufficient_sample' } },
        { key: 'd-audience_2', displayName: 'Deal hunters', sessions: 90, trafficShare: 0.3, evidence: { status: 'validated_strong' } },
      ],
    },
    readiness: {},
  };

  it('reads the declared set, the discovered set and the promotion check, with blockers in plain words', async () => {
    const { server, paths } = setup({
      'personas/discovered': discovered,
      'personas/promotion': { eligible: false, blockers: ['segment_insufficient_sample:d-audience_1', 'candidate_too_small'], candidate: null, active: null },
      personas: { source: 'declared', version: 2, members: [{ key: 'buyer', displayName: 'Buyer', description: null, aliases: [], status: 'active' }] },
    });
    const r = await server.tools['get_audiences']!.handler({ projectId: P });
    expect(paths().sort()).toEqual([`/projects/${P}/personas`, `/projects/${P}/personas/discovered`, `/projects/${P}/personas/promotion`].sort());
    const sc = r.structuredContent as any;
    expect(sc.promotion.eligible).toBe(false);
    expect(sc.declared.members[0].key).toBe('buyer');
    expect(sc.discovered.members[0].evidence).toBe('not_enough_data');
    expect(sc.promotion.blockers[0]).toBe('not enough data yet for Navigation-focused direct visitors');
    expect(r.content[0]!.text).toContain('not enough data yet for Navigation-focused direct visitors');
    expect(r.content[0]!.text).not.toContain('insufficient_sample');
  });
});

describe('get_site_styles', () => {
  const entry = (computed: Record<string, string>) => ({
    id: 'button', role: 'button', classes: 'btn', source: 'crawl', computed, seen: { url: '/', count: 2, at: '2026-10-30T00:00:00Z' },
  });

  it('says there are no measured colors when every computed is empty', async () => {
    const { server, paths } = setup({
      'style-vocabulary': { rev: 'r', entries: [entry({}), { ...entry({}), id: 'button-2' }], images: [], sources: { editorAt: null, crawlAt: '2026-10-30T00:00:00Z' } },
      'site-audit': { status: 'complete', overallScore: 82, auditedAt: '2026-10-29T00:00:00Z', checking: false },
    });
    const r = await server.tools['get_site_styles']!.handler({ projectId: P });
    expect(paths().sort()).toEqual([`/projects/${P}/site-audit`, `/projects/${P}/style-vocabulary`].sort());
    const sc = r.structuredContent as any;
    expect(sc.colorsMeasured).toBe(false);
    expect(sc.roles[0].role).toBe('button');
    expect(sc.audit.score).toBe(82);
    expect(r.content[0]!.text).toContain('no measured colors');
  });

  it('notes measured colors when an entry has them', async () => {
    const { server } = setup({
      'style-vocabulary': { rev: 'r', entries: [entry({ color: '#fff', bg: '#000' })], images: [], sources: { editorAt: null, crawlAt: null } },
      'site-audit': { status: 'pending', crawlable: true, checking: true },
    });
    const r = await server.tools['get_site_styles']!.handler({ projectId: P });
    expect((r.structuredContent as any).colorsMeasured).toBe(true);
    expect(r.content[0]!.text).not.toContain('no measured colors');
  });

  it('still answers when the audit is unavailable', async () => {
    const { server } = setup({
      'style-vocabulary': { rev: 'r', entries: [], images: [], sources: { editorAt: null, crawlAt: null } },
      'site-audit': new ApiError(500, 'boom'),
    });
    const r = await server.tools['get_site_styles']!.handler({ projectId: P });
    expect((r.structuredContent as any).audit).toBeNull();
  });
});

describe('get_region_history', () => {
  it('returns published versions and the drift verdict', async () => {
    const { server, paths } = setup({
      'slot-definitions/hero/history': {
        currentVersion: 2,
        versions: [{ version: 2, published_by: 'u', created_at: '2026-10-02T00:00:00Z', isCurrent: true }, { version: 1, published_by: 'u', created_at: '2026-10-01T00:00:00Z', isCurrent: false }],
        decisions: [],
      },
      'slot-definitions/hero/drift': { verdict: 'missing', message: 'Not found on the page any more.', checkedUrl: 'https://x.test/' },
    });
    const r = await server.tools['get_region_history']!.handler({ projectId: P, regionId: 'hero' });
    expect(paths().sort()).toEqual([`/projects/${P}/slot-definitions/hero/drift`, `/projects/${P}/slot-definitions/hero/history`].sort());
    const sc = r.structuredContent as any;
    expect(sc.currentVersion).toBe(2);
    expect(sc.versions).toHaveLength(2);
    expect(sc.drift.verdict).toBe('missing');
    expect(r.content[0]!.text).toContain('Not found on the page any more');
  });

  it('surfaces an access refusal as guidance rather than hiding it', async () => {
    const { server } = setup({
      'slot-definitions/hero/history': new ApiError(403, 'agent_access_off', 'Agent access to X is off'),
      'slot-definitions/hero/drift': new ApiError(403, 'agent_access_off'),
    });
    const r = await server.tools['get_region_history']!.handler({ projectId: P, regionId: 'hero' });
    expect(r.isError).toBe(true);
  });
});
