import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

/** Impressions on a component before its bandit posteriors are considered settled. */
const GOAL_TARGET = 500;

type DataState = 'sufficient' | 'collecting' | 'empty';

type ProjectRow = { id: string; name: string; context_type: string };

type ComponentRow = {
  component_id: string;
  total_impressions: number;
  total_conversions: number;
  variants: Array<{ variant_id: string }>;
};

type TrendsResponse = {
  cvr?: Array<{ variantId: string; currentCvr: number; priorCvr: number; deltaPp: number }>;
  momentum?: Array<{ variantId: string; direction: string }>;
};

type PortraitsResponse = {
  clusters?: Array<{ label: string; sessionCount: number; avgReliability: number }>;
  totalSessions?: number;
};

type InsightsResponse = {
  status: 'ok' | 'empty';
  narratorBullets?: string[];
  advisorBullets?: string[];
  isStale?: boolean;
};

// Best-practice priors applied when there is not enough data to be data-driven.
// Keyed by the project's context_type so "do what you think is best" stays
// grounded and consistent rather than arbitrary.
const BEST_PRACTICE_PRIORS: Record<string, string[]> = {
  ecommerce: [
    'Lead with the core benefit/value, not features.',
    'Make the primary action (add to cart / buy) unmistakable and high-contrast.',
    'Reduce purchase anxiety near the decision: free returns, shipping, secure checkout, guarantees.',
    'Add credible social proof (ratings, review count, "X sold").',
    'Use urgency/scarcity only when it is genuinely true (low stock, real deadline).',
    'Cut friction: fewer steps, clearer pricing, no surprise costs.',
  ],
  saas: [
    'Lead with the outcome the user gets, not the mechanism.',
    'Make the primary CTA action-oriented and specific (e.g. "Start free trial").',
    'Reduce signup friction (fewer fields, SSO, "no credit card required").',
    'Add proof near the CTA: customer logos, a hard metric, a short testimonial.',
    "Address the target persona's top objection inline.",
  ],
  landing: [
    'One clear message and one primary action above the fold.',
    'Match the headline to the traffic source / campaign intent.',
    'Make the CTA specific and benefit-led.',
    'Add a single strong proof point; remove competing distractions.',
  ],
  marketplace: [
    'Reduce choice overload: guide the visitor to a clear next step.',
    'Surface trust and liquidity signals (ratings, counts, recency).',
    'Make the primary action on each listing obvious.',
    'Reassure on safety/guarantees near the point of decision.',
  ],
};

const GENERIC_PRIORS = [
  'Make the primary action unmistakable and benefit-led.',
  'Lead with the outcome/value for the visitor.',
  'Remove friction and distractions around the decision.',
  'Add one credible proof point near the action.',
];

function priorsFor(contextType: string): string[] {
  return BEST_PRACTICE_PRIORS[contextType] ?? GENERIC_PRIORS;
}

function computeDataState(
  impressions: number,
  insights: InsightsResponse | null,
  avgReliability: number | null,
): DataState {
  if (impressions === 0) return 'empty';
  const insightsReady = insights?.status === 'ok' && !insights.isStale;
  const reliable = avgReliability === null || avgReliability >= 0.3;
  if (impressions < GOAL_TARGET || !insightsReady || !reliable) return 'collecting';
  return 'sufficient';
}

function guidanceFor(dataState: DataState, contextType: string): string {
  switch (dataState) {
    case 'sufficient':
      return 'There is enough data. Target the specific weakness above — the underperforming variant/persona — with your change. Set basis to the signal you used.';
    case 'collecting':
      return 'Limited data so far. Lean on the best-practice priors below, lightly informed by the early signal. Make one focused change rather than a redesign.';
    case 'empty':
      return `No data yet — use your best judgment. Apply the best-practice priors for a ${contextType} surface below. Make one conservative, high-confidence change, and consider enabling shadow mode for this component so it is validated before it serves real traffic.`;
  }
}

async function settled<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export function registerVariantBriefTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_variant_brief',
    {
      title: 'Variant brief',
      description: 'Get an insight-driven brief for creating a new CODE-NATIVE variant of a component. Returns current variant performance, audience, insights, a data-sufficiency assessment (with a best-practice fallback when there is no data yet), and step-by-step instructions for writing the variant in the customer\'s code. Use this instead of create_variant when the variant will live in the codebase.',
      inputSchema: {
        projectId: projectIdSchema,
        componentId: z.string().describe('The component ID to write a new variant for (matches <Adaptive id="...">).'),
      },
      outputSchema: {
        componentId: z.string(),
        contextType: z.string().describe("The project's context type (or 'unknown')"),
        dataState: z.enum(['sufficient', 'collecting', 'empty']).describe('Data-sufficiency assessment'),
        existingVariantIds: z.array(z.string()).describe('Variant IDs already in use (do not reuse)'),
        priors: z.array(z.string()).describe('Best-practice priors applied for this context type'),
        markdown: z.string().describe('The full variant brief in Markdown'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, componentId }) => {
      const id = encodeURIComponent(projectId);

      const [projects, components, trends, portraits, insights] = await Promise.all([
        settled(client.get<ProjectRow[]>('/projects')),
        settled(client.get<ComponentRow[]>(`/projects/${id}/components`)),
        settled(client.get<TrendsResponse>(`/projects/${id}/trends`)),
        settled(client.get<PortraitsResponse>(`/projects/${id}/portraits`)),
        settled(client.get<InsightsResponse>(`/projects/${id}/insights`)),
      ]);

      const project = projects?.find((p) => p.id === projectId) ?? null;
      const contextType = project?.context_type ?? 'unknown';

      const component = components?.find((c) => c.component_id === componentId) ?? null;
      const impressions = component?.total_impressions ?? 0;
      const conversions = component?.total_conversions ?? 0;
      const componentCvr = impressions > 0 ? (conversions / impressions) * 100 : 0;
      const existingVariantIds = component?.variants.map((v) => v.variant_id) ?? [];

      // Per-variant performance, scoped to this component's variant IDs.
      const variantIdSet = new Set(existingVariantIds);
      const momentumMap = new Map((trends?.momentum ?? []).map((m) => [m.variantId, m.direction]));
      const variantPerf = (trends?.cvr ?? []).filter((v) => variantIdSet.has(v.variantId));

      const clusters = portraits?.clusters ?? [];
      const totalSessions = portraits?.totalSessions ?? 0;
      const avgReliability = clusters.length
        ? clusters.reduce((s, c) => s + c.avgReliability, 0) / clusters.length
        : null;

      const dataState = computeDataState(impressions, insights, avgReliability);

      const lines: string[] = [];
      lines.push(`# Variant brief — ${componentId}`);
      lines.push(`Project context type: ${contextType}`);
      lines.push('');

      if (!component) {
        lines.push(
          `Note: no component named "${componentId}" has reported data yet. If this is a new <Adaptive> you are adding, that is expected — it registers automatically on first assignment after deploy. Proceed using the best-practice priors below.`,
        );
        lines.push('');
      } else {
        lines.push(
          `Component performance: ${impressions} impressions, ${conversions} conversions, ${componentCvr.toFixed(2)}% CVR.`,
        );
        lines.push(
          `Existing variant IDs (do not reuse these): ${existingVariantIds.length ? existingVariantIds.join(', ') : '(none)'}`,
        );
        lines.push('');
      }

      if (variantPerf.length) {
        lines.push('Current variant performance (7d vs prior 7d):');
        for (const v of variantPerf) {
          lines.push(
            `- ${v.variantId}: ${(v.currentCvr * 100).toFixed(2)}% CVR (${v.deltaPp > 0 ? '+' : ''}${v.deltaPp.toFixed(1)} pp, ${momentumMap.get(v.variantId) ?? 'stable'})`,
          );
        }
        lines.push('');
      }

      if (clusters.length) {
        lines.push(`Audience (${totalSessions} sessions):`);
        for (const c of clusters) {
          const share = totalSessions > 0 ? ((c.sessionCount / totalSessions) * 100).toFixed(0) : '0';
          lines.push(`- ${c.label}: ${share}% of traffic (reliability ${(c.avgReliability * 100).toFixed(0)}%)`);
        }
        lines.push('');
      }

      if (insights && insights.status === 'ok') {
        if (insights.isStale) lines.push('⚠ Insights are stale (>6h). Consider refresh_insights for a fresher read.');
        const narrator = insights.narratorBullets ?? [];
        const advisor = insights.advisorBullets ?? [];
        if (narrator.length) {
          lines.push('Insights — observations:');
          narrator.forEach((b) => lines.push(`- ${b}`));
        }
        if (advisor.length) {
          lines.push('Insights — recommendations:');
          advisor.forEach((b) => lines.push(`- ${b}`));
        }
        lines.push('');
      } else {
        lines.push('Insights: none generated yet.');
        lines.push('');
      }

      lines.push(`## Data sufficiency: ${dataState.toUpperCase()}`);
      lines.push(guidanceFor(dataState, contextType));
      lines.push('');

      lines.push(`## Best-practice priors (${contextType})`);
      priorsFor(contextType).forEach((p) => lines.push(`- ${p}`));
      lines.push('');

      lines.push('## How to implement (code-native variant)');
      lines.push(`1. Search the repository for <Adaptive id="${componentId}"> (and any matching useAssignment("${componentId}") usage).`);
      lines.push('2. Add a new key to its `variants` map with on-brand JSX that matches the surrounding components and the project\'s design system. Pick a short, descriptive new variant id that is not in the existing list above (e.g. "value_led", "social_proof", "urgency").');
      lines.push('3. If the component is server-rendered via <AdaptiveRoot>, add the new variant id to that component\'s entry in the `components` list so it is included in SSR preloading.');
      lines.push('4. Do NOT call create_variant — that creates a separate no-code MANAGED draft. Code-native variants register automatically on the first assignment after you deploy, and go live immediately.');
      lines.push('5. Commit, push, and deploy. Optionally enable shadow mode for this component first if you want to validate before serving real traffic.');
      lines.push('');
      lines.push('Make the change reflect the data sufficiency above: data-driven when SUFFICIENT, best-practice-led when COLLECTING or EMPTY.');

      const markdown = lines.join('\n');
      return {
        content: [{ type: 'text' as const, text: markdown }],
        structuredContent: {
          componentId,
          contextType,
          dataState,
          existingVariantIds,
          priors: priorsFor(contextType),
          markdown,
        },
      };
    },
  );
}
