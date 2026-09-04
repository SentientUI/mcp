import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { uiMeta } from '../ui/index.js';
import {
  projectIdSchema,
  rangeInputSchema,
  rangeQuery,
  windowOutputSchema,
  windowLine,
  withApiErrorGuidance,
  fetchAllComponents,
  untrusted,
  UNTRUSTED_FIELDS_NOTE,
  type RangeArgs,
} from './common.js';

export function registerComponentTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'list_components',
    {
      title: 'List components',
      description:
        'List all adaptive components in a project with variant counts and impression totals. ' +
        'Counts cover all retained data by default; pass range or from/to for a window.' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema, ...rangeInputSchema('all') },
      outputSchema: {
        components: z
          .array(
            z.object({
              componentId: z.string(),
              variantCount: z.number(),
              impressions: z.number(),
              conversions: z.number(),
            }),
          )
          .describe('Adaptive components in the project (empty if none)'),
        total: z.number().describe('Total components in the project — larger than the list when truncated'),
        truncated: z.boolean().describe('True when the fetch cap was hit before listing every component'),
        window: windowOutputSchema,
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async ({ projectId, range, from, to }: { projectId: string } & RangeArgs) => {
      // "List all" used to destructure the first page of a paginated envelope
      // (API default: 50/page), so a project's 51st component silently never
      // existed as far as any agent could tell. Fetch every page (bounded) and
      // say so when the bound cuts the list short.
      const { components, total, window, truncated } = await fetchAllComponents<{
        component_id: string;
        total_impressions: number;
        total_conversions: number;
        variants: Array<{ variant_id: string }>;
      }>(client, projectId, { rangeArgs: { range, from, to } });

      const structuredContent = {
        components: components.map((c) => ({
          componentId: c.component_id,
          variantCount: c.variants.length,
          impressions: c.total_impressions,
          conversions: c.total_conversions,
        })),
        total,
        truncated,
        window,
      };

      if (!components.length) {
        return {
          content: [{ type: 'text' as const, text: 'No components found for this project.' }],
          structuredContent,
        };
      }

      // Component ids come from the page (and from the public ingest path), so
      // they are visitor-mintable strings — delimit them (see untrusted()).
      const lines = components.map((c) =>
        `- ${untrusted(c.component_id)}: ${c.variants.length} variants, ${c.total_impressions} impressions, ${c.total_conversions} conversions`
      );
      if (truncated) {
        lines.push(`Showing ${components.length} of ${total} components — fetch cap reached; the rest exist but are not listed here.`);
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
    }),
  );

  server.registerTool(
    'get_variant_performance',
    {
      title: 'Variant performance',
      description:
        'Get CVR and momentum for all variants in a project over the selected window vs the ' +
        'immediately-preceding window of equal length (default: last 7 calendar days vs prior 7).' + UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema, ...rangeInputSchema('7d') },
      _meta: uiMeta('variant-performance'),
      outputSchema: {
        variants: z
          .array(
            z.object({
              variantId: z.string(),
              currentCvr: z.number().describe('Conversion rate over the selected window (0-1)'),
              priorCvr: z.number().describe('Conversion rate over the preceding window (0-1)'),
              deltaPp: z.number().describe('Change in percentage points'),
              momentum: z.string().describe('Momentum direction: gaining, losing, or stable'),
            }),
          )
          .describe('Per-variant performance (empty if no data yet)'),
        window: windowOutputSchema,
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async ({ projectId, range, from, to }: { projectId: string } & RangeArgs) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        cvr: Array<{
          variantId: string;
          currentCvr: number;
          priorCvr: number;
          deltaPp: number;
        }>;
        momentum: Array<{
          variantId: string;
          direction: string;
        }>;
        window?: NonNullable<z.infer<typeof windowOutputSchema>>;
      }>(`/projects/${id}/trends${rangeQuery({ range, from, to })}`);

      const momentumMap = new Map((data.momentum ?? []).map((m) => [m.variantId, m.direction]));
      const structuredContent = {
        variants: (data.cvr ?? []).map((v) => ({
          variantId: v.variantId,
          currentCvr: v.currentCvr,
          priorCvr: v.priorCvr,
          deltaPp: v.deltaPp,
          momentum: momentumMap.get(v.variantId) ?? 'stable',
        })),
        window: data.window,
      };

      if (!data.cvr?.length) {
        return {
          content: [{ type: 'text' as const, text: 'No variant data available yet.' }],
          structuredContent,
          _meta: uiMeta('variant-performance'),
        };
      }

      // Variant ids are visitor-mintable via the public ingest path — delimit.
      const lines = data.cvr.map((v) =>
        `- ${untrusted(v.variantId)}: CVR ${(v.currentCvr * 100).toFixed(2)}% (prior ${(v.priorCvr * 100).toFixed(2)}%, ${v.deltaPp > 0 ? '+' : ''}${v.deltaPp.toFixed(1)} pp, ${momentumMap.get(v.variantId) ?? 'stable'})`
      );
      const win = windowLine(data.window);
      const text = (win ? [win, ...lines] : lines).join('\n');

      return { content: [{ type: 'text' as const, text }], structuredContent, _meta: uiMeta('variant-performance') };
    }),
  );
}
