import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { projectIdSchema, untrusted, UNTRUSTED_FIELDS_NOTE, withApiErrorGuidance } from './common.js';

// Empty-cell generation surface (spec 2026-09-08 empty-cell-generation §8):
// the persona × slot matrix, one cell's story, and the generate trigger — the
// same endpoints the dashboard's "Who sees what" page uses, so chat and UI
// always agree.

const personaOutput = z.object({
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  share: z.number().describe('Fraction of 30-day decided sessions'),
});
const cellOutput = z.object({
  slotId: z.string(),
  persona: z.string(),
  status: z.string().describe('pending | generating | live | error | rejected'),
  requestedBy: z.string(),
  armId: z.string().nullable(),
  rationale: z.string().nullable(),
  error: z.string().nullable(),
  updatedAt: z.string(),
  performance: z
    .object({
      shown: z.number(),
      conversions: z.number(),
      deltaPct: z.number().nullable().describe('Signed % vs the original conversion rate'),
      tier: z.string().describe('early | no_baseline | winning | losing | flat'),
    })
    .optional()
    .describe('Present on live cells: the at-a-glance readout'),
});

export function registerCellTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_cell_matrix',
    {
      title: 'Persona × slot cell matrix',
      description:
        'The "Who sees what" matrix: which visitor types (personas) have an AI-generated version live in each personalizable region (slot), with per-persona traffic share and the first-miss auto-fill setting. A cell with no row means that visitor type sees the original.' +
        UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        slots: z.array(z.object({ slotId: z.string(), displayName: z.string(), supportsForms: z.boolean() })),
        personas: z.array(personaOutput),
        cells: z.array(cellOutput),
        autoFill: z.boolean(),
        personaSource: z.string().describe("Active persona-set source: default | declared | discovered"),
        undecidedShare: z.number(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        slots: Array<{ slotId: string; displayName: string; supportsForms: boolean }>;
        personas: Array<{ key: string; displayName: string; description: string | null; share: number }>;
        cells: Array<z.infer<typeof cellOutput>>;
        autoFill: boolean;
        personaSource: string;
        undecidedShare: number;
      }>(`/projects/${id}/cells`);

      const byCell = new Map(data.cells.map((c) => [`${c.slotId}::${c.persona}`, c]));
      const lines: string[] = [
        `Slots: ${data.slots.map((s) => untrusted(s.displayName)).join(', ') || '(none published)'}`,
        `Auto-fill on first miss: ${data.autoFill ? 'ON' : 'off'} · persona source: ${data.personaSource}`,
      ];
      for (const p of data.personas) {
        const states = data.slots.map((s) => {
          const c = byCell.get(`${s.slotId}::${p.key}`);
          return `${untrusted(s.displayName, 40)}: ${c ? c.status : 'original'}`;
        });
        lines.push(`- ${untrusted(p.displayName)} (${Math.round(p.share * 100)}% of visitors) — ${states.join(' · ')}`);
      }
      lines.push(`Undecided visitors (${Math.round(data.undecidedShare * 100)}%) always see the original.`);

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: data,
      };
    }),
  );

  server.registerTool(
    'get_cell_detail',
    {
      title: 'Cell story',
      description:
        "One cell's full story: the generated option a visitor type sees in a slot, why it was written (the stored generation rationale), and how it is performing vs the original (deterministic plain-language verdict)." +
        UNTRUSTED_FIELDS_NOTE,
      inputSchema: {
        projectId: projectIdSchema,
        slotId: z.string().min(1).max(128).describe('The slot id (a matrix column)'),
        persona: z.string().min(1).max(64).describe('The persona key (a matrix row)'),
      },
      outputSchema: {
        cell: cellOutput.nullable(),
        arm: z
          .object({
            id: z.string(),
            displayName: z.string().nullable(),
            content: z.string().nullable(),
            blocks: z.unknown().nullable(),
          })
          .nullable(),
        performance: z
          .object({
            shown: z.number(),
            conversions: z.number(),
            conversionRate: z.number(),
            baselineShown: z.number(),
            baselineConversions: z.number(),
            baselineConversionRate: z.number(),
          })
          .nullable(),
        verdict: z.string(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, slotId, persona }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        cell: z.infer<typeof cellOutput> | null;
        arm: { id: string; displayName: string | null; content: string | null; blocks: unknown | null } | null;
        performance: { shown: number; conversions: number } | null;
        verdict: string;
      }>(`/projects/${id}/cells/detail?slotId=${encodeURIComponent(slotId)}&persona=${encodeURIComponent(persona)}`);

      const lines: string[] = [];
      if (data.arm) {
        lines.push(
          data.arm.content !== null
            ? `They see: "${untrusted(data.arm.content, 300)}"`
            : `They see a designed layout (option ${untrusted(data.arm.id, 64)}).`,
        );
      } else {
        lines.push('No generated version is live for this cell.');
      }
      if (data.cell?.rationale) lines.push(`Why this exists: ${untrusted(data.cell.rationale, 500)}`);
      if (data.cell?.error) lines.push(`Last attempt failed: ${untrusted(data.cell.error, 300)}`);
      lines.push(data.verdict);
      if (data.performance) {
        lines.push(`Shown ${data.performance.shown} times, ${data.performance.conversions} conversions.`);
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: data,
      };
    }),
  );

  server.registerTool(
    'generate_cell',
    {
      title: 'Generate a cell version',
      description:
        'Queue AI generation of a version for one (persona, slot) cell. The worker writes it asynchronously (usually under a minute), brand-locked, and it goes live as a named option the optimizer explores. Also works to regenerate or retry a failed cell. Requires a paid plan (anonymous demo tokens are read-only).',
      inputSchema: {
        projectId: projectIdSchema,
        slotId: z.string().min(1).max(128).describe('The slot id (a matrix column)'),
        persona: z.string().min(1).max(64).describe('The persona key (a matrix row)'),
      },
      outputSchema: {
        slotId: z.string(),
        persona: z.string(),
        status: z.literal('pending').describe('Queued — check get_cell_matrix for progress'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, slotId, persona }) => {
      const id = encodeURIComponent(projectId);
      await client.post(`/projects/${id}/cells/generate`, { slotId, persona });
      return {
        content: [
          {
            type: 'text' as const,
            text: `Writing a version of ${untrusted(slotId, 64)} for ${untrusted(persona, 64)} — it usually goes live in under a minute. Check get_cell_matrix (status flips pending → live) or get_cell_detail for the story once it lands.`,
          },
        ],
        structuredContent: { slotId, persona, status: 'pending' as const },
      };
    }),
  );
}
