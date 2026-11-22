import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const GUIDE = `# SentientUI integration guide — the adaptive ladder

SentientUI adapts a site per visitor type (personas), learning from real conversions. Each
project has its own persona vocabulary (dashboard -> Audiences), and it starts
EMPTY: every visitor is 'unknown' (Everyone) until a persona exists, and the optimizer learns
across all traffic pooled in the meantime. A visit is served as ONE persona, in order: DECLARED
by the app when it already knows the visitor's role (init({ persona: 'admin' }) /
<AdaptiveProvider persona=...> / window.sentient.persona), a running retargeting group, a
DISCOVERED audience the visitor confidently belongs to, a campaign / arrival type, else
Everyone. Behaviour groups (visitors who behaved alike, from portraits) are reporting only —
nothing is served to them and they are never personas. Declared beats everything and serves
at full confidence; unrecognized values are ignored server-side and surfaced in the dashboard
so the operator can add them. Keep persona a low-cardinality role slug — never a user id.
Decisions are locked per visit: a first visit usually sees the original and the return visit adapts — the
exception is a visitor arriving on a campaign link, whose first page can already show the campaign's version
(see Campaigns). Integrate one rung at a time.

## Setup (60 seconds, no account)

1. Run \`npx @sentientui/cli init\` (detects Next App/Pages, Vite, Remix, CRA; installs
   @sentientui/react; writes .env.local; scaffolds an example). It does NOT edit your layout —
   it prints the wrap snippet for step 2.
2. Wrap the root layout with <AdaptiveProvider apiKey>{children}</AdaptiveProvider> from
   '@sentientui/react' — on every React app, the Next.js App Router included (it can be rendered
   straight from the Server Component layout). Render <SentientPersonaScript apiKey /> just before
   it and add suppressHydrationWarning to <html> — that inline script sets the persona attributes
   pre-paint. Nothing adapts and nothing is tracked until this wrap is in place. Declare no
   components here: every <Adaptive> registers itself when it renders (see Rung 2).
   Do NOT put <AdaptiveRoot> (from '@sentientui/react/next') in app/layout.tsx. It reads the
   request (headers, cookies), so every route under it renders on demand and none can be
   statically generated or served from the edge cache; in the root layout that is the whole site.
   It is the per-page option below.
   If the site has a cookie banner, gate on it: consentFrom="cookiebot" | "onetrust" |
   "cookieyes" | "tcf" | "google-consent-mode" | "shopify" on the wrap (or consent={accepted}).
   Without a gate the SDK tracks from the first page view — for EU/UK traffic that needs consent.
   Ask the developer which banner they use; never guess one (a wrong preset gates every visitor).
3. \`npm run dev\`, then open the app with \`?sentient_persona=a\` vs
   \`?sentient_persona=b\` to see it adapt — in keyless local mode any key drives the built-in
   heuristic. No API key needed. Against a real project the key must be one you declared.
4. To learn from real traffic: create a project at https://sentient-ui.com and set
   NEXT_PUBLIC_SENTIENT_API_KEY=pk_... in .env.local.
5. After you deploy or publish the site, allow its origin (scheme + host, e.g.
   https://my-site.lovable.app) with add_origin, or dashboard -> Settings -> Allowed domains.
   Until then every request from it is refused (403 origin_not_allowed — the JSON body names the
   origin and the fix, and the browser console shows "[sentient] Not in Allowed domains (MCP
   add_origin): <origin>") and nothing is recorded. A project under 14 days old with no live domain yet allows its
   first https origin by itself, once; each further domain (www vs apex, staging, preview deploys,
   a custom domain added later) must be added. localhost:3000/3001 are allowed from the start.

On Shopify Hydrogen, follow the next section as well: Hydrogen's default CSP blocks every SDK
request.

## Shopify Hydrogen (headless storefronts)

The Shopify app's theme embed does not reach a Hydrogen storefront, so install @sentientui/react.
Two Hydrogen lines exist: 2026.4 (npm create @shopify/hydrogen, React 18) and 2026.10
(npx @shopify/hydrogen@latest setup, React 19). Check package.json for which one you are on.

1. CSP, first. Hydrogen's default Content-Security-Policy leaves our API out of connect-src, so
   the browser blocks every SDK request. Nothing looks broken (originals render, goals are logged
   in the console) but nothing is recorded. In app/entry.server.tsx:

       // Hydrogen 2026.4
       createContentSecurityPolicy({ shop: {...}, connectSrc: ['https://api.sentient-ui.com'] })
       // Hydrogen 2026.10
       createContentSecurityPolicy({ shop: {...}, directives: { connectSrc: ['https://api.sentient-ui.com'] } })

   The array extends Hydrogen's defaults. A custom apiBaseUrl needs that origin instead. No other
   directive needs changing: the SDK's inline script takes the nonce, and Hydrogen's style-src
   already allows the <style> the SDK adds.
2. The key. Hydrogen env vars are on the server (context.env on 2026.4, context.get(envContext)
   on 2026.10), not in the browser bundle. Set PUBLIC_SENTIENT_API_KEY=pk_... in .env and in the
   Oxygen environment, return it from the root loader, and read it with
   useRouteLoaderData('root'). Never return the sk_ key from a loader: loader data is sent to the
   browser.
3. app/root.tsx. useNonce comes from '@shopify/hydrogen' on 2026.4 and from the template's
   '~/lib/csp' on 2026.10:

       <html lang="en" suppressHydrationWarning>
         <head>
           <Meta /> <Links />
           <SentientPersonaScript apiKey={data.sentientKey} nonce={nonce} consentFrom="shopify" />
         </head>
         ...
       // in the default App component, around the <Outlet /> (inside Analytics.Provider on 2026.4):
       <AdaptiveProvider apiKey={data.sentientKey} nonce={nonce} consentFrom="shopify">

   Render the persona script only when the root loader data exists (it is undefined on the
   error page).
4. Consent: consentFrom="shopify" reads Shopify's Customer Privacy API, which Hydrogen loads.
   Nothing is stored or sent until the visitor answers. A goal fired before then is not recorded.
5. Goals: Hydrogen's analytics events are not forwarded. Declare them with useGoal, e.g.
   const addToCart = useGoal('add_to_cart') and call addToCart() from the add-to-cart button.
6. Never import '@sentientui/react/next' or use <AdaptiveRoot> on Hydrogen: they need
   next/headers. Every decision happens in the browser.
7. Allow the storefront's origin (its custom domain, and any Oxygen preview URL used for testing)
   with add_origin or dashboard -> Settings -> Allowed domains. Connecting the Shopify app allows
   only the store's myshopify.com and Online Store domains, so a Hydrogen domain gets
   403 origin_not_allowed until it is added.
8. Purchases (from the Shopify app's code; not yet tested on a live Hydrogen store): orders reach
   SentientUI only through the Shopify app, connected to the same project, and every paid order
   is recorded as revenue. Crediting an order to the versions the buyer saw needs the app's
   checkout pixel to read the SDK's cookie, which works only when checkout is on the storefront's
   site (shop.brand.com with checkout.brand.com). On a myshopify.com checkout the order is
   recorded but credited to no version. Whether the pixel runs on a Hydrogen checkout at all is
   unconfirmed. Tell the merchant this rather than promising attributed revenue.

## Rung 1 — Style (CSS only)

Persona attributes on <html> (zero declaration). The attribute carries the key the visit is
SERVED as: a declared key as-is ('admin'), a discovered group with its d- prefix
('d-content'), a campaign ('c-spring') or retargeting group ('r-spring'), or 'unknown'. CSS for a discovered group must target the d- key — a rule
written against a bare 'content' stops matching once the group carries its prefix:

    html[data-sentient-persona='admin'] .admin-tools { display: block; }
    html[data-sentient-persona='d-content'] .reading-list { display: block; }
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
visitor types, types with no version yet, and every error path. Mounted regions are requested
in one batched call after mount: the first visit shows the original briefly, then swaps; return
visits start from the last version. Keyless local mode renders originals only.

Optional server preload (Next.js App Router): wrap THE PAGE that renders the region in
<AdaptiveRoot> from '@sentientui/react/next' — in that page.tsx, or a route group's layout.tsx
for several, never app/layout.tsx and never nested inside the root layout's <AdaptiveProvider>
(put those pages in a route group whose layout does not render the provider). Pass
registrySlotIds={['hero-cta']} for generated regions and components={[{ id, variantIds }]} for
code variants, and a timeoutMs (e.g. 300) — the first paint then shows the served version. The
cost, which is why it is per page: that route renders on each request instead of from the cache
and waits for one API round trip. Tell the user before adding it. List ONLY ids the wrapped
pages render: a declared id is decided on every request, rendered or not, and those visits count
as views that can never convert.

Pass
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

Variant keys are versions, not audiences: naming one \`developer\` does NOT show it to
developers — the optimizer may show any version to anyone. To show it to Developers, declare
the persona on the site, then pin the version to that audience (Migrate the component in
Components; the last step offers the pins).

Children or variants on one <Adaptive>, never both. With the hook, always attach bind — it
wires exposure tracking and goal listeners. <AdaptiveText> swaps dashboard-managed text.

## Rung 3 — Reorder (structure)

    <AdaptiveGroup id="pricing-area" arrangements={{
      standard:     ['plans', 'faq', 'social'],   // first key = baseline
      social_first: ['social', 'plans', 'faq'],
    }}>
      <PlanGrid key="plans"/> <Faq key="faq"/> <Testimonials key="social"/>
    </AdaptiveGroup>

Declared orders of keyed children only. Page-level: sections={[...]} on an AdaptiveRoot that
wraps that page (see the server preload note in Rung 2 for what it costs) + useLayoutOrder(). Non-React sites: sections: ['#hero', '#pricing', '#faq'] (CSS selectors in
the theme's natural order) in window.sentient — the snippet reorders those elements within
their shared parent, and applies nothing if any selector drifts.

## No-code install order (snippet)

Two tags in <head>, in this order: one inline <script> that assigns the window.sentient config
and then, in the same tag after the ';', runs the inline pre-paint script; then the deferred
loader. The pre-paint script reads window.sentient when it runs, so sharing the tag is safe. It
is optional but recommended — the loader is deferred, so on a return visit the page can paint
its original state before the loader runs; the inline script applies the last served decision
from the visitor's own device first, with no network call and no page-wide cloak (it briefly hides
only published components, and only for a visitor who just clicked an ad or email). Get the exact bytes from
the dashboard's Install page, or from renderSnippetInstall({ config }) in
'@sentientui/snippet/install' (renderSnippetPrePaintScript() for the script alone).

Strict Content-Security-Policy (script hashes): use the three-tag form instead — config, the
pre-paint script alone, then the loader (renderSnippetInstall({ config, split: true })). The
combined tag contains the site's config, so its hash differs per site; the split pre-paint tag is
byte-identical everywhere, so one hash covers it. Existing three-tag and config + loader installs
keep working.

Consent: add consentFrom (same presets as above) to window.sentient when the site has a cookie
banner, or consent: false plus SentientSnippet.grantConsent() on accept. On Shopify, snippet 0.32
and later follows Shopify's Customer Privacy API automatically.

## Campaigns — ad and email links

A campaign is named in the dashboard (Settings -> Campaigns -> Prepare a campaign): its name, the
utm_campaign its links carry (optionally utm_source / utm_medium, or the ad platform), what the ad
promises, any discount code, and its landing page. Visitors arriving on its links are served as the
campaign — persona 'c-spring' for a campaign named "Spring" — with versions written for it, from the
FIRST page of the visit; a visitor who comes back without a tagged link within 30 days is still the
campaign's until it ends. A visitor the site already knows (a declared persona or a discovered group)
keeps that audience; the click still counts on the campaign card, as "already known". After a
campaign, its visitors who did not convert can be moved into a retargeting group ('r-spring') with
its own versions and its own result.

What the integration must do is get the landing URL to the first decision:

- Tag every ad and email link: ?utm_campaign=spring&utm_source=newsletter&utm_medium=email.
  utm_campaign is required — it is what a campaign matches on; an untagged link is served like any
  other visit.
- Snippet, Shopify theme embed and AdaptiveProvider: nothing to add. The browser's first decision
  carries the page URL.
- Next.js server preload (ANY of registrySlotIds, registrySlots, components, sections or slots on
  AdaptiveRoot): the server decides before the browser runs, and a Server Component cannot read
  the request URL. Next.js never passes searchParams to a layout, so preload in a layout decides a campaign visitor's
  first page as everyone else's (the campaign starts on their next visit, and that first click is not
  on the campaign card). A page that renders AdaptiveRoot itself passes its own:

      export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
        return (
          <AdaptiveRoot apiKey={process.env.NEXT_PUBLIC_SENTIENT_API_KEY ?? ''}
            searchParams={await searchParams} pathname="/spring">
            …
          </AdaptiveRoot>
        );
      }

- Verify with a tagged link in a fresh browser profile: once the page has decided, <html
  data-sentient-persona> reads the campaign's key ('c-spring'). The React SDK always sets it; the
  snippet only with personaAttributes: true in window.sentient.

## Capture AI assistants (server-side, any framework)

AI assistants that fetch pages for their users (ChatGPT-User, Claude-User, Perplexity-User)
and AI crawlers (GPTBot, ClaudeBot, …) run no JavaScript, so the snippet and the React SDK never
see them. Only your server does. Without server-side capture the dashboard's agent line reads
"not measured", not zero. Capture only observes: it never changes what is served.

- Next.js pages wrapped in AdaptiveRoot: already on for those pages (captureAgents defaults to
  true). Do not wrap the whole app in AdaptiveRoot to get capture — use the edge path below in
  middleware.ts, which sees every request and leaves the pages cached.
- Edge (Vercel Routing Middleware, Cloudflare Workers, Netlify Edge) — covers ANY framework on
  those hosts, static sites included:
    import { captureAgentRequest } from '@sentientui/core/server';
    captureAgentRequest(request, { apiKey: 'pk_...', source: 'edge', waitUntil });
  waitUntil is required on edge runtimes (ctx.waitUntil.bind(ctx) on Workers; waitUntil from
  '@vercel/functions' on Vercel), or the platform drops the request when the response returns.
- Node servers (Express, Nuxt/Nitro on Node, any (req, res, next) stack):
    import { sentientAgentMiddleware } from '@sentientui/core/server';
    app.use(sentientAgentMiddleware({ apiKey: 'pk_...' }));
- Hono / Remix / React Router / Astro / SvelteKit: call captureAgentRequest(request, { apiKey })
  from the request hook.

Only the path is sent (never the query string), with the user agent. The API re-derives the
agent itself and collapses the same fetch reported twice (e.g. edge + SSR), so running two
capture paths does not double-count. Hosted builders (Shopify themes, Webflow, Squarespace, Wix)
give no per-request hook and stay unmeasured.

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
