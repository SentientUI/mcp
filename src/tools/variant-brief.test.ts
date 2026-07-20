import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from '../api-client.js';
import { registerVariantBriefTools } from './variant-brief.js';

function makeServer() {
  const tools: Record<string, { handler: Function }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: Function) => { tools[name] = { handler }; }),
    tools,
  };
}

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * variant-brief issues 5 parallel GETs in this order:
 *   /projects, /projects/:id/components, /projects/:id/trends,
 *   /projects/:id/portraits, /projects/:id/insights
 * The mock dispatches by URL suffix so individual calls can fail independently.
 */
function mockClient(client: ApiClient, responses: {
  projects?: unknown | Error;
  components?: unknown | Error;
  trends?: unknown | Error;
  portraits?: unknown | Error;
  insights?: unknown | Error;
}) {
  vi.spyOn(client, 'get').mockImplementation((path: string) => {
    let value: unknown | Error | undefined;
    if (path === '/projects') value = responses.projects;
    else if (path.endsWith('/components')) value = responses.components;
    else if (path.endsWith('/trends')) value = responses.trends;
    else if (path.endsWith('/portraits')) value = responses.portraits;
    else if (path.endsWith('/insights')) value = responses.insights;
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value as any);
  });
}

async function run(responses: Parameters<typeof mockClient>[1], componentId = 'hero') {
  const client = new ApiClient({ apiKey: 'sk_test' });
  mockClient(client, responses);
  const server = makeServer();
  registerVariantBriefTools(server as any, client);
  const result = await server.tools['get_variant_brief']!.handler({ projectId: PROJECT_ID, componentId });
  return result.content[0].text as string;
}

const sufficientResponses = {
  projects: [{ id: PROJECT_ID, name: 'Shop', context_type: 'ecommerce' }],
  components: [{
    component_id: 'hero',
    total_impressions: 800,
    total_conversions: 80,
    variants: [{ variant_id: 'v_a' }, { variant_id: 'v_b' }],
  }],
  trends: {
    cvr: [{ variantId: 'v_a', currentCvr: 0.12, priorCvr: 0.10, deltaPp: 2 }],
    momentum: [{ variantId: 'v_a', direction: 'gaining' }],
  },
  portraits: {
    clusters: [{ label: 'buyers', sessionCount: 150, avgReliability: 0.8 }],
    totalSessions: 300,
  },
  insights: {
    status: 'ok',
    narratorBullets: ['v_a CVR is up.'],
    advisorBullets: ['Try a value-led headline.'],
    isStale: false,
  },
};

describe('get_variant_brief — DataState branches', () => {
  it('reports SUFFICIENT when impressions >= target, insights ok/fresh, reliable', async () => {
    const text = await run(sufficientResponses);
    expect(text).toContain('## Data sufficiency: SUFFICIENT');
    expect(text).toContain('There is enough data.');
  });

  it('reports COLLECTING when impressions below target (500)', async () => {
    const text = await run({
      ...sufficientResponses,
      components: [{
        component_id: 'hero',
        total_impressions: 100,
        total_conversions: 10,
        variants: [{ variant_id: 'v_a' }],
      }],
    });
    expect(text).toContain('## Data sufficiency: COLLECTING');
    expect(text).toContain('Limited data so far.');
  });

  it('reports COLLECTING when reliability is below 0.3 despite high impressions', async () => {
    const text = await run({
      ...sufficientResponses,
      portraits: {
        clusters: [{ label: 'buyers', sessionCount: 150, avgReliability: 0.1 }],
        totalSessions: 300,
      },
    });
    expect(text).toContain('## Data sufficiency: COLLECTING');
  });

  it('reports COLLECTING when insights are stale', async () => {
    const text = await run({
      ...sufficientResponses,
      insights: { status: 'ok', narratorBullets: [], advisorBullets: [], isStale: true },
    });
    expect(text).toContain('## Data sufficiency: COLLECTING');
    expect(text).toContain('Insights are stale');
  });

  it('reports EMPTY when impressions are 0', async () => {
    const text = await run({
      ...sufficientResponses,
      components: [{ component_id: 'hero', total_impressions: 0, total_conversions: 0, variants: [] }],
    });
    expect(text).toContain('## Data sufficiency: EMPTY');
    expect(text).toContain('No data yet');
    expect(text).toContain('shadow mode');
  });
});

describe('get_variant_brief — formatting', () => {
  it('formats component CVR as conversions/impressions*100 to 2 decimals', async () => {
    // 80/800 = 0.1 -> 10.00%
    const text = await run(sufficientResponses);
    expect(text).toContain('800 impressions, 80 conversions, 10.00% CVR');
  });

  it('lists existing variant IDs and warns not to reuse them', async () => {
    const text = await run(sufficientResponses);
    expect(text).toContain('Existing variant IDs (do not reuse these): v_a, v_b');
  });

  it('formats per-variant CVR (currentCvr*100) with signed delta pp and momentum', async () => {
    // currentCvr 0.12 -> 12.00%, deltaPp 2 -> +2.0 pp, momentum gaining
    const text = await run(sufficientResponses);
    expect(text).toContain('- v_a: 12.00% CVR (+2.0 pp, gaining)');
  });

  it('defaults momentum to "stable" when no momentum entry exists', async () => {
    const text = await run({
      ...sufficientResponses,
      trends: {
        cvr: [{ variantId: 'v_a', currentCvr: 0.12, priorCvr: 0.10, deltaPp: -1 }],
        momentum: [],
      },
    });
    expect(text).toContain('- v_a: 12.00% CVR (-1.0 pp, stable)');
  });

  it('formats audience share as sessionCount/totalSessions*100 to 0 decimals', async () => {
    // 150/300 = 50%, reliability 0.8 -> 80%
    const text = await run(sufficientResponses);
    expect(text).toContain('Audience (300 sessions):');
    expect(text).toContain('- buyers: 50% of traffic (reliability 80%)');
  });

  it('includes both narrator observations and advisor recommendations', async () => {
    const text = await run(sufficientResponses);
    expect(text).toContain('Insights — observations:');
    expect(text).toContain('- v_a CVR is up.');
    expect(text).toContain('Insights — recommendations:');
    expect(text).toContain('- Try a value-led headline.');
  });

  it('uses ecommerce best-practice priors keyed by context_type', async () => {
    const text = await run(sufficientResponses);
    expect(text).toContain('## Best-practice priors (ecommerce)');
    expect(text).toContain('Lead with the core benefit/value, not features.');
  });
});

describe('get_variant_brief — empty / missing component', () => {
  it('shows the new-component note when component is not found', async () => {
    const text = await run({
      ...sufficientResponses,
      components: [], // hero not present
    });
    expect(text).toContain('no component named "hero" has reported data yet');
    // No "Component performance" section when component missing
    expect(text).not.toContain('Component performance:');
  });

  it('shows "Insights: none generated yet." when insights status is empty', async () => {
    const text = await run({
      ...sufficientResponses,
      insights: { status: 'empty' },
    });
    expect(text).toContain('Insights: none generated yet.');
  });

  it('falls back to generic priors when context_type is unknown', async () => {
    const text = await run({
      ...sufficientResponses,
      projects: [{ id: PROJECT_ID, name: 'Shop', context_type: 'mystery' }],
    });
    expect(text).toContain('## Best-practice priors (mystery)');
    expect(text).toContain('Make the primary action unmistakable and benefit-led.');
  });
});

describe('get_variant_brief — partial API failures (settled)', () => {
  it('still produces a brief when /projects rejects (context unknown)', async () => {
    const text = await run({ ...sufficientResponses, projects: new Error('boom') });
    expect(text).toContain('Project context type: unknown');
    expect(text).toContain('## Best-practice priors (unknown)');
  });

  it('still produces a brief when /components rejects (treated as missing component)', async () => {
    const text = await run({ ...sufficientResponses, components: new Error('boom') });
    expect(text).toContain('no component named "hero" has reported data yet');
    // impressions default 0 -> EMPTY
    expect(text).toContain('## Data sufficiency: EMPTY');
  });

  it('still produces a brief when /trends and /portraits reject (no audience / variant sections)', async () => {
    const text = await run({
      ...sufficientResponses,
      trends: new Error('boom'),
      portraits: new Error('boom'),
    });
    expect(text).not.toContain('Current variant performance');
    expect(text).not.toContain('Audience (');
    // reliability null is treated as reliable; insights ok, impressions 800 -> SUFFICIENT
    expect(text).toContain('## Data sufficiency: SUFFICIENT');
  });

  it('treats failed /insights as not-ready -> COLLECTING and "none generated yet"', async () => {
    const text = await run({ ...sufficientResponses, insights: new Error('boom') });
    expect(text).toContain('Insights: none generated yet.');
    expect(text).toContain('## Data sufficiency: COLLECTING');
  });
});
