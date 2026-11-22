// Self-contained HTML views for MCP Apps hosts (and, as fallbacks, ChatGPT's
// window.openai and older MCP-UI hosts).
//
// Each template is a complete, standalone HTML document with inline CSS + JS and
// ZERO external references (no CDN, fonts, or network) so it renders inside a
// sandboxed host iframe under the spec's default CSP. A UI-capable host renders
// these; hosts without UI support fall back to the tool's existing text/JSON.
//
// --- What we rely on from the MCP Apps spec ----------------------------------
// Extension `io.modelcontextprotocol/ui`, stable version 2026-01-26
// (modelcontextprotocol/ext-apps, specification/2026-01-26/apps.mdx, and its
// src/spec.types.ts). Hand-rolled here; see "Why no SDK" below.
//
// Server side (index.ts):
//   - A view is a `ui://` resource whose resources/read content has mimeType
//     `text/html;profile=mcp-app` (other types are reserved).
//   - Resource `_meta.ui` (on the read contents; we also put it on the listing):
//     `csp` {connectDomains, resourceDomains, frameDomains, baseUriDomains} —
//     omitted = no external origins, which is what these zero-network views
//     want, so we omit it; `permissions`; `domain`; `prefersBorder` (boolean).
//   - Tool `_meta.ui.resourceUri` links a tool to its view (the flat
//     `_meta["ui/resourceUri"]` is deprecated). There is NO frame-size hint:
//     the old `preferredFrameSize` was never in the stable spec; the view
//     reports its own size (ui/notifications/size-changed, below).
//   - Tool `_meta.ui.visibility`: Array<"model" | "app">, default both.
//     Without "model" the host MUST NOT list the tool to the agent; without
//     "app" the host MUST reject a view's tools/call for it. HOST-enforced.
//
// View <-> host: JSON-RPC 2.0 over window.parent.postMessage.
//   1. View -> host REQUEST `ui/initialize`, params
//      { protocolVersion: "2026-01-26", appInfo: {name, version},
//        appCapabilities: { availableDisplayModes?: [...] } }.
//      Result: { protocolVersion, hostInfo, hostCapabilities, hostContext }.
//      hostContext may carry `theme` ("light" | "dark"),
//      `styles.variables` (standard CSS custom properties such as
//      --color-background-primary, --color-text-primary, --color-text-danger,
//      --color-border-primary, --font-sans, --border-radius-md), displayMode,
//      containerDimensions, locale, ...
//   2. View -> host NOTIFICATION `ui/notifications/initialized` (no params).
//      "The Host MUST NOT send any request or notification to the View before
//      it receives an `initialized` notification" — so a view that never sends
//      ui/initialize gets NOTHING from a spec host. That was our bug: the old
//      bootstrap only spoke MCP-UI / OpenAI and rendered blank in such hosts.
//   3. Host -> view `ui/notifications/tool-input` { arguments } (at most once),
//      zero or more `ui/notifications/tool-input-partial` before it.
//   4. Host -> view `ui/notifications/tool-result`, params IS the CallToolResult:
//      { content, structuredContent, isError?, _meta } at the top of params.
//      `ui/notifications/tool-cancelled` { reason } instead on cancellation.
//   5. Host -> view `ui/notifications/host-context-changed` (partial
//      hostContext; merge it).
//   6. View -> host `ui/notifications/size-changed` { width, height } (px) when
//      content size changes.
//   7. View -> host REQUEST `tools/call` { name, arguments } -> CallToolResult;
//      only for tools whose visibility includes "app", and the host may block
//      it or ask the user first. `ui/update-model-context` { content } replaces
//      what the model is told about the view's state.
//   8. Host -> view requests we answer: `ping` and `ui/resource-teardown` ({}).
//
// Fallbacks, kept so ChatGPT and older hosts still render:
//   - ChatGPT implements the bridge above, and also exposes `window.openai`
//     (toolOutput = structuredContent, toolInput, callTool(name, args)) and a
//     `openai:set_globals` window event (detail.globals.toolOutput).
//   - MCP-UI hosts expect `{type:'ui-lifecycle-iframe-ready'}` and answer with
//     `{type:'ui-lifecycle-iframe-render-data', payload:{renderData}}`. These
//     non-JSON-RPC announcements are deferred until ui/initialize has gone
//     unanswered for LEGACY_DELAY_MS, so a spec host never sees them.
//
// Why no SDK: @modelcontextprotocol/ext-apps would have to be bundled into
// the inline <script> (the views have no network, so no CDN import), which
// needs a browser bundling step this package's tsup build does not have. The
// handshake is ~6 messages; a hand-rolled bridge keeps the templates
// dependency-free and lets ui.test.ts drive it with a simulated host.
//
// Colors come from the dataviz reference palette: a single validated blue hue for
// magnitude bars (no categorical set, so no CVD validation needed) plus the fixed
// `good`/`critical` status colors, which always ship paired with a ▲/▼ icon + sign
// so meaning is never carried by color alone. Light and dark are both selected;
// a host theme/variables, when sent, take precedence over our fallbacks.

export type VizId = 'persona-breakdown' | 'variant-performance' | 'goal-funnel' | 'layout-stats';

/** Every view this server ships: the four data-viz charts plus the review view. */
export type ViewId = VizId | 'cell-review';

export const VIZ_TITLES: Record<VizId, string> = {
  'persona-breakdown': 'Persona breakdown',
  'variant-performance': 'Variant performance',
  'goal-funnel': 'Goal funnel',
  'layout-stats': 'Layout stats',
};

export const VIEW_TITLES: Record<ViewId, string> = {
  ...VIZ_TITLES,
  'cell-review': 'Versions waiting for review',
};

/** The MCP Apps protocol version this bridge speaks (spec 2026-01-26). */
export const MCP_APPS_PROTOCOL_VERSION = '2026-01-26';

/**
 * The app-only tool the review view's Approve / Reject buttons call. A separate
 * tool from `review_cell` so that marking it `visibility: ["app"]` hides no
 * capability the agent already had (see tools/cells.ts).
 */
export const REVIEW_APP_TOOL = 'review_cell_from_view';

/** How long ui/initialize may go unanswered before the legacy announcements. */
export const LEGACY_DELAY_MS = 800;

// --- Shared chrome -----------------------------------------------------------

// Our palette, each slot reading the spec's standard host variable first. A
// host that sends styles.variables sets them inline on <html>, so these
// resolve to the host's look; without them the fallbacks apply.
const LIGHT_VARS = `
    --surface: var(--color-background-primary, #fcfcfb);
    --plane: var(--color-background-secondary, #f9f9f7);
    --ink: var(--color-text-primary, #0b0b0b);
    --ink-2: var(--color-text-secondary, #52514e);
    --muted: var(--color-text-tertiary, #898781);
    --track: #ecebe6;
    --border: var(--color-border-primary, rgba(11,11,11,0.10));
    --series-1: #2a78d6;
    --good: var(--color-text-success, #006300);
    --critical: var(--color-text-danger, #c0392b);
    --warn: var(--color-text-warning, #7a4f00);
    color-scheme: light;`;
const DARK_VARS = `
    --surface: var(--color-background-primary, #1a1a19);
    --plane: var(--color-background-secondary, #0d0d0d);
    --ink: var(--color-text-primary, #ffffff);
    --ink-2: var(--color-text-secondary, #c3c2b7);
    --muted: var(--color-text-tertiary, #898781);
    --track: #2c2c2a;
    --border: var(--color-border-primary, rgba(255,255,255,0.10));
    --series-1: #3987e5;
    --good: var(--color-text-success, #0ca30c);
    --critical: var(--color-text-danger, #e06a5c);
    --warn: var(--color-text-warning, #e0b050);
    color-scheme: dark;`;

const SHARED_CSS = `
  :root {${LIGHT_VARS}
    --radius: var(--border-radius-md, 6px);
    --font: var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  }
  /* The OS preference only decides when the host has not named a theme: a host
     in light mode on a dark-mode OS drew a dark card on a light chat. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {${DARK_VARS}
    }
  }
  :root[data-theme="dark"] {${DARK_VARS}
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: var(--surface);
    color: var(--ink);
    font-family: var(--font);
    font-size: 14px;
    line-height: 1.45;
    padding: 16px;
  }
  h1 { font-size: 15px; font-weight: 650; margin: 0 0 2px; }
  .sub { color: var(--ink-2); font-size: 12px; margin: 0 0 14px; }
  .rows { display: flex; flex-direction: column; gap: 10px; }
  .row { display: grid; grid-template-columns: 1fr; gap: 4px; }
  .row-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .label { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .val { color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .track {
    position: relative; height: 14px; border-radius: 4px;
    background: var(--track); overflow: hidden;
  }
  .bar {
    position: absolute; left: 0; top: 0; bottom: 0;
    background: var(--series-1); border-radius: 4px; min-width: 3px;
  }
  .meta { color: var(--ink-2); font-size: 12px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
  .chip {
    border: 1px solid var(--border); border-radius: 999px;
    padding: 2px 9px; font-size: 12px; color: var(--ink-2);
    display: inline-flex; align-items: center; gap: 6px;
  }
  .chip .rank { color: var(--muted); font-variant-numeric: tabular-nums; }
  .delta { font-variant-numeric: tabular-nums; font-weight: 550; white-space: nowrap; }
  .delta.up { color: var(--good); }
  .delta.down { color: var(--critical); }
  .delta.flat { color: var(--muted); }
  .empty { color: var(--ink-2); padding: 8px 0; }
  .foot { color: var(--muted); font-size: 11px; margin-top: 14px; }
  .card {
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 12px; display: flex; flex-direction: column; gap: 8px;
    background: var(--surface);
  }
  .draft {
    margin: 0; padding: 8px 10px; border-radius: var(--radius);
    background: var(--plane); white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .outline { margin: 0; padding: 8px 10px; border-radius: var(--radius); background: var(--plane); }
  .outline-row { font-size: 12px; overflow-wrap: anywhere; }
  .outline-kind { color: var(--muted); }
  .warn { color: var(--warn); font-size: 12px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  button {
    font: inherit; font-size: 13px; font-weight: 550; cursor: pointer;
    border-radius: var(--radius); padding: 6px 12px; min-height: 32px;
    border: 1px solid var(--border); background: transparent; color: var(--ink);
  }
  button.primary { background: var(--ink); color: var(--surface); border-color: var(--ink); }
  button:disabled { opacity: 0.5; cursor: default; }
  button:focus-visible, textarea:focus-visible { outline: 2px solid var(--series-1); outline-offset: 2px; }
  textarea {
    font: inherit; width: 100%; min-height: 64px; resize: vertical;
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface); color: var(--ink); padding: 6px 8px;
  }
  .status { font-size: 12px; color: var(--ink-2); }
  .status.error { color: var(--critical); }
  [hidden] { display: none !important; }
`;

// Browser-side helpers shared by every render function. Kept ES2019-safe.
const HELPERS_JS = `
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function pct1(n){ return (Number(n) || 0).toFixed(1) + '%'; }
  function clampPct(n){ n = Number(n) || 0; return n < 0 ? 0 : n > 100 ? 100 : n; }
  function el(id){ return document.getElementById(id); }
  function barRow(label, valText, widthPct, metaText){
    return '<div class="row"><div class="row-head"><span class="label">' + esc(label) +
      '</span><span class="val">' + esc(valText) + '</span></div>' +
      '<div class="track"><span class="bar" style="width:' + clampPct(widthPct) + '%"></span></div>' +
      (metaText ? '<div class="meta">' + esc(metaText) + '</div>' : '') + '</div>';
  }
  function showEmpty(msg){ el('viz').innerHTML = '<div class="empty">' + esc(msg) + '</div>'; }
  // DOM builder for views that take untrusted text: content goes in through
  // textContent only, so no tool value is ever parsed as HTML.
  function node(tag, cls, text){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
`;

// The bridge. Speaks MCP Apps first; window.openai and MCP-UI are fallbacks.
const BOOTSTRAP_JS = `
  var __b = { mode: null, nextId: 1, pending: {}, ctx: {}, toolInput: null, lastSize: '' };

  function __post(msg){ try { window.parent.postMessage(msg, '*'); } catch (e) {} }
  function __request(method, params){
    var id = __b.nextId++;
    return new Promise(function(resolve, reject){
      __b.pending[id] = { resolve: resolve, reject: reject };
      __post({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
    });
  }
  function __notify(method, params){ __post({ jsonrpc: '2.0', method: method, params: params || {} }); }
  function __respond(id, result){ __post({ jsonrpc: '2.0', id: id, result: result }); }

  function __resultText(r){
    var parts = (r && Array.isArray(r.content)) ? r.content : [];
    return parts.filter(function(c){ return c && c.type === 'text' && typeof c.text === 'string'; })
      .map(function(c){ return c.text; }).join('\\n');
  }
  function __isObj(v){ return v != null && typeof v === 'object' && !Array.isArray(v); }

  function __show(data){
    try { window.__render(data); }
    catch (e) { try { showEmpty('Could not draw this result.'); } catch (e2) {} }
    __reportSize();
  }
  function __showResult(r){
    // params of ui/notifications/tool-result IS the CallToolResult. Rendering
    // the whole notification (the old fallback did) drew an empty chart, and
    // an error result was drawn as if it were data.
    if (!__isObj(r)) return;
    if (r.isError) { showEmpty(__resultText(r) || 'The tool returned an error.'); __reportSize(); return; }
    if (__isObj(r.structuredContent)) { __show(r.structuredContent); return; }
    showEmpty(__resultText(r) || 'This tool returned no data to draw.');
    __reportSize();
  }

  function __applyTheme(t){
    if (t !== 'light' && t !== 'dark') return;
    document.documentElement.setAttribute('data-theme', t);
  }
  function __applyContext(c){
    if (!__isObj(c)) return;
    __applyTheme(c.theme);
    var vars = c.styles && c.styles.variables;
    if (!__isObj(vars)) return;
    for (var k in vars) {
      if (!Object.prototype.hasOwnProperty.call(vars, k)) continue;
      var v = vars[k];
      // Only custom properties, only plain strings: the host styles us, it
      // does not get to set arbitrary inline style.
      if (/^--[A-Za-z0-9-]+$/.test(k) && typeof v === 'string' && v.length <= 512) {
        document.documentElement.style.setProperty(k, v);
      }
    }
  }

  function __reportSize(){
    if (__b.mode !== 'mcp-apps') return;
    try {
      // body, not <html>: the root's scrollHeight is at least the iframe's own
      // height, so a frame the host once made tall could never shrink again.
      var w = Math.ceil(document.documentElement.scrollWidth || 0);
      var h = Math.ceil(document.body.scrollHeight || 0);
      var key = w + 'x' + h;
      if (key === __b.lastSize) return;
      __b.lastSize = key;
      __notify('ui/notifications/size-changed', { width: w, height: h });
    } catch (e) {}
  }

  function __onRpc(m){
    if (m.method === undefined && m.id != null) {
      var p = __b.pending[m.id];
      if (!p) return;
      delete __b.pending[m.id];
      if (m.error) p.reject(m.error); else p.resolve(m.result);
      return;
    }
    if (typeof m.method !== 'string') return;
    var params = __isObj(m.params) ? m.params : {};
    if (m.id != null) {
      if (m.method === 'ping' || m.method === 'ui/resource-teardown') { __respond(m.id, {}); return; }
      __post({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
      return;
    }
    if (m.method === 'ui/notifications/tool-input') { __b.toolInput = __isObj(params.arguments) ? params.arguments : null; return; }
    if (m.method === 'ui/notifications/tool-result') { __showResult(params); return; }
    if (m.method === 'ui/notifications/tool-cancelled') { showEmpty('The tool call was cancelled.'); __reportSize(); return; }
    if (m.method === 'ui/notifications/host-context-changed') {
      for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) __b.ctx[k] = params[k];
      __applyContext(params);
      return;
    }
  }

  // MCP-UI / OpenAI message shapes. Only KNOWN shapes count: the old fallback
  // rendered any object it was sent as the tool's data, so an unrelated host
  // message blanked the chart.
  function __legacyData(m){
    if (!__isObj(m)) return null;
    if (m.type === 'ui-lifecycle-iframe-render-data' && __isObj(m.payload)) return __legacyData(m.payload.renderData);
    if (__isObj(m.structuredContent)) return m.structuredContent;
    if (__isObj(m.toolOutput)) return __isObj(m.toolOutput.structuredContent) ? m.toolOutput.structuredContent : m.toolOutput;
    if (__isObj(m.globals) && __isObj(m.globals.toolOutput)) return m.globals.toolOutput;
    return null;
  }

  function __onMessage(ev){
    // Only our embedder speaks to us; any other window (a nested frame, an
    // extension) could otherwise forge a tool result into the view.
    if (!ev || ev.source !== window.parent) return;
    var m = ev.data;
    if (!__isObj(m)) return;
    if (m.jsonrpc === '2.0') { __onRpc(m); return; }
    var d = __legacyData(m);
    if (d) __show(d);
  }

  function __openai(){ try { return __isObj(window.openai) ? window.openai : null; } catch (e) { return null; } }

  /** A tool argument the view was opened with (projectId, ...). */
  window.__toolArg = function(name){
    if (__b.toolInput && __b.toolInput[name] != null) return __b.toolInput[name];
    var o = __openai();
    if (o && __isObj(o.toolInput) && o.toolInput[name] != null) return o.toolInput[name];
    return null;
  };
  /** Call a server tool from the view; resolves to a CallToolResult. */
  window.__callTool = function(name, args){
    if (__b.mode === 'mcp-apps') return __request('tools/call', { name: name, arguments: args });
    var o = __openai();
    if (o && typeof o.callTool === 'function') {
      try { return Promise.resolve(o.callTool(name, args)); } catch (e) { return Promise.reject(e); }
    }
    return Promise.reject({ message: 'This chat app cannot run actions from here — ask in the chat instead.' });
  };
  /** Tell the model what the view did (spec ui/update-model-context; best effort). */
  window.__updateModelContext = function(text){
    if (__b.mode !== 'mcp-apps') return;
    __request('ui/update-model-context', { content: [{ type: 'text', text: text }] }).then(null, function(){});
  };

  function __legacyAnnounce(){
    if (__b.mode === 'mcp-apps' || __b.mode === 'legacy') return;
    __b.mode = 'legacy';
    __post({ type: 'ui-lifecycle-iframe-ready' });
    __post({ type: 'openai:request_globals' });
  }

  function __boot(){
    window.addEventListener('message', __onMessage);
    window.addEventListener('openai:set_globals', function(ev){
      var g = ev && ev.detail && ev.detail.globals;
      if (!__isObj(g)) return;
      if (g.theme) __applyTheme(g.theme);
      if (__isObj(g.toolOutput)) __show(g.toolOutput);
    });
    var o = __openai();
    if (o) {
      __applyTheme(o.theme);
      if (__isObj(o.toolOutput)) __show(o.toolOutput);
    }
    try {
      var g = window.mcpUiRenderData || (window.__MCP_UI__ && window.__MCP_UI__.toolOutput);
      if (__isObj(g)) __show(__isObj(g.structuredContent) ? g.structuredContent : g);
    } catch (e) {}

    __request('ui/initialize', {
      protocolVersion: '${MCP_APPS_PROTOCOL_VERSION}',
      appInfo: { name: 'sentientui-' + window.__VIEW_ID, version: '1' },
      appCapabilities: { availableDisplayModes: ['inline'] }
    }).then(function(res){
      __b.mode = 'mcp-apps';
      __b.ctx = (res && __isObj(res.hostContext)) ? res.hostContext : {};
      __applyContext(__b.ctx);
      __notify('ui/notifications/initialized', {});
      __reportSize();
      try {
        if (typeof ResizeObserver === 'function') new ResizeObserver(__reportSize).observe(document.body);
      } catch (e) {}
    }, function(){ __legacyAnnounce(); });
    setTimeout(__legacyAnnounce, ${LEGACY_DELAY_MS});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __boot);
  else __boot();
`;

// --- Per-view render bodies (run in the host iframe) -------------------------

const RENDER_JS: Record<ViewId, string> = {
  'persona-breakdown': `
    window.__render = function(data){
      // Served-as audiences (the Matrix share), then behaviour groups — kept
      // apart: a behaviour group is visitors who behaved alike, never an
      // audience, and it is never drawn under an audience's name.
      var personas = (data && data.personas) || [];
      var groups = (data && data.behaviourGroups) || [];
      var total = (data && data.totalPeople) || 0;
      el('sub').textContent = total + ' people by the audience they were served as, last ' + ((data && data.windowDays) || 30) + ' days';
      if (!total && !groups.length) { showEmpty('No served visitors yet — nothing to break down.'); return; }
      var html = personas.map(function(p){
        return barRow(p.name, pct1(p.sharePct), p.sharePct, p.people + ' people');
      }).join('');
      if (groups.length) {
        var groupTotal = groups.reduce(function(a, g){ return a + (Number(g.people) || 0); }, 0);
        html += '<p class="sub" style="margin-top:14px">Behaviour groups — visitors who behaved alike. Not audiences: nothing is shown to a group.</p>';
        html += groups.map(function(g){
          var share = groupTotal > 0 ? (g.people / groupTotal) * 100 : 0;
          return barRow(g.name, g.people + ' people', share, g.description || '');
        }).join('');
      }
      el('viz').innerHTML = html;
    };
  `,
  'variant-performance': `
    window.__render = function(data){
      var variants = (data && data.variants) || [];
      var winText = 'selected window';
      if (data && data.window && data.window.start && data.window.end) {
        winText = String(data.window.start).slice(0, 10) + ' to ' + String(data.window.end).slice(0, 10);
      }
      el('sub').textContent = variants.length + ' variant' + (variants.length === 1 ? '' : 's') + ' · conversion, ' + winText + ' · only an evidence verdict is a comparison';
      if (!variants.length) { showEmpty('No variant data available yet.'); return; }
      // Grouped by component, never sorted by raw rate: a rate-ordered list
      // reads as a ranking the evidence may not support.
      var sorted = variants.slice().sort(function(a,b){
        return String(a.componentId).localeCompare(String(b.componentId)) || (b.isBaseline ? 1 : 0) - (a.isBaseline ? 1 : 0);
      });
      var verdictText = { baseline: 'baseline', ahead: 'ahead of baseline (strong evidence)', behind: 'behind baseline (strong evidence)',
        unclear: 'not separated from baseline', no_evidence: 'no evidence available' };
      el('viz').innerHTML = sorted.map(function(v){
        var n = Number(v.sessions) || 0;
        var rate = v.currentCvr == null ? null : v.currentCvr * 100;
        var val = rate == null ? 'no rate' : rate.toFixed(2) + '%';
        var meta = (v.conversions || 0) + '/' + n + ' sessions' + (v.lowSample ? ' · low sample' : '') +
          ' · ' + (verdictText[v.verdict] || 'no evidence available') +
          // The verdict judges this window's rate only when the server sent
          // window evidence; otherwise it is the all-time one, and says so.
          (v.isBaseline ? '' : v.verdictBasis === 'window' ? ' in this window' : v.verdictBasis === 'all_time' ? ' (all time)' : '');
        return barRow(v.componentId + ' / ' + v.variantId, val, rate == null ? 0 : rate, meta);
      }).join('');
    };
  `,
  'goal-funnel': `
    window.__render = function(data){
      var goals = (data && data.goals) || [];
      el('sub').textContent = goals.length + ' goal' + (goals.length === 1 ? '' : 's') + ' · unique-session conversion';
      if (!goals.length) { showEmpty('No goals configured for this project.'); return; }
      el('viz').innerHTML = goals.map(function(g){
        var cr = (g.conversionRate || 0) * 100;
        // No "best" variant: picking the top raw completion rate named a winner
        // no evidence backed (a 1/1 arm beat a 300/1000 one).
        var nv = (g.variants || []).length;
        var meta = g.hits + ' hits · ' + g.uniqueSessions + ' unique sessions' +
          (nv ? ' · ' + nv + ' variant rate' + (nv === 1 ? '' : 's') + ' (all-time, see text)' : '');
        return barRow(g.goalName, pct1(cr), cr, meta);
      }).join('');
    };
  `,
  'layout-stats': `
    window.__render = function(data){
      var layouts = (data && data.layouts) || [];
      el('sub').textContent = layouts.length + ' persona' + (layouts.length === 1 ? '' : 's') + ' · section order by reward';
      if (!layouts.length) { showEmpty('No layout data yet — more visitor sessions are needed.'); return; }
      var max = layouts.reduce(function(m,l){ return Math.max(m, l.avgReward || 0); }, 0) || 1;
      var sorted = layouts.slice().sort(function(a,b){ return (b.avgReward||0)-(a.avgReward||0); });
      el('viz').innerHTML = sorted.map(function(l){
        var order = (l.layoutOrder || []).map(function(s, i){
          return '<span class="chip"><span class="rank">' + (i+1) + '</span>' + esc(s) + '</span>';
        }).join('');
        var head = '<div class="row-head"><span class="label">' + esc(l.persona) +
          '</span><span class="val">reward ' + (Number(l.avgReward)||0).toFixed(2) + '</span></div>';
        // Number(): pulls went into the markup raw, so a non-numeric value
        // from the tool data was parsed as HTML.
        return '<div class="row">' + head +
          '<div class="track"><span class="bar" style="width:' + clampPct((l.avgReward||0)/max*100) + '%"></span></div>' +
          '<div class="chips">' + order + '</div>' +
          '<div class="meta">' + (Number(l.pulls) || 0) + ' pulls</div></div>';
      }).join('');
    };
  `,
  // The review view. Every value from the tool is model output or
  // visitor-reachable page text, so it is built with textContent only — never
  // innerHTML. Buttons call the app-only review tool through the host.
  'cell-review': `
    var __decided = {};
    var __log = [];
    function __key(r){ return String(r.slotId) + '~' + String(r.persona); }
    function __errText(e){
      if (e && typeof e.message === 'string' && e.message) return e.message;
      return 'Something went wrong. Try again, or ask in the chat.';
    }
    function __outline(rows){
      var box = node('div', 'outline');
      rows.slice(0, 80).forEach(function(row){
        var line = node('div', 'outline-row');
        var depth = Math.max(0, Math.min(8, Number(row && row.depth) || 0));
        line.style.paddingLeft = (depth * 12) + 'px';
        var kind = String((row && row.kind) || 'block') + ((row && row.style) ? ' · ' + row.style : '');
        line.appendChild(node('span', 'outline-kind', kind));
        if (row && row.text) line.appendChild(node('span', null, ' — ' + row.text));
        box.appendChild(line);
      });
      return box;
    }
    function __card(r, projectId){
      var card = node('div', 'card');
      var head = node('div', 'row-head');
      head.appendChild(node('span', 'label', r.slotName || r.slotId));
      head.appendChild(node('span', 'chip', 'for ' + (r.personaDisplay || r.persona)));
      card.appendChild(head);

      if (typeof r.content === 'string') card.appendChild(node('p', 'draft', r.content));
      else if (Array.isArray(r.outline) && r.outline.length) card.appendChild(__outline(r.outline));
      else card.appendChild(node('p', 'meta', 'A designed section — its outline is not available here.'));

      if (r.rationale) card.appendChild(node('p', 'meta', 'Why: ' + r.rationale));
      if (r.refinedFrom) card.appendChild(node('p', 'meta', 'Would replace ' + r.refinedFrom + ', which keeps showing until you approve.'));
      // No link: the on-site preview opens the page with a one-time editor
      // code only the signed-in dashboard can create, so a plain link to the
      // page would show the live version and pass it off as this draft.
      card.appendChild(node('p', 'meta', (r.page ? 'Lives on ' + r.page + '. ' : '') +
        'To see it on your site, use Preview on your site in the dashboard (Who sees what).'));

      var refusal = r.audienceRetired ? 'Its audience was retired, so approving is refused. Reject it, or ask in the chat for a new one.'
        : r.otherSide ? 'This audience is on the other side of sign-up from this part of the site, so approving is refused.'
        : null;
      if (r.blocked === 'variant_history') card.appendChild(node('p', 'warn',
        'Approving will not show it yet: this component still runs its own variants test in code. Migrate it in the dashboard (Components → Migrate) first.'));
      if (refusal) card.appendChild(node('p', 'warn', refusal));

      var actions = node('div', 'actions');
      var approve = node('button', 'primary', 'Approve');
      var reject = node('button', null, 'Reject…');
      approve.setAttribute('type', 'button');
      reject.setAttribute('type', 'button');
      actions.appendChild(approve);
      actions.appendChild(reject);
      card.appendChild(actions);

      var why = node('div', null);
      why.hidden = true;
      var reasonId = 'reason-' + Math.random().toString(36).slice(2);
      var lab = node('label', 'meta', 'What is wrong with it? The next version written here is told to fix this.');
      lab.setAttribute('for', reasonId);
      var reason = node('textarea', null);
      reason.setAttribute('id', reasonId);
      reason.setAttribute('maxlength', '2000');
      var whyActions = node('div', 'actions');
      var confirmReject = node('button', 'primary', 'Reject with this reason');
      var cancel = node('button', null, 'Cancel');
      confirmReject.setAttribute('type', 'button');
      cancel.setAttribute('type', 'button');
      whyActions.appendChild(confirmReject);
      whyActions.appendChild(cancel);
      why.appendChild(lab);
      why.appendChild(reason);
      why.appendChild(whyActions);
      card.appendChild(why);

      var status = node('p', 'status', '');
      status.setAttribute('role', 'status');
      card.appendChild(status);

      function setBusy(b){ approve.disabled = b || !!refusal; reject.disabled = b; confirmReject.disabled = b; cancel.disabled = b; }
      function finish(text){
        __decided[__key(r)] = text;
        actions.hidden = true; why.hidden = true;
        status.className = 'status'; status.textContent = text;
      }
      if (__decided[__key(r)]) { finish(__decided[__key(r)]); return card; }
      if (!projectId) {
        approve.disabled = true; reject.disabled = true;
        status.textContent = 'Cannot act from here: the project id is missing. Ask in the chat to approve or reject.';
        return card;
      }
      approve.disabled = !!refusal;

      function decide(action, feedback){
        setBusy(true);
        status.className = 'status';
        status.textContent = action === 'approve' ? 'Approving…' : 'Rejecting…';
        var args = { projectId: projectId, slotId: r.slotId, persona: r.persona, action: action };
        if (feedback) args.feedback = feedback;
        window.__callTool('${REVIEW_APP_TOOL}', args).then(function(res){
          if (res && res.isError) {
            setBusy(false);
            status.className = 'status error';
            status.textContent = __resultText(res) || 'The server refused this. Nothing changed.';
            return;
          }
          var text = __resultText(res) || (action === 'approve' ? 'Approved.' : 'Rejected.');
          finish(text);
          __log.push((action === 'approve' ? 'approved' : 'rejected') + ' the version for persona ' +
            JSON.stringify(String(r.persona)) + ' in slot ' + JSON.stringify(String(r.slotId)));
          window.__updateModelContext('In the SentientUI review view the user ' + __log.join('; ') +
            '. These are decided; list_cell_reviews no longer includes them.');
        }, function(e){
          setBusy(false);
          status.className = 'status error';
          status.textContent = __errText(e);
        });
      }
      approve.addEventListener('click', function(){ decide('approve'); });
      reject.addEventListener('click', function(){ why.hidden = false; actions.hidden = true; });
      cancel.addEventListener('click', function(){ why.hidden = true; actions.hidden = false; status.textContent = ''; });
      confirmReject.addEventListener('click', function(){
        var text = String(reason.value || '').trim();
        if (!text) { status.className = 'status error'; status.textContent = 'Say what is wrong first — it guides the next version.'; return; }
        decide('reject', text.slice(0, 2000));
      });
      return card;
    }
    window.__render = function(data){
      var reviews = (data && Array.isArray(data.reviews)) ? data.reviews : [];
      var total = Number(data && data.total) || reviews.length;
      var projectId = (data && typeof data.projectId === 'string' && data.projectId) || window.__toolArg('projectId');
      el('sub').textContent = total === 0 ? 'Nothing is waiting for your approval.'
        : total + ' version' + (total === 1 ? '' : 's') + ' waiting for your approval' +
          (total > reviews.length ? ' · showing the ' + reviews.length + ' oldest' : '');
      var root = el('viz');
      root.textContent = '';
      if (!reviews.length) { root.appendChild(node('div', 'empty', 'Generated versions that need a yes or no show up here.')); return; }
      reviews.forEach(function(r){ if (r && typeof r === 'object') root.appendChild(__card(r, projectId)); });
    };
  `,
};

/**
 * Build the complete standalone HTML document for a view. Fully self-contained:
 * no external URLs, safe for a sandboxed CSP iframe.
 */
export function buildTemplate(id: ViewId): string {
  const title = VIEW_TITLES[id];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — SentientUI</title>
<style>${SHARED_CSS}</style>
</head>
<body class="viz-root">
<h1>${title}</h1>
<p class="sub" id="sub">Waiting for data…</p>
<div class="rows" id="viz"><div class="empty">Loading…</div></div>
<p class="foot">SentientUI · rendered by your agent host</p>
<script>
// Render before bootstrap: the bootstrap may draw synchronously at load
// (window.openai.toolOutput is injected before the page runs).
window.__VIEW_ID = ${JSON.stringify(id)};
${HELPERS_JS}
${RENDER_JS[id]}
${BOOTSTRAP_JS}
</script>
</body>
</html>`;
}
