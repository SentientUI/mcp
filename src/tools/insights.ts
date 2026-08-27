import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { projectIdSchema, withApiErrorGuidance } from './common.js';

type ReportFinding = {
  tier: string;
  kind: string;
  headline: string;
  audience: string | null;
  interpreted: boolean;
  provenance: { sample: number; coverage: number | null; denominatorLabel: string };
};

type NextUnlock = {
  tier: string; needs: string; have: number; need: number; surface: string | null;
};

type EvidenceReport = {
  findings?: ReportFinding[];
  reached?: string;
  nextUnlock?: NextUnlock | null;
  emptyReason?: string | null;
  interpretation?: { count: number; locked: boolean; emptyReason: string | null };
  generatedAt?: string | null;
  freshness?: { isStale: boolean };
};

/** Why there is nothing to report, in the same plain language the dashboard uses.
 *  Answering "ok" beside an empty result — which this tool used to do — leaves an
 *  agent unable to tell "nothing happened" from "the job stopped running". */
const EMPTY_REASON_TEXT: Record<string, string> = {
  no_events: 'The snippet has not fired yet — nothing has reached us.',
  no_traffic_yet: 'Test traffic only so far; no genuine visitors yet.',
  awaiting_profiles: 'Still building visitor profiles before visitors can be grouped.',
  no_variants: 'Nothing to compare yet — no adaptive component is running.',
  nothing_moved: 'Enough data, and nothing moved this period. That is a result.',
  // The stale/never-ran texts name the remedy: an agent that is not told about
  // refresh_insights has no way to know it can fix this itself.
  job_never_ran: 'The analysis job has not run yet. Call refresh_insights to run it now.',
  job_stale: 'These numbers are out of date — the analysis job has not run recently. Call refresh_insights to regenerate them.',
  data_unavailable: 'The project data could not be read just now — nothing is wrong with the setup. Retry shortly.',
};

export function registerInsightTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_insights',
    {
      title: 'Get insights',
      description:
        'What is known about this project right now: ranked findings with the evidence behind each one, plus (Growth tier) advisor recommendations. Says why it is empty when it is.',
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        status: z.enum(['ok', 'empty']).describe('Whether any findings exist yet'),
        reached: z.string().describe('Highest confidence tier earned: observed | patterned | tested'),
        findings: z.array(z.object({
          tier: z.string().describe('observed | patterned | tested'),
          kind: z.string(),
          headline: z.string(),
          audience: z.string().nullable(),
          sample: z.number().describe('How many the finding is based on'),
          coverage: z.number().nullable().describe('Fraction of traffic this finding describes, when applicable'),
        })).describe('Ranked findings, each with the evidence behind it'),
        emptyReason: z.string().nullable().describe('Why there is nothing to report, when there is nothing'),
        observations: z.array(z.string()).describe('Headlines of measured findings'),
        recommendations: z.array(z.string()).describe('Headlines of interpreted findings (Growth tier)'),
        isStale: z.boolean().describe('True when the analysis has not run recently'),
        generatedAt: z.string().nullable().describe('ISO timestamp, or null'),
        nextUnlock: z.object({
          tier: z.string(), needs: z.string(), have: z.number(),
          need: z.number(), surface: z.string().nullable(),
        }).nullable().describe('The nearest gap that would raise the confidence tier, when there is one'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<EvidenceReport>(`/projects/${id}/evidence-report`);

      const findings = data.findings ?? [];
      const measured = findings.filter((f) => !f.interpreted);
      const interpreted = findings.filter((f) => f.interpreted);
      // Kept populated for callers written against the previous shape.
      const observations = measured.map((f) => f.headline);
      const recommendations = interpreted.map((f) => f.headline);

      const isStale = data.freshness?.isStale ?? false;
      const emptyReason = data.emptyReason ?? null;

      const lines: string[] = [];
      if (emptyReason) lines.push(EMPTY_REASON_TEXT[emptyReason] ?? emptyReason);
      // Staleness is not emptiness: a project can have healthy measured findings
      // beside a narrator that stopped running weeks ago, and an agent needs to
      // know which of the two it is looking at.
      if (isStale) lines.push('⚠ The analysis job has not run recently, so these numbers may have moved. Call refresh_insights to regenerate them.');
      if (data.interpretation?.locked) {
        lines.push(`${data.interpretation.count || 'Some'} recommendations are available on the Growth plan.`);
      } else if (data.interpretation?.emptyReason && !emptyReason) {
        lines.push(`Recommendations: ${EMPTY_REASON_TEXT[data.interpretation.emptyReason] ?? data.interpretation.emptyReason}`);
      }
      if (data.generatedAt) lines.push(`Generated: ${new Date(data.generatedAt).toUTCString()}`);

      const nextUnlock = data.nextUnlock ?? null;
      if (nextUnlock) {
        const remaining = nextUnlock.need - nextUnlock.have;
        const where = nextUnlock.surface ? `On ${nextUnlock.surface}: ` : '';
        lines.push(`${where}${remaining} more ${nextUnlock.needs} would unlock the next confidence level (${nextUnlock.tier}).`);
      }

      if (measured.length) {
        lines.push('', 'Findings:');
        for (const f of measured) {
          // Below half a percent, rounding said "covering 0% of visitors" under
          // a finding that plainly describes someone.
          const cov = f.provenance.coverage !== null && f.provenance.coverage < 0.999
            ? `, covering ${f.provenance.coverage < 0.005 ? 'under 1%' : `${Math.round(f.provenance.coverage * 100)}%`} of visitors`
            : '';
          lines.push(`- [${f.tier}] ${f.headline} (${f.provenance.sample} ${f.provenance.denominatorLabel}${cov})`);
        }
      }
      if (recommendations.length) {
        lines.push('', 'Recommendations:');
        for (const r of recommendations) lines.push(`- ${r}`);
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n').trim() || 'No findings yet.' }],
        structuredContent: {
          status: (findings.length ? 'ok' : 'empty') as 'ok' | 'empty',
          reached: data.reached ?? 'observed',
          findings: findings.map((f) => ({
            tier: f.tier,
            kind: f.kind,
            headline: f.headline,
            audience: f.audience,
            sample: f.provenance.sample,
            coverage: f.provenance.coverage,
          })),
          emptyReason,
          observations,
          recommendations,
          isStale,
          generatedAt: data.generatedAt ?? null,
          nextUnlock,
        },
      };
    }),
  );
}
