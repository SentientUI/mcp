import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from '../api-client.js';
import { registerTestBriefTools } from './test-brief.js';

function makeServer() {
  const tools: Record<string, { handler: Function }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: Function) => { tools[name] = { handler }; }),
    tools,
  };
}

function clientWith(components: unknown, goals: unknown) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
    if (path.includes('/components')) return components as never;
    if (path.includes('/goals')) return goals as never;
    return [] as never;
  });
  return client;
}

describe('get_test_brief', () => {
  it('returns a ready-to-paste RTL test using the component real variants and goal', async () => {
    const client = clientWith(
      [{ component_id: 'hero_cta', variants: [{ variant_id: 'control' }, { variant_id: 'accent' }] }],
      { goals: [{ goalName: 'signup' }] },
    );
    const server = makeServer();
    registerTestBriefTools(server as never, client);
    const result = await server.tools['get_test_brief']!.handler({ projectId: 'p1', componentId: 'hero_cta' });
    const text = result.content[0].text as string;
    expect(text).toContain('@sentientui/react/testing');
    expect(text).toContain('renderWithSentient');
    expect(text).toContain('hero_cta');
    expect(text).toContain('accent');   // a real variant id
    expect(text).toContain('signup');   // a real goal name
    expect(text).toContain('sentient_variant'); // the E2E pinning note
  });

  it('falls back gracefully when the component has no reported data', async () => {
    const client = clientWith([], { goals: [] });
    const server = makeServer();
    registerTestBriefTools(server as never, client);
    const result = await server.tools['get_test_brief']!.handler({ projectId: 'p1', componentId: 'unknown_c' });
    const text = result.content[0].text as string;
    expect(text).toContain('@sentientui/react/testing');
    expect(text).toContain('unknown_c');
  });
});
