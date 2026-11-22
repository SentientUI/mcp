import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { registerIntegrationGuideTools } from './integration-guide.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => { tools[name] = { handler }; }),
    tools,
  };
}

describe('get_integration_guide', () => {
  it('registers and returns the ladder guide', async () => {
    const server = makeServer();
    registerIntegrationGuideTools(server as any);
    expect(server.tools['get_integration_guide']).toBeDefined();

    const result = await server.tools['get_integration_guide']!.handler({});
    const text = result.content[0].text as string;
    expect(result.content[0].type).toBe('text');
    expect(text).toContain('npx @sentientui/cli init');
    expect(text).toContain('useAdaptiveTokens');
    expect(text).toContain('useAdaptive');
    // Generated versions (children as the original) are taught before code variants.
    const generated = text.indexOf('<Adaptive id="hero-cta" goal="signup_click">');
    expect(generated).toBeGreaterThan(-1);
    expect(generated).toBeLessThan(text.indexOf('variants={{'));
    expect(text).not.toContain('slotsFrom');
    expect(text).not.toContain('initialSlotConfig');
    expect(text).toContain('AdaptiveGroup');
    expect(text).toContain('data-sentient-persona');
    expect(text).toContain('suppressHydrationWarning');
  });

  it('says to allow the deployed origin, and how a refused one shows up', async () => {
    const server = makeServer();
    registerIntegrationGuideTools(server as any);
    const text = (await server.tools['get_integration_guide']!.handler({})).content[0].text as string;
    expect(text).toMatch(/After you deploy or publish the site, allow its origin/);
    expect(text).toContain('add_origin');
    expect(text).toContain('403 origin_not_allowed');
  });

  it('teaches the two-tag no-code install, with the three-tag form for strict CSP', async () => {
    const server = makeServer();
    registerIntegrationGuideTools(server as any);
    const result = await server.tools['get_integration_guide']!.handler({});
    const text = result.content[0].text as string;
    const section = text.slice(text.indexOf('## No-code install order'), text.indexOf('## Testing the integration'));
    expect(section).toContain('Two tags in <head>');
    expect(section).toContain('renderSnippetInstall({ config })');
    expect(section).toMatch(/Content-Security-Policy[\s\S]*three-tag[\s\S]*split: true/);
    // Config before pre-paint before loader, in the prose order.
    expect(section.indexOf('window.sentient')).toBeLessThan(section.indexOf('pre-paint script'));
    expect(section.indexOf('pre-paint script')).toBeLessThan(section.indexOf('deferred'));
  });

  // An agent following the old guide put <AdaptiveRoot> in app/layout.tsx. It
  // reads the request on every route it wraps: one customer's marketing site
  // went from 26 of 27 pages served from the edge cache to none.
  it('wraps the root layout in the provider and keeps AdaptiveRoot per page', async () => {
    const server = makeServer();
    registerIntegrationGuideTools(server as any);
    const result = await server.tools['get_integration_guide']!.handler({});
    const text = result.content[0].text as string;
    expect(text).toContain('Wrap the root layout with <AdaptiveProvider apiKey>');
    expect(text).toContain('Do NOT put <AdaptiveRoot>');
    expect(text).toMatch(/every route under it renders on demand/);
    expect(text).toMatch(/wrap THE PAGE that renders the region in\s+<AdaptiveRoot>/);
    // Capture of AI crawlers must not be a reason to wrap the whole app either.
    expect(text).toContain('Do not wrap the whole app in AdaptiveRoot to get capture');
  });

  // Hydrogen's default CSP leaves our API out of connect-src. The spike found
  // the page looking correct while every SDK request was refused, so an agent
  // that skips this step ships an install that records nothing.
  it('teaches the Hydrogen install, with the CSP step for both Hydrogen lines', async () => {
    const server = makeServer();
    registerIntegrationGuideTools(server as any);
    const text = (await server.tools['get_integration_guide']!.handler({})).content[0].text as string;
    const section = text.slice(text.indexOf('## Shopify Hydrogen'), text.indexOf('## Rung 1'));
    expect(section.length).toBeGreaterThan(0);
    // Pointed to from Setup, so an agent reading top-down cannot miss it.
    expect(text.indexOf('On Shopify Hydrogen, follow the next section')).toBeLessThan(text.indexOf('## Shopify Hydrogen'));
    expect(section).toContain("connectSrc: ['https://api.sentient-ui.com']");
    expect(section).toContain("directives: { connectSrc: ['https://api.sentient-ui.com'] }");
    expect(section).toContain('nonce={nonce}');
    expect(section).toContain('suppressHydrationWarning');
    expect(section).toContain('consentFrom="shopify"');
    expect(section).toContain("useGoal('add_to_cart')");
    expect(section).toContain("Never import '@sentientui/react/next'");
    expect(section).toContain('add_origin');
    expect(section).toMatch(/Never return the sk_ key from a loader/);
    expect(section).toMatch(/not yet tested on a live Hydrogen store/);
  });

  it('teaches campaigns: tagged links, the first page, and searchParams only where a page renders AdaptiveRoot', async () => {
    const server = makeServer();
    registerIntegrationGuideTools(server as any);
    const result = await server.tools['get_integration_guide']!.handler({});
    const text = result.content[0].text as string;
    const section = text.slice(text.indexOf('## Campaigns'), text.indexOf('## Capture AI assistants'));
    expect(section.length).toBeGreaterThan(0);
    // utm_campaign is what a campaign matches on; untagged links cannot be one.
    expect(section).toContain('utm_campaign');
    expect(section).toMatch(/c-spring/);
    expect(section).toMatch(/r-spring/);
    // Next.js: the prop exists for pages; a layout never gets searchParams.
    expect(section).toContain('searchParams={await searchParams}');
    expect(section).toMatch(/never passes searchParams to a layout/);
    // Every prop that makes AdaptiveRoot decide on the server freezes the visit
    // before the URL is known — all of them named, not a subset.
    for (const prop of ['registrySlotIds', 'registrySlots', 'components', 'sections', 'slots']) {
      expect(section).toContain(prop);
    }
    // A campaign visitor's FIRST page adapts, so the opening line can no longer
    // promise that every first visit sees the original.
    expect(text).not.toMatch(/a first visit sees the original, the return visit adapts\./);
  });
});
