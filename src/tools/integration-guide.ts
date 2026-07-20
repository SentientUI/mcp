import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const GUIDE = `# SentientUI integration guide — the adaptive ladder

SentientUI adapts a site per visitor type (personas: buyer, researcher, deal_seeker, browser,
unknown), learning from real conversions. Decisions are locked per session: Visit 1 learns,
Visit 2 converts. Integrate one rung at a time.

## Setup (60 seconds, no account)

1. Run \`npx @sentientui/cli init\` (detects Next App/Pages, Vite, Remix, CRA; installs
   @sentientui/react; writes .env.local; scaffolds an example). It does NOT edit your layout —
   it prints the wrap snippet for step 2.
2. Wrap the root layout with <AdaptiveRoot apiKey context> (from '@sentientui/react/next';
   other React apps use <AdaptiveProvider> from '@sentientui/react') and add
   suppressHydrationWarning to <html> — an inline script sets persona attributes pre-paint.
   Nothing adapts and nothing is tracked until this wrap is in place.
3. \`npm run dev\`, then open the app with \`?sentient_persona=buyer\` vs
   \`?sentient_persona=deal_seeker\` to see it adapt. No API key needed (keyless local mode).
4. To learn from real traffic: create a project at https://sentient-ui.com and set
   NEXT_PUBLIC_SENTIENT_API_KEY=pk_... in .env.local.

## Rung 1 — Style (CSS only)

Persona attributes on <html> (zero declaration):

    html[data-sentient-persona='deal_seeker'] .discount-banner { display: block; }
    html[data-sentient-confidence='low'] .discount-banner { display: none; }

Learned style tokens (element-scoped, SSR-safe):

    const t = useAdaptiveTokens('hero', {
      tone: ['calm', 'urgent'],   // first value = baseline
    });
    return <section {...t.props} className="hero">…</section>;
    // CSS: .hero[data-tone='urgent'] .cta { font-weight: 700; }

Rules: 1-4 dims, 2-6 values each, enum values only. For animation values, always add a
prefers-reduced-motion: reduce override in CSS.

## Rung 2 — Swap (alternate content)

    const { value, bind } = useAdaptive('buy-box', {
      variants: { calm: <CalmBuyBox/>, urgent: <UrgentBuyBox/> },  // first key = baseline
      goal: 'buy_click',                                            // REQUIRED
    });
    return <div {...bind}>{value}</div>;

Always attach bind — it wires exposure tracking and goal listeners. <Adaptive> is the wrapper
form; <AdaptiveText> swaps dashboard-managed text.

## Rung 3 — Reorder (structure)

    <AdaptiveGroup id="pricing-area" arrangements={{
      standard:     ['plans', 'faq', 'social'],   // first key = baseline
      social_first: ['social', 'plans', 'faq'],
    }}>
      <PlanGrid key="plans"/> <Faq key="faq"/> <Testimonials key="social"/>
    </AdaptiveGroup>

Declared orders of keyed children only. Page-level: sections={[...]} on AdaptiveRoot +
useLayoutOrder().

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
