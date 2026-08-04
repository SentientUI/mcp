import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { projectIdSchema, withApiErrorGuidance } from './common.js';

const PLAN_GATE_GUIDANCE = {
  agent_analytics_requires_paid_plan:
    'Agent analytics requires a paid SentientUI plan (Starter or above). Upgrade at https://sentient-ui.com, then try again.',
};

type Summary = {
  totals: { crawler: number; api: number; browser: number };
  engines: Array<{ engine: string; intent: string; count: number; sharePct: number; lastSeen: string; firstSeenInRange: boolean }>;
  topPaths: Array<{ path: string; count: number; engines: number }>;
  daily: Array<{ day: string; crawler: number; api: number; browser: number }>;
  intents: { user: number; search: number; training: number; other: number };
};

type Legibility = {
  paths: Array<{
    path: string;
    score: number;
    checks: { price: boolean; name: boolean; positioning: boolean; cta: boolean; notes: string[] };
    fixes?: Array<{ check: string; advice: string; snippet?: string }>;
    lastChecked: string;
  }>;
  emptyBlocks: Array<{ block: string; variant: string; occurrences: number }>;
};

export function registerAgentTrafficTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_agent_traffic',
    {
      title: 'Agent traffic',
      description:
        'Which AI agents and crawlers are reading this site: totals by type (passive crawlers, agentic browsers, agent API calls), engine breakdown, and the paths they fetch most. Agent traffic is tracked separately and never counted in conversion rate.',
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        totals: z.object({ crawler: z.number(), api: z.number(), browser: z.number() }),
        engines: z.array(
          z.object({
            engine: z.string(), intent: z.string().describe('user | search | training | other'),
            count: z.number(), sharePct: z.number(),
            lastSeen: z.string(), firstSeenInRange: z.boolean().describe('First observed within the queried period'),
          }),
        ),
        intents: z.object({ user: z.number(), search: z.number(), training: z.number(), other: z.number() })
          .describe('Crawler fetches by purpose: user = an assistant answering a real person live'),
        topPaths: z.array(z.object({ path: z.string(), count: z.number(), engines: z.number() })),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId }: { projectId: string }) => {
      const id = encodeURIComponent(projectId);
      const s = await client.get<Summary>(`/projects/${id}/agent-activity/summary`);
      const structuredContent = { totals: s.totals, engines: s.engines, intents: s.intents, topPaths: s.topPaths };

      const total = s.totals.crawler + s.totals.api + s.totals.browser;
      if (total === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No agent traffic observed yet. Passive crawlers (GPTBot, ClaudeBot, …) run no JavaScript — wrap your app in AdaptiveRoot from @sentientui/react/next to capture their fetches server-side.',
          }],
          structuredContent,
        };
      }

      const lines = [
        `Agent traffic: ${s.totals.crawler} crawler fetches, ${s.totals.api} agent API calls, ${s.totals.browser} agentic browser sessions.`,
        `Live user fetches: ${s.intents.user} · Search index: ${s.intents.search} · Training: ${s.intents.training}${s.intents.other ? ` · Other: ${s.intents.other}` : ''} (a "live user fetch" = an AI assistant reading your site to answer a real person).`,
        '',
        'Engines:',
        ...s.engines.map((e) => `- ${e.engine}: ${e.count} fetches (${e.sharePct}%)${e.firstSeenInRange ? ' — NEW this period' : ''}`),
        '',
        'Most-fetched paths:',
        ...s.topPaths.map((p) => `- ${p.path}: ${p.count} fetches by ${p.engines} engine(s)`),
      ];
      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
    }, PLAN_GATE_GUIDANCE),
  );

  server.registerTool(
    'get_agent_legibility',
    {
      title: 'Agent legibility',
      description:
        'Whether the pages AI agents actually read are machine-legible: per-path checks for price, product name, positioning, and CTA in the server HTML, plus agent API blocks served without agent data. Each failure comes with a concrete fix.',
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        paths: z.array(
          z.object({
            path: z.string(),
            score: z.number().describe('0–100, 25 per passing check'),
            checks: z.object({
              price: z.boolean(), name: z.boolean(), positioning: z.boolean(), cta: z.boolean(),
              notes: z.array(z.string()),
            }),
            fixes: z.array(z.object({
              check: z.string(), advice: z.string(), snippet: z.string().optional(),
            })).optional().describe('Concrete Next.js remediation per failing check'),
            lastChecked: z.string(),
          }),
        ),
        emptyBlocks: z.array(z.object({ block: z.string(), variant: z.string(), occurrences: z.number() })),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId }: { projectId: string }) => {
      const id = encodeURIComponent(projectId);
      const l = await client.get<Legibility>(`/projects/${id}/agent-activity/legibility`);
      const structuredContent = { paths: l.paths, emptyBlocks: l.emptyBlocks };

      if (l.paths.length === 0 && l.emptyBlocks.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No legibility results yet — they appear once AI crawlers start fetching pages (checked daily).' }],
          structuredContent,
        };
      }

      const lines = [
        'Legibility of agent-read paths:',
        ...l.paths.map((p) => {
          const failed = (['price', 'name', 'positioning', 'cta'] as const).filter((k) => !p.checks[k]);
          return `- ${p.path}: ${p.score}/100${failed.length ? ` — missing: ${failed.join(', ')}` : ' — fully legible'}`;
        }),
        ...l.paths.flatMap((p) =>
          p.fixes?.length
            ? p.fixes.map((f) => `  fix (${p.path}): ${f.advice}`)
            : p.checks.notes.map((n) => `  fix (${p.path}): ${n}`),
        ),
      ];
      if (l.emptyBlocks.length > 0) {
        lines.push('', 'Agent API blocks served without agent data (add agentDataByVariant):');
        lines.push(...l.emptyBlocks.map((b) => `- ${b.block} (variant ${b.variant}): ${b.occurrences} calls`));
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
    }, PLAN_GATE_GUIDANCE),
  );
}
