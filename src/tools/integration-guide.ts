import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const GUIDE = `# SentientUI integration guide — the adaptive ladder

SentientUI adapts a site per visitor type (personas), learning from real conversions. Each
project has its own persona vocabulary (dashboard -> Settings -> Personas), and it starts
EMPTY: every visitor is 'unknown' until a persona exists, and the optimizer learns across all
traffic pooled in the meantime. Personas are DISCOVERED from behavior — or, far faster,
DECLARED by the app when it already knows the visitor's role: init({ persona: 'admin' }) /
<AdaptiveProvider persona=...> / window.sentient.persona. Declared beats inferred and serves
at full confidence; unrecognized values are ignored server-side and surfaced in the dashboard
so the operator can add them. Keep persona a low-cardinality role slug — never a user id.
Decisions are locked per session: Visit 1 learns, Visit 2 converts. Integrate one rung at a
time.

## Setup (60 seconds, no account)

1. Run \`npx @sentientui/cli init\` (detects Next App/Pages, Vite, Remix, CRA; installs
   @sentientui/react; writes .env.local; scaffolds an example). It does NOT edit your layout —
   it prints the wrap snippet for step 2.
2. Wrap the root layout with <AdaptiveRoot apiKey context> (from '@sentientui/react/next';
   other React apps use <AdaptiveProvider> from '@sentientui/react') and add
   suppressHydrationWarning to <html> — an inline script sets persona attributes pre-paint.
   Nothing adapts and nothing is tracked until this wrap is in place.
3. \`npm run dev\`, then open the app with \`?sentient_persona=a\` vs
   \`?sentient_persona=b\` to see it adapt — in keyless local mode any key drives the built-in
   heuristic. No API key needed. Against a real project the key must be one you declared.
4. To learn from real traffic: create a project at https://sentient-ui.com and set
   NEXT_PUBLIC_SENTIENT_API_KEY=pk_... in .env.local.

## Rung 1 — Style (CSS only)

Persona attributes on <html> (zero declaration; the attribute carries the project's own
vocabulary keys — declared or inferred):

    html[data-sentient-persona='admin'] .admin-tools { display: block; }
    html[data-sentient-confidence='low'] .admin-tools { display: none; }

Learned style tokens (element-scoped, SSR-safe):

    const t = useAdaptiveTokens('hero', {
      tone: ['calm', 'urgent'],   // first value = baseline
    });
    return <section {...t.props} className="hero">…</section>;
    // CSS: .hero[data-tone='urgent'] .cta { font-weight: 700; }

Rules: 1-4 dims, 2-6 values each, enum values only. For animation values, always add a
prefers-reduced-motion: reduce override in CSS.

## Rung 2 — Swap (alternate content)

Generated versions (start here) — wrap what the page shows today; the children are the
original:

    <Adaptive id="hero-cta" goal="signup_click">
      <a href="/signup">Start free trial</a>
    </Adaptive>

Mount + deploy registers the region. SentientUI writes versions per visitor type in the
dashboard ("Who sees what") — no redeploy. The children render for holdout traffic, unknown
visitor types, types with no version yet, and every error path. No server preload: mounted
regions are requested in one batched call. First visit shows the original briefly, then swaps;
return visits start from the last version. Keyless local mode renders originals only. Pass
onFormSubmit to allow form versions; set reportBaselineText={false} on regions wrapping
personalized or account content. (Formerly <AdaptiveSlot>.)

Code variants — when you write the alternatives yourself:

    <Adaptive id="buy-box" goal="buy_click"                      // goal REQUIRED
      variants={{ control: <CalmBuyBox/>, urgent: <UrgentBuyBox/> }} />  // first key = baseline

    // hook form:
    const { value, bind } = useAdaptive('buy-box', {
      variants: { calm: <CalmBuyBox/>, urgent: <UrgentBuyBox/> },  // first key = baseline
      goal: 'buy_click',                                            // REQUIRED
    });
    return <div {...bind}>{value}</div>;

Children or variants on one <Adaptive>, never both. With the hook, always attach bind — it
wires exposure tracking and goal listeners. <AdaptiveText> swaps dashboard-managed text.

## Rung 3 — Reorder (structure)

    <AdaptiveGroup id="pricing-area" arrangements={{
      standard:     ['plans', 'faq', 'social'],   // first key = baseline
      social_first: ['social', 'plans', 'faq'],
    }}>
      <PlanGrid key="plans"/> <Faq key="faq"/> <Testimonials key="social"/>
    </AdaptiveGroup>

Declared orders of keyed children only. Page-level: sections={[...]} on AdaptiveRoot +
useLayoutOrder(). Non-React sites: sections: ['#hero', '#pricing', '#faq'] (CSS selectors in
the theme's natural order) in window.sentient — the snippet reorders those elements within
their shared parent, and applies nothing if any selector drifts.

## No-code install order (snippet)

Two tags in <head>, in this order: one inline <script> that assigns the window.sentient config
and then, in the same tag after the ';', runs the inline pre-paint script; then the deferred
loader. The pre-paint script reads window.sentient when it runs, so sharing the tag is safe. It
is optional but recommended — the loader is deferred, so on a return visit the page can paint
its original state before the loader runs; the inline script applies the last served decision
from the visitor's own device first, with no network call and no cloak. Get the exact bytes from
the dashboard's Install page, or from renderSnippetInstall({ config }) in
'@sentientui/snippet/install' (renderSnippetPrePaintScript() for the script alone).

Strict Content-Security-Policy (script hashes): use the three-tag form instead — config, the
pre-paint script alone, then the loader (renderSnippetInstall({ config, split: true })). The
combined tag contains the site's config, so its hash differs per site; the split pre-paint tag is
byte-identical everywhere, so one hash covers it. Existing three-tag and config + loader installs
keep working.

## Testing the integration

Use '@sentientui/react/testing': renderWithSentient(ui, { variants, slots, persona }) forces
deterministic outcomes so tests never depend on what the optimizer serves.
`;

export function registerIntegrationGuideTools(server: McpServer): void {
  server.registerTool(
    'get_integration_guide',
    {
      title: 'Integration guide',
      description: 'Get the SentientUI adaptive-ladder integration guide: setup (keyless and keyed) plus copy-pasteable examples for every rung (Style, Swap, Reorder). Use this to integrate SentientUI into a codebase.',
      inputSchema: {},
      outputSchema: {
        guide: z.string().describe('The full integration guide in Markdown'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [{ type: 'text' as const, text: GUIDE }],
      structuredContent: { guide: GUIDE },
    }),
  );
}
