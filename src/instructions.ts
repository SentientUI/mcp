// Server-level instructions, sent in the initialize result to every MCP host
// (stdio and the hosted /mcp endpoint share createMcpServer). The dashboard's
// own assistant was answering from no map of the product — it reported a
// behaviour cluster named after a declared persona as "Developer (410
// visitors)" while the Matrix showed 0%, and wrote a server goal call no SDK
// has. An agent on MCP reads the same data with the same gaps, so it gets the
// same facts (decision #5 of the 2026-11-04 first-week plan: chat and MCP say
// what the dashboard says). AGENTS.md carries the long form.
export const SERVER_INSTRUCTIONS = `SentientUI serves each visitor the version of each adaptive component that works best for their audience, measured against a control group kept on the original.

Audiences, and what makes each one serve (precedence: declared > retargeting > discovered > campaign > arrival > everyone):
- everyone (key "unknown"): every visitor no other audience claims.
- Declared persona (bare key, e.g. "developer"): serves ONLY on visits where the site declares it — the persona prop on <AdaptiveRoot>/<AdaptiveProvider>, init({ persona }) in @sentientui/core, or window.sentient.persona on the script tag. Adding it to the vocabulary only names it; a declared persona the site never sends has no visitors and nobody sees its versions. Undeclared visitors are never guessed into one. Use declared personas for roles the site knows (signed-in users).
- Discovered audience ("d-" key): found in behaviour; serves only after it is promoted (evidence that it wants something different).
- Campaign, arrival type, retargeting group ("c-", "a-", "r-" keys): visitors who arrived on a named campaign link, arrived a certain way, or were moved into a retargeting group. This is how to reach anonymous traffic.
- get_persona_breakdown personas counts the audience each visit was actually served as (the same number as the Matrix share in get_cell_matrix). Its behaviourGroups ("Behaviour group N") are visitors who behaved alike: not personas or audiences, they serve nothing — never report one as an audience's visitors.
- A version's name, or a code variants key, never targets an audience. To give one audience one version, pin it (manage_approvals pin); pinned visitors stop teaching the optimizer for that component.

Components: an <Adaptive> with children and variants whose id already ran a variants test keeps serving that old test; dashboard-written or generated versions for it do not serve until it is migrated (dashboard Components -> Migrate..., or manage_tests migrate_component). Sentient migrates it by itself once the code's test has assigned nobody a version for 14 days.

Funnels: every step must have something that sends it (a page-visit rule, a click or form goal, useGoal in the browser, or trackServerGoal from the server), or that step never fills.

Server goal, exact shape (server only, never the browser):
  import { trackServerGoal } from '@sentientui/react/server'; // or '@sentientui/core/server'
  await trackServerGoal({ serverKey: process.env.SENTIENT_SECRET_KEY!, userId: user.id, name: 'subscribed', dedupeKey: user.id });
userId must be the id the site identifies the visitor with (<AdaptiveRoot userId={user.id}>); in the visitor's own request pass sessionId: readSessionCookie(cookies, publicKey) instead.

Excluding the team and test sites (dashboard Settings -> Internal traffic): visits marked internal still see versions (QA works) but never count in any report and never teach the optimizer; get_traffic_breakdown lists them as "Your team / test sites". They are marked by internal sites (allowed domains such as staging or localhost), team emails and domains (they match visitors the site identifies with identify(userId, { email }); the SDK sends only a SHA-256 of the address and its domain, never the address), a browser link, or the code flag (the internal prop on <AdaptiveRoot>/<AdaptiveProvider>, init({ internal }), window.sentient.internal). There is no report filter or IP rule, and visits from before a rule was turned on cannot be separated. Read the rules with get_internal_traffic_rules; change them with manage_settings set_internal_sites / add_internal_email / remove_internal_email (Agent access: Project settings), after confirming the list with the user.

Two sides of sign-up (dashboard Settings -> Site areas; read with get_site_areas): before sign-up the visitor is anonymous and the goal is to convert them; after sign-up the visitor is inside the product and known. Once a project splits its site, a component gets versions only for audiences of its own side: campaign, arrival and retargeting audiences are before sign-up, declared personas after sign-up only (people already using the product never count toward winning new ones), discovered groups wherever their visits happen. Serving follows the same line: on a before-sign-up page a declared persona is never in force (that visitor is Everyone or a campaign). A version, pin or approval across the line is refused (error other_side) — pick an audience of the component's side instead of retrying.

The main funnel (get_main_funnel): "how is my funnel doing" is answered by the one journey that ends at the project's main goal — Arrived, the marketer's own steps, the main goal — counted in people, with those who had already converted left out. It is chosen with manage_goals set_main_funnel and must end at the main goal; with none chosen it is just Arrived -> main goal. Stores get their checkout journey as the main funnel on connect. Use get_funnel_report only for a side journey: it counts one funnel's goals inside a window and includes people who had already converted, so its numbers and the main funnel's do not add up.

Page groups (get_page_groups): "what runs where" is answered by page groups — the site's pages under names a marketer uses (Home, Product pages, Pricing), each placed on the main funnel, with the people who viewed them and the components and layouts that ran there. A component's place is where it was actually shown; a header shown everywhere is site-wide. A group's placement only organises the view: where a PERSON is in the funnel comes from get_main_funnel. Until a list is saved (manage_goals set_page_groups) the tool returns a suggestion.

Known people (get_known_people): a person is "known" once they have reached the project's main goal (signed up, bought). They are counted apart from new and returning visitors, and a main-goal event from someone already past it is a repeat, not another conversion — so the conversion rate before the main goal is first-time conversions over new + returning visitors. A person is recognised on another device only where the site identifies them (<AdaptiveRoot userId>, identify(userId), or window.sentient.userId on the script tag); an anonymous visitor on a new browser counts as new. People who converted before SentientUI was installed are known only after an import of the site's own user ids (manage_settings import_known_people, or POST /v1/people/import with the secret key) — ids and facts only, never names, emails, phone numbers or addresses. When the main goal is sign-up, manage_settings set_gate_settings { identifiedIsConverted: true } makes every identified visitor count as already signed up. Reporting only for now: known people are not yet served or learned from differently.

Write tools change what real visitors see: confirm with the user first. Call get_agent_access before a manage_* write.`;
