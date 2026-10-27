import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { projectIdSchema, settled, untrusted, UNTRUSTED_FIELDS_NOTE, withApiErrorGuidance } from './common.js';

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
  status: z.string().describe('pending | generating | review (waiting for approval) | live | error | rejected'),
  requestedBy: z.string(),
  armId: z.string().nullable(),
  rationale: z.string().nullable(),
  error: z.string().nullable(),
  updatedAt: z.string(),
  // These ride the API response too; omitting them from the schema made zod
  // STRIP them, so agents could never see refinement or retry state.
  refinedFrom: z
    .string()
    .nullable()
    .optional()
    .describe('Incumbent arm this cell is improving on — a pending cell with this set still SERVES the incumbent'),
  notBefore: z
    .string()
    .nullable()
    .optional()
    .describe('ISO time the queue will next consider this cell (retry backoff / daily-cap deferral); null when due now'),
  attempts: z.number().optional().describe('Generation attempts so far'),
  performance: z
    .object({
      shown: z.number(),
      conversions: z.number(),
      deltaPct: z.number().nullable().describe('Signed % vs the original conversion rate — a point estimate; only meaningful beside a winning/losing tier'),
      tier: z
        .string()
        .describe(
          'early | no_baseline (under 100 views) | winning | losing (posterior separated from the original, corrected across the slot column) | flat (NOT separated yet — not "equal")',
        ),
    })
    .optional()
    .describe('Present on live cells (and, mid-refinement, the incumbent arm): the at-a-glance readout'),
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
        slots: z.array(
          z.object({
            slotId: z.string(),
            displayName: z.string(),
            supportsForms: z.boolean(),
            // API sends this; without it zod stripped the draft-vs-live signal.
            live: z
              .boolean()
              .optional()
              .describe('False for an sdk-registered draft column — nothing serves until its first generation publishes it'),
          }),
        ),
        personas: z.array(personaOutput),
        cells: z.array(cellOutput),
        autoFill: z.boolean(),
        // The API has always sent this; without it in the schema zod stripped
        // it, and generate_cell had no way to know a version would wait for a
        // human instead of publishing.
        reviewMode: z
          .boolean()
          .optional()
          .describe('True when generated versions wait for approval (review_cell) instead of publishing automatically'),
        // Nullable: a project with no persona set at all reports null, not a
        // string. That is the NORMAL state since the default vocabulary was
        // emptied, so a non-nullable schema failed output validation on most
        // projects and the tool returned nothing but a zod error.
        personaSource: z
          .string()
          .nullable()
          .describe('Active persona-set source: default | declared | discovered, or null when the project has no persona set (one "everyone" row)'),
        undecidedShare: z.number(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        slots: Array<{ slotId: string; displayName: string; supportsForms: boolean; live?: boolean }>;
        personas: Array<{ key: string; displayName: string; description: string | null; share: number }>;
        cells: Array<z.infer<typeof cellOutput>>;
        autoFill: boolean;
        reviewMode?: boolean;
        personaSource: string | null;
        undecidedShare: number;
      }>(`/projects/${id}/cells`);

      const byCell = new Map(data.cells.map((c) => [`${c.slotId}::${c.persona}`, c]));
      const lines: string[] = [
        `Slots: ${data.slots.map((s) => `${untrusted(s.displayName)}${s.live === false ? ' [draft]' : ''}`).join(', ') || '(none published)'}`,
        `Auto-fill on first miss: ${data.autoFill ? 'ON' : 'off'} · review before publishing: ${data.reviewMode ? 'ON (approve with review_cell)' : 'off'} · persona source: ${data.personaSource ?? 'none (one "everyone" row)'}`,
      ];
      for (const p of data.personas) {
        const states = data.slots.map((s) => {
          const c = byCell.get(`${s.slotId}::${p.key}`);
          let state = c ? c.status : 'original';
          if (c && (c.status === 'pending' || c.status === 'generating') && c.refinedFrom) {
            // Mid-refinement is NOT a regression: the incumbent keeps serving
            // while a sharper version is written — say so, or agents report a
            // winning cell as "stuck pending".
            state = `${c.status} (improving on ${untrusted(c.refinedFrom, 64)} — current version still live)`;
          } else if (c && c.status === 'pending' && c.notBefore && Date.parse(c.notBefore) > Date.now()) {
            state = `pending (waiting until ${c.notBefore})`;
          }
          return `${untrusted(s.displayName, 40)}: ${state}`;
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
      if (data.cell?.refinedFrom && (data.cell.status === 'pending' || data.cell.status === 'generating')) {
        lines.push(
          `An improved take on ${untrusted(data.cell.refinedFrom, 64)} is being written — the current version keeps serving meanwhile.`,
        );
      }
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
      // The old copy promised "goes live, usually under a minute" — but with
      // review mode on the worker parks the version for a human (status
      // 'review') and nothing serves until someone approves it, and the queue
      // can defer a cell (retry backoff, the plan's monthly generation cap). An
      // agent relayed "it's live" for versions no visitor would ever see.
      description:
        'Queue AI generation of a version for one (persona, slot) cell; the worker writes it asynchronously, brand-locked. ' +
        'If the project has review mode on, the finished version WAITS for approval (list_cell_reviews / review_cell) and serves ' +
        'nobody until approved; otherwise it publishes automatically as a named option the optimizer explores. Also regenerates ' +
        'or retries a failed cell. Generation volume is capped per plan (Free included). Check get_cell_matrix for progress. ' +
        'Confirm with the user before calling — each generation is a model call against the plan quota.',
      inputSchema: {
        projectId: projectIdSchema,
        slotId: z.string().min(1).max(128).describe('The slot id (a matrix column)'),
        persona: z.string().min(1).max(64).describe('The persona key (a matrix row)'),
      },
      outputSchema: {
        slotId: z.string(),
        persona: z.string(),
        status: z.literal('pending').describe('Queued — check get_cell_matrix for progress'),
        reviewMode: z
          .boolean()
          .nullable()
          .describe('True: the version will wait for review_cell approval. False: it publishes automatically. Null: could not be read.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, slotId, persona }) => {
      const id = encodeURIComponent(projectId);
      await client.post(`/projects/${id}/cells/generate`, { slotId, persona });
      // The queue is already written; the review flag only shapes what we tell
      // the agent, so a failed read degrades to an honest "unknown" rather than
      // failing a request that succeeded.
      const matrix = await settled(client.get<{ reviewMode?: boolean }>(`/projects/${id}/cells`));
      const reviewMode =
        matrix.ok && typeof matrix.value.reviewMode === 'boolean' ? matrix.value.reviewMode : null;
      const next =
        reviewMode === true
          ? 'Review mode is ON: when it is written it will WAIT for approval and serve nobody until then — list it with list_cell_reviews and approve or reject it with review_cell (after the user decides).'
          : reviewMode === false
            ? 'Review mode is off: once written it publishes automatically and the optimizer starts exploring it.'
            : 'Could not read whether review mode is on — check get_cell_matrix: status "review" means it is waiting for approval (review_cell), "live" means it is serving.';
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `Queued a version of ${untrusted(slotId, 64)} for ${untrusted(persona, 64)}. It is written asynchronously ` +
              '(the queue may defer it — retries back off, and the plan caps generations). ' +
              `${next} Track it with get_cell_matrix or get_cell_detail.`,
          },
        ],
        structuredContent: { slotId, persona, status: 'pending' as const, reviewMode },
      };
    }),
  );

  // Review mode had a dashboard approval queue but no MCP counterpart, so an
  // agent that generated a version under review mode could only tell the user
  // to go find it in the dashboard.
  server.registerTool(
    'list_cell_reviews',
    {
      title: 'Versions waiting for review',
      description:
        'Generated versions waiting for approval (review mode): which slot and visitor type, the proposed text or layout, and why it was written. ' +
        'Approve or reject each with review_cell after the user decides.' +
        UNTRUSTED_FIELDS_NOTE,
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        reviews: z.array(
          z.object({
            slotId: z.string(),
            slotName: z.string(),
            persona: z.string(),
            personaDisplay: z.string(),
            content: z.string().nullable().describe('Proposed text, when the version is text (null for a block/layout version)'),
            rationale: z.string().nullable(),
            refinedFrom: z.string().nullable().describe('Live version this one would replace; that version keeps serving until approval'),
            updatedAt: z.string(),
          }),
        ),
        total: z
          .number()
          .int()
          .describe('How many versions are waiting in all. The list holds at most the oldest 200; decide those to see the rest.'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        reviews: Array<{
          slotId: string;
          slotName: string;
          persona: string;
          personaDisplay: string;
          pendingArm: { content?: unknown; displayName?: unknown } | null;
          rationale: string | null;
          refinedFrom: string | null;
          updatedAt: string;
        }>;
        /** Absent from an API older than the 200-row cap (2026-10-06). */
        total?: number;
      }>(`/projects/${id}/cell-reviews`);
      const reviews = (data.reviews ?? []).map((r) => ({
        slotId: r.slotId,
        slotName: r.slotName,
        persona: r.persona,
        personaDisplay: r.personaDisplay,
        content: typeof r.pendingArm?.content === 'string' ? r.pendingArm.content : null,
        rationale: r.rationale ?? null,
        refinedFrom: r.refinedFrom ?? null,
        updatedAt: String(r.updatedAt),
      }));
      const total = typeof data.total === 'number' ? data.total : reviews.length;
      if (reviews.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No generated versions are waiting for review.' }],
          structuredContent: { reviews, total },
        };
      }
      // Generated text and rationales are model output conditioned on
      // visitor-reachable page content — delimit them like every other
      // externally-influenced string (see untrusted()).
      const lines = reviews.map((r) =>
        [
          `- ${untrusted(r.slotName, 60)} (slotId ${untrusted(r.slotId, 64)}) for ${untrusted(r.personaDisplay, 60)} (persona ${untrusted(r.persona, 64)})`,
          r.content !== null ? `  Proposed text: ${untrusted(r.content, 300)}` : '  Proposed: a designed block/layout (preview it in the dashboard)',
          r.rationale ? `  Why: ${untrusted(r.rationale, 300)}` : null,
          r.refinedFrom ? `  Would replace ${untrusted(r.refinedFrom, 64)}, which keeps serving until approval.` : null,
        ]
          .filter((l): l is string => l !== null)
          .join('\n'),
      );
      // The API caps the list at the oldest 200; without the total an agent
      // would report a 600-item queue as 200.
      if (total > reviews.length) {
        lines.unshift(`Showing the ${reviews.length} oldest of ${total} versions waiting. Decide on these to see the rest.`, '');
      }
      lines.push('', 'Approve or reject each with review_cell (slotId + persona) once the user has decided.');
      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent: { reviews, total } };
    }),
  );

  server.registerTool(
    'review_cell',
    {
      title: 'Approve or reject a generated version',
      description:
        "Approve or reject ONE generated version waiting for review (see list_cell_reviews). 'approve' publishes it to live " +
        "visitors of that type; 'reject' discards it (a rejected refinement leaves the current live version in place). " +
        'This is the human decision review mode exists for — only call it with the user\'s explicit go-ahead.',
      inputSchema: {
        projectId: projectIdSchema,
        slotId: z.string().min(1).max(128).describe('The slot id of the version under review'),
        persona: z.string().min(1).max(64).describe('The persona key of the version under review'),
        action: z.enum(['approve', 'reject']),
        feedback: z.string().max(2000).optional().describe('Optional reviewer note, stored with a rejection'),
      },
      outputSchema: {
        slotId: z.string(),
        persona: z.string(),
        action: z.enum(['approve', 'reject']),
        status: z.string().describe("live (approved, or a rejected refinement whose incumbent keeps serving) | rejected"),
        armId: z.string().nullable().describe('The published option id, on approval'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, slotId, persona, action, feedback }) => {
      const id = encodeURIComponent(projectId);
      const res = await client.post<{ ok: boolean; status?: string; armId?: string }>(`/projects/${id}/cells/review`, {
        slotId,
        persona,
        action,
        feedback,
      });
      const status = res.status ?? (action === 'approve' ? 'live' : 'rejected');
      const text =
        action === 'approve'
          ? `Approved: the version for ${untrusted(persona, 64)} in ${untrusted(slotId, 64)} is now live${res.armId ? ` as option ${untrusted(res.armId, 64)}` : ''}.`
          : status === 'live'
            ? `Rejected: the proposed refinement for ${untrusted(persona, 64)} in ${untrusted(slotId, 64)} was discarded; the current live version keeps serving.`
            : `Rejected: the version for ${untrusted(persona, 64)} in ${untrusted(slotId, 64)} was discarded; that visitor type keeps seeing the original.`;
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { slotId, persona, action, status, armId: res.armId ?? null },
      };
    }, {
      not_found:
        'No version is waiting for review in that cell (it may already have been approved or rejected). Check list_cell_reviews.',
      publish_failed:
        'Approval could not publish this version (the slot may be full of options, or its configuration changed). It stays in review — check the reason in get_cell_detail or the dashboard, then retry.',
    }),
  );
}
