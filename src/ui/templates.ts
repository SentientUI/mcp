// Self-contained HTML UI templates for MCP Apps / MCP-UI hosts.
//
// Each template is a complete, standalone HTML document with inline CSS + JS and
// ZERO external references (no CDN, fonts, or network) so it renders inside a
// sandboxed host iframe and passes a strict CSP. A UI-capable agent host renders
// these; hosts without UI support fall back to the tool's existing text/JSON.
//
// Colors come from the dataviz reference palette: a single validated blue hue for
// magnitude bars (no categorical set, so no CVD validation needed) plus the fixed
// `good`/`critical` status colors, which always ship paired with a ▲/▼ icon + sign
// so meaning is never carried by color alone. Light and dark are both selected.

export type VizId = 'persona-breakdown' | 'variant-performance' | 'goal-funnel' | 'layout-stats';

export const VIZ_TITLES: Record<VizId, string> = {
  'persona-breakdown': 'Persona breakdown',
  'variant-performance': 'Variant performance',
  'goal-funnel': 'Goal funnel',
  'layout-stats': 'Layout stats',
};

// --- Shared chrome -----------------------------------------------------------

const SHARED_CSS = `
  :root {
    --surface: #fcfcfb;
    --plane: #f9f9f7;
    --ink: #0b0b0b;
    --ink-2: #52514e;
    --muted: #898781;
    --track: #ecebe6;
    --border: rgba(11,11,11,0.10);
    --series-1: #2a78d6;
    --good: #006300;
    --critical: #c0392b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --surface: #1a1a19;
      --plane: #0d0d0d;
      --ink: #ffffff;
      --ink-2: #c3c2b7;
      --muted: #898781;
      --track: #2c2c2a;
      --border: rgba(255,255,255,0.10);
      --series-1: #3987e5;
      --good: #0ca30c;
      --critical: #e06a5c;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: var(--surface);
    color: var(--ink);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
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
`;

// Data acquisition: try known host globals on load, then listen for the message
// shapes used by MCP-UI and the OpenAI Apps SDK. Announces readiness to the host.
const BOOTSTRAP_JS = `
  function __extract(m){
    if (!m) return null;
    if (m.structuredContent) return m.structuredContent;
    if (m.toolOutput) return m.toolOutput;
    if (m.globals && m.globals.toolOutput) return m.globals.toolOutput;
    if (m.payload && m.payload.renderData) return __extract(m.payload.renderData);
    if (m.renderData) return __extract(m.renderData);
    return m;
  }
  function __boot(){
    try {
      var g = (window.openai && window.openai.toolOutput) || window.mcpUiRenderData ||
              (window.__MCP_UI__ && window.__MCP_UI__.toolOutput);
      if (g) { window.__render(g); return; }
    } catch (e) {}
    window.addEventListener('message', function(ev){
      var data = __extract(ev && ev.data);
      if (data && typeof data === 'object') { try { window.__render(data); } catch (e) {} }
    });
    try {
      window.parent.postMessage({ type: 'ui-lifecycle-iframe-ready' }, '*');
      window.parent.postMessage({ type: 'openai:request_globals' }, '*');
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __boot);
  else __boot();
`;

// --- Per-viz render bodies (run in the host iframe) --------------------------

const RENDER_JS: Record<VizId, string> = {
  'persona-breakdown': `
    window.__render = function(data){
      var clusters = (data && data.clusters) || [];
      var total = (data && data.totalSessions) || 0;
      el('sub').textContent = total + ' total sessions across ' + clusters.length + ' persona' + (clusters.length === 1 ? '' : 's');
      if (!clusters.length) { showEmpty('No persona clusters yet — more visitor data is needed.'); return; }
      var sorted = clusters.slice().sort(function(a,b){ return (b.sharePct||0) - (a.sharePct||0); });
      el('viz').innerHTML = sorted.map(function(c){
        var rel = Math.round((c.reliability || 0) * 100);
        return barRow(c.label, pct1(c.sharePct), c.sharePct,
          c.sessionCount + ' sessions · reliability ' + rel + '%');
      }).join('');
    };
  `,
  'variant-performance': `
    window.__render = function(data){
      var variants = (data && data.variants) || [];
      el('sub').textContent = variants.length + ' variant' + (variants.length === 1 ? '' : 's') + ' · conversion, last 7 days vs prior 7';
      if (!variants.length) { showEmpty('No variant data available yet.'); return; }
      var max = variants.reduce(function(m,v){ return Math.max(m, v.currentCvr || 0); }, 0) || 1;
      var sorted = variants.slice().sort(function(a,b){ return (b.currentCvr||0) - (a.currentCvr||0); });
      el('viz').innerHTML = sorted.map(function(v){
        var cur = (v.currentCvr || 0) * 100;
        var dp = Number(v.deltaPp) || 0;
        var dir = dp > 0.05 ? 'up' : dp < -0.05 ? 'down' : 'flat';
        var arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
        var sign = dp > 0 ? '+' : '';
        var deltaHtml = '<span class="delta ' + dir + '">' + arrow + ' ' + sign + dp.toFixed(1) + ' pp</span>';
        var head = '<div class="row-head"><span class="label">' + esc(v.variantId) +
          '</span><span class="val">' + cur.toFixed(2) + '% ' + deltaHtml + '</span></div>';
        return '<div class="row">' + head +
          '<div class="track"><span class="bar" style="width:' + clampPct((v.currentCvr || 0) / max * 100) + '%"></span></div>' +
          '<div class="meta">prior ' + ((v.priorCvr||0)*100).toFixed(2) + '% · momentum ' + esc(v.momentum || 'stable') + '</div></div>';
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
        var best = (g.variants || []).slice().sort(function(a,b){ return (b.completionRate||0)-(a.completionRate||0); })[0];
        var meta = g.hits + ' hits · ' + g.uniqueSessions + ' unique sessions' +
          (best ? ' · best: ' + esc(best.componentId + '/' + best.variantId) + ' ' + ((best.completionRate||0)*100).toFixed(1) + '%' : '');
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
        return '<div class="row">' + head +
          '<div class="track"><span class="bar" style="width:' + clampPct((l.avgReward||0)/max*100) + '%"></span></div>' +
          '<div class="chips">' + order + '</div>' +
          '<div class="meta">' + (l.pulls || 0) + ' pulls</div></div>';
      }).join('');
    };
  `,
};

/**
 * Build the complete standalone HTML document for a viz. Fully self-contained:
 * no external URLs, safe for a sandboxed CSP iframe.
 */
export function buildTemplate(id: VizId): string {
  const title = VIZ_TITLES[id];
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
${HELPERS_JS}
${RENDER_JS[id]}
${BOOTSTRAP_JS}
</script>
</body>
</html>`;
}
