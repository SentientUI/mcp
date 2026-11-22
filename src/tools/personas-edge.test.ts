import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { behaviourGroupName, registerPersonaTools } from './personas.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => { tools[name] = { handler }; }),
    tools,
  };
}

async function run(data: unknown) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  vi.spyOn(client, 'get').mockResolvedValue(data as any);
  const server = makeServer();
  registerPersonaTools(server as any, client);
  const result = await server.tools['get_persona_breakdown']!.handler({ projectId: 'p1' });
  return result.content[0].text as string;
}

const BREAKDOWN = {
  windowDays: 30,
  totalPeople: 400,
  personas: [
    { key: 'unknown', name: 'Everyone', kind: 'everyone', people: 400, sharePct: 100 },
    { key: 'developer', name: 'Declared: Developer', kind: 'declared', people: 0, sharePct: 0 },
  ],
  behaviourGroups: [{ name: 'Behaviour group 1', description: 'Ready to act quickly.', people: 410 }],
};

describe('get_persona_breakdown — served-as audiences, behaviour groups apart', () => {
  // The bug: a behaviour cluster labelled `developer` reached agents as
  // "Developer: 410 visitors" while the Matrix showed 0% for Developer.
  it('reports the served-as counts (the Matrix share) and never names a group after an audience', async () => {
    const text = await run(BREAKDOWN);
    expect(text).toContain('same numbers as the Matrix share');
    expect(text).toContain('- `Everyone`: 400 people (100.0%)');
    expect(text).toContain('- `Declared: Developer`: 0 people (0.0%)');
    expect(text).toContain('Behaviour groups (visitors who behaved alike — NOT audiences');
    expect(text).toContain('- Behaviour group 1: 410 people — Ready to act quickly.');
  });

  it('says so when nothing was served in the window', async () => {
    const text = await run({ ...BREAKDOWN, totalPeople: 0, personas: [], behaviourGroups: [] });
    expect(text).toContain('No served decisions yet');
    expect(text).toContain('- None yet.');
    expect(text).not.toContain('NaN');
  });

  it('reads the persona-breakdown endpoint, not /portraits', async () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    const get = vi.spyOn(client, 'get').mockResolvedValue(BREAKDOWN as any);
    const server = makeServer();
    registerPersonaTools(server as any, client);
    await server.tools['get_persona_breakdown']!.handler({ projectId: 'p1' });
    expect(get).toHaveBeenCalledWith('/projects/p1/persona-breakdown');
  });
});

describe('behaviourGroupName', () => {
  it('names neutral labels by number and never echoes any other stored label', () => {
    expect(behaviourGroupName('behaviour-3')).toBe('Behaviour group 3');
    expect(behaviourGroupName('developer')).toBe('Behaviour group');
    expect(behaviourGroupName('unclustered')).toBe('Not grouped yet');
    expect(behaviourGroupName(null)).toBe('Not grouped yet');
  });
});
