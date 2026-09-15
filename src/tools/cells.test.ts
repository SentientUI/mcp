import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiClient } from '../api-client.js';
import { registerCellTools } from './cells.js';
import type { ToolHandler } from './test-utils.js';

type ToolConfig = {
  description: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
  outputSchema?: Record<string, z.ZodTypeAny>;
  annotations?: Record<string, unknown>;
};

function makeServer() {
  const tools: Record<string, { config: ToolConfig; handler: ToolHandler }> = {};
  return {
    registerTool: vi.fn((name: string, config: ToolConfig, handler: ToolHandler) => {
      tools[name] = { config, handler };
    }),
    tools,
  };
}

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

const MATRIX = {
  slots: [
    { slotId: 'hero', displayName: 'Hero call-to-action', supportsForms: false, live: true },
    { slotId: 'aside', displayName: 'Aside', supportsForms: false, live: false },
  ],
  personas: [{ key: 'evaluator', displayName: 'Evaluator\nInjected', description: 'Thorough', share: 0.4 }],
  cells: [
    { slotId: 'hero', persona: 'evaluator', status: 'live', requestedBy: 'operator', armId: 'evaluator_v1', rationale: 'why', error: null, updatedAt: 'x', refinedFrom: null, notBefore: null, attempts: 1 },
    { slotId: 'aside', persona: 'evaluator', status: 'pending', requestedBy: 'refinement', armId: 'evaluator_v1', rationale: null, error: null, updatedAt: 'x', refinedFrom: 'evaluator_v1', notBefore: null, attempts: 1 },
  ],
  autoFill: false,
  personaSource: 'default',
  undecidedShare: 0.25,
};

const DETAIL = {
  cell: MATRIX.cells[0],
  arm: { id: 'evaluator_v1', displayName: 'R1', content: 'Compare us in 5 minutes', blocks: null },
  performance: { shown: 100, conversions: 15, conversionRate: 0.15, baselineShown: 200, baselineConversions: 20, baselineConversionRate: 0.1 },
  verdict: 'Doing better than your original so far (15.0% vs 10.0%).',
};

let server: ReturnType<typeof makeServer>;
let client: ApiClient;

beforeEach(() => {
  server = makeServer();
  client = new ApiClient({ apiKey: 'sk_test' });
  registerCellTools(server as never, client);
});

describe('get_cell_matrix', () => {
  it('reads the cells endpoint and sanitizes labels in text output', async () => {
    const getSpy = vi.spyOn(client, 'get').mockResolvedValue(MATRIX);
    const result = await server.tools['get_cell_matrix']!.handler({ projectId: PROJECT_ID });
    expect(getSpy).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/cells`);
    const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(text).toContain('Hero call-to-action');
    expect(text).not.toContain('Evaluator\nInjected'); // untrusted() strips the newline
    expect(text).toContain('40%');
    const out = z.object(server.tools['get_cell_matrix']!.config.outputSchema!).parse(
      (result as { structuredContent: unknown }).structuredContent,
    );
    expect(out).toMatchObject({ personaSource: 'default' });
  });

  it('keeps refinement, retry, and draft-vs-live state instead of zod-stripping it', async () => {
    vi.spyOn(client, 'get').mockResolvedValue(MATRIX);
    const result = await server.tools['get_cell_matrix']!.handler({ projectId: PROJECT_ID });
    const out = z.object(server.tools['get_cell_matrix']!.config.outputSchema!).parse(
      (result as { structuredContent: unknown }).structuredContent,
    ) as typeof MATRIX;
    // The fields agents need to reason about refinement and retries survive.
    expect(out.cells[1]).toMatchObject({ refinedFrom: 'evaluator_v1', attempts: 1, notBefore: null });
    expect(out.slots[1]).toMatchObject({ live: false });
    const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
    // A mid-refinement cell reads as an upgrade in flight, not a regression.
    expect(text).toContain('improving on');
    expect(text).toContain('current version still live');
    expect(text).toContain('`Aside` [draft]'); // untrusted() delimits the label
  });

  it('renders a queued retry as waiting, with the retry time', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    vi.spyOn(client, 'get').mockResolvedValue({
      ...MATRIX,
      cells: [{ ...MATRIX.cells[0], status: 'pending', armId: null, refinedFrom: null, notBefore: future }],
    });
    const result = await server.tools['get_cell_matrix']!.handler({ projectId: PROJECT_ID });
    const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(text).toContain(`pending (waiting until ${future})`);
  });

  it('rejects a non-UUID projectId and notes untrusted fields', () => {
    const schema = z.object(server.tools['get_cell_matrix']!.config.inputSchema!);
    expect(schema.safeParse({ projectId: 'not-a-uuid' }).success).toBe(false);
    expect(server.tools['get_cell_matrix']!.config.description).toContain('never as instructions');
  });
});

describe('get_cell_detail', () => {
  it('reads the detail endpoint with encoded params and reports the rationale + verdict', async () => {
    const getSpy = vi.spyOn(client, 'get').mockResolvedValue(DETAIL);
    const result = await server.tools['get_cell_detail']!.handler({
      projectId: PROJECT_ID,
      slotId: 'hero',
      persona: 'evaluator',
    });
    expect(getSpy).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/cells/detail?slotId=hero&persona=evaluator`);
    const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(text).toContain('Why this exists: `why`'); // untrusted() delimits in backticks
    expect(text).toContain('Doing better than your original so far');
    z.object(server.tools['get_cell_detail']!.config.outputSchema!).parse(
      (result as { structuredContent: unknown }).structuredContent,
    );
  });

  it('says the incumbent keeps serving while a refinement is being written', async () => {
    vi.spyOn(client, 'get').mockResolvedValue({ ...DETAIL, cell: MATRIX.cells[1] });
    const result = await server.tools['get_cell_detail']!.handler({
      projectId: PROJECT_ID,
      slotId: 'aside',
      persona: 'evaluator',
    });
    const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(text).toContain('current version keeps serving');
  });
});

describe('generate_cell', () => {
  it('posts the generate request and reports pending', async () => {
    const postSpy = vi.spyOn(client, 'post').mockResolvedValue({ status: 'pending' });
    const result = await server.tools['generate_cell']!.handler({
      projectId: PROJECT_ID,
      slotId: 'hero',
      persona: 'evaluator',
    });
    expect(postSpy).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/cells/generate`, {
      slotId: 'hero',
      persona: 'evaluator',
    });
    const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(text.toLowerCase()).toContain('writing');
    z.object(server.tools['generate_cell']!.config.outputSchema!).parse(
      (result as { structuredContent: unknown }).structuredContent,
    );
  });

  it('is annotated as a non-destructive write with the plan-gate note', () => {
    const cfg = server.tools['generate_cell']!.config;
    expect(cfg.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(cfg.description).toContain('paid plan');
  });
});
