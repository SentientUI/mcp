// Drives the inline view bootstrap against a simulated host: the template's
// <script> runs in a node:vm context with a minimal DOM and a fake
// window.parent that records every postMessage. No browser, no real host —
// this pins the message SEQUENCE the stable MCP Apps spec requires, which is
// what the old bootstrap got wrong (it never sent ui/initialize, so a spec
// host sent it nothing and the chart stayed blank).
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { buildTemplate, LEGACY_DELAY_MS, MCP_APPS_PROTOCOL_VERSION, REVIEW_APP_TOOL, type ViewId } from './index.js';

// --- Minimal DOM: only what the templates use --------------------------------

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

class FakeEl {
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  attributes: Record<string, string> = {};
  style: Record<string, unknown> & { props: Record<string, string>; setProperty(k: string, v: string): void } = {
    props: {},
    setProperty(k: string, v: string) {
      this.props[k] = v;
    },
  };
  className = '';
  hidden = false;
  disabled = false;
  value = '';
  scrollHeight = 240;
  scrollWidth = 480;
  private ownText = '';
  private html: string | null = null;
  private listeners: Record<string, Array<(e: unknown) => void>> = {};

  constructor(
    public tagName: string,
    private htmlWrites: string[],
  ) {}

  set textContent(v: string) {
    this.children = [];
    this.html = null;
    this.ownText = String(v);
  }
  get textContent(): string {
    const own =
      this.html !== null
        ? this.html.replace(/<[^>]*>/g, ' ').replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]!)
        : this.ownText;
    return own + this.children.map((c) => c.textContent).join(' ');
  }
  set innerHTML(v: string) {
    this.htmlWrites.push(String(v));
    this.children = [];
    this.ownText = '';
    this.html = String(v);
  }
  get innerHTML(): string {
    return this.html ?? '';
  }
  appendChild(c: FakeEl): FakeEl {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  setAttribute(k: string, v: string): void {
    this.attributes[k] = String(v);
  }
  getAttribute(k: string): string | null {
    return this.attributes[k] ?? null;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  click(): void {
    if (this.disabled) return;
    for (const fn of this.listeners.click ?? []) fn({});
  }
  /** Not hidden itself and under no hidden ancestor. */
  get shown(): boolean {
    if (this.hidden) return false;
    return this.parent ? this.parent.shown : true;
  }
  findAll(pred: (e: FakeEl) => boolean): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (n: FakeEl) => {
      if (pred(n)) out.push(n);
      n.children.forEach(walk);
    };
    this.children.forEach(walk);
    return out;
  }
}

type Msg = Record<string, any>;

function bootView(id: ViewId, opts: { openai?: Record<string, unknown> } = {}) {
  const htmlWrites: string[] = [];
  const mk = (tag: string) => new FakeEl(tag, htmlWrites);
  const root = mk('html');
  const body = mk('body');
  const sub = mk('p');
  const viz = mk('div');
  body.appendChild(sub);
  body.appendChild(viz);
  const sent: Msg[] = [];
  const timers: Array<() => void> = [];
  const windowListeners: Record<string, Array<(e: unknown) => void>> = {};
  // postMessage structured-clones; JSON round-trip is the same for these
  // plain messages and drops the vm realm's prototypes.
  const parent = { postMessage: (m: unknown) => sent.push(JSON.parse(JSON.stringify(m))) };
  const ctx: Record<string, unknown> = {
    parent,
    document: {
      readyState: 'complete',
      documentElement: root,
      body,
      getElementById: (eid: string) => ({ sub, viz })[eid as 'sub' | 'viz'] ?? null,
      createElement: (tag: string) => mk(tag),
      addEventListener: () => {},
    },
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (windowListeners[type] ??= []).push(fn);
    },
    ...(opts.openai ? { openai: opts.openai } : {}),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = buildTemplate(id);
  const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
  vm.runInContext(script, ctx);

  const dispatch = (type: string, ev: unknown) => (windowListeners[type] ?? []).forEach((fn) => fn(ev));
  return {
    sent,
    viz,
    sub,
    root,
    htmlWrites,
    /** A message from the host (or, with `source`, from some other window). */
    send(data: Msg, source: unknown = parent) {
      dispatch('message', { data, source });
    },
    dispatch,
    runTimers() {
      timers.splice(0).forEach((fn) => fn());
    },
    rpc(method: string): Msg[] {
      return sent.filter((m) => m.jsonrpc === '2.0' && m.method === method);
    },
  };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

/** Answer the view's ui/initialize the way a spec host does. */
async function initialize(v: ReturnType<typeof bootView>, hostContext: Msg = {}) {
  const req = v.rpc('ui/initialize')[0]!;
  v.send({
    jsonrpc: '2.0',
    id: req.id,
    result: {
      protocolVersion: MCP_APPS_PROTOCOL_VERSION,
      hostInfo: { name: 'test-host', version: '1.0.0' },
      hostCapabilities: { serverTools: {} },
      hostContext,
    },
  });
  await flush();
}

const PERSONAS = {
  totalPeople: 120,
  windowDays: 30,
  personas: [{ name: 'Evaluators', sharePct: 40, people: 48 }],
  behaviourGroups: [],
};

describe('MCP Apps handshake (spec 2026-01-26)', () => {
  it('sends ui/initialize first and nothing else until the host answers', () => {
    const v = bootView('persona-breakdown');
    expect(v.sent).toHaveLength(1);
    expect(v.sent[0]).toMatchObject({
      jsonrpc: '2.0',
      method: 'ui/initialize',
      params: {
        protocolVersion: '2026-01-26',
        appInfo: { name: 'sentientui-persona-breakdown' },
        appCapabilities: {},
      },
    });
    expect(typeof v.sent[0]!.id).toBe('number');
  });

  it('then sends initialized, and renders the structuredContent of tool-result', async () => {
    const v = bootView('persona-breakdown');
    await initialize(v);
    expect(v.sent.map((m) => m.method ?? null).slice(0, 2)).toEqual(['ui/initialize', 'ui/notifications/initialized']);

    v.send({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { projectId: 'p1' } } });
    // params IS the CallToolResult — structuredContent at its top level.
    v.send({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: { content: [{ type: 'text', text: 'summary' }], structuredContent: PERSONAS },
    });
    expect(v.viz.textContent).toContain('Evaluators');
    expect(v.sub.textContent).toContain('120 people');

    // The view sizes itself; there is no host-side frame-size hint.
    const size = v.rpc('ui/notifications/size-changed').at(-1)!;
    expect(size.params).toEqual({ width: 480, height: 240 });
  });

  it('never sends the legacy MCP-UI / OpenAI announcements to a spec host', async () => {
    const v = bootView('persona-breakdown');
    await initialize(v);
    v.runTimers();
    expect(v.sent.every((m) => m.jsonrpc === '2.0')).toBe(true);
  });

  it('applies the host theme and only well-formed style variables', async () => {
    const v = bootView('goal-funnel');
    await initialize(v, {
      theme: 'dark',
      styles: { variables: { '--color-background-primary': '#101010', 'color': 'red', '--x;}body{': 'red', '--font-sans': 42 } },
    });
    expect(v.root.getAttribute('data-theme')).toBe('dark');
    expect(v.root.style.props).toEqual({ '--color-background-primary': '#101010' });

    v.send({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'light' } });
    expect(v.root.getAttribute('data-theme')).toBe('light');
  });

  it('shows an error result as an error, not as an empty chart', async () => {
    const v = bootView('persona-breakdown');
    await initialize(v);
    v.send({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: { isError: true, content: [{ type: 'text', text: 'Project not found.' }] },
    });
    expect(v.viz.textContent).toContain('Project not found.');
    expect(v.viz.textContent).not.toContain('No served visitors');
  });

  it('ignores messages from any window but its parent', async () => {
    const v = bootView('persona-breakdown');
    await initialize(v);
    v.send(
      { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: PERSONAS } },
      { postMessage() {} },
    );
    expect(v.viz.textContent).not.toContain('Evaluators');
  });

  it('answers host requests: ping and teardown with {}, unknown methods with -32601', async () => {
    const v = bootView('persona-breakdown');
    await initialize(v);
    v.send({ jsonrpc: '2.0', id: 'h1', method: 'ping' });
    v.send({ jsonrpc: '2.0', id: 'h2', method: 'ui/resource-teardown', params: {} });
    v.send({ jsonrpc: '2.0', id: 'h3', method: 'ui/made-up' });
    expect(v.sent.find((m) => m.id === 'h1')).toEqual({ jsonrpc: '2.0', id: 'h1', result: {} });
    expect(v.sent.find((m) => m.id === 'h2')).toEqual({ jsonrpc: '2.0', id: 'h2', result: {} });
    expect(v.sent.find((m) => m.id === 'h3')?.error?.code).toBe(-32601);
  });
});

describe('fallbacks for hosts without the spec bridge', () => {
  it('window.openai: renders toolOutput at load, then announces legacy readiness when initialize goes unanswered', () => {
    const v = bootView('persona-breakdown', { openai: { toolOutput: PERSONAS, theme: 'dark' } });
    expect(v.viz.textContent).toContain('Evaluators');
    expect(v.root.getAttribute('data-theme')).toBe('dark');
    expect(LEGACY_DELAY_MS).toBeGreaterThan(0);
    v.runTimers();
    expect(v.sent.map((m) => m.type).filter(Boolean)).toEqual(['ui-lifecycle-iframe-ready', 'openai:request_globals']);
  });

  it('window.openai: re-renders on openai:set_globals', () => {
    const v = bootView('persona-breakdown', { openai: {} });
    v.dispatch('openai:set_globals', { detail: { globals: { toolOutput: PERSONAS } } });
    expect(v.viz.textContent).toContain('Evaluators');
  });

  it('MCP-UI: renders render-data, but not an arbitrary message', () => {
    const v = bootView('persona-breakdown');
    v.runTimers();
    // The old fallback rendered ANY object as the tool's data.
    v.send({ type: 'something-else', foo: 1 });
    expect(v.htmlWrites).toHaveLength(0);
    v.send({ type: 'ui-lifecycle-iframe-render-data', payload: { renderData: { toolOutput: { structuredContent: PERSONAS } } } });
    expect(v.viz.textContent).toContain('Evaluators');
  });
});

const REVIEWS = {
  projectId: '00000000-0000-4000-8000-000000000001',
  total: 3,
  reviews: [
    {
      slotId: 'hero', slotName: 'Hero', persona: 'evaluator', personaDisplay: 'Declared: Evaluator',
      content: 'Try it free <img src=x onerror=alert(1)>', rationale: 'Evaluators compare', refinedFrom: null,
      updatedAt: '2026-11-01T00:00:00Z', blocked: null, outline: null, page: '/pricing', audienceRetired: false, otherSide: false,
    },
    {
      slotId: 'band', slotName: 'Feature band', persona: 'unknown', personaDisplay: 'Everyone',
      content: null, rationale: null, refinedFrom: 'unknown_v1', updatedAt: '2026-11-01T00:00:00Z', blocked: null,
      outline: [{ depth: 0, kind: 'heading 2', style: 'Headline', text: 'Built for <b>teams</b>' }],
      page: null, audienceRetired: false, otherSide: false,
    },
    {
      slotId: 'aside', slotName: 'Aside', persona: 'd-old', personaDisplay: 'Discovered: Old',
      content: 'Old copy', rationale: null, refinedFrom: null, updatedAt: '2026-11-01T00:00:00Z', blocked: null,
      outline: null, page: null, audienceRetired: true, otherSide: false,
    },
  ],
};

function buttons(v: ReturnType<typeof bootView>, label: string): FakeEl[] {
  return v.viz.findAll((e) => e.tagName === 'button' && e.textContent === label);
}

async function bootReview() {
  const v = bootView('cell-review');
  await initialize(v);
  v.send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: REVIEWS } });
  return v;
}

describe('cell-review view', () => {
  it('shows each draft, its audience and outline as text — never parsed as HTML', async () => {
    const v = await bootReview();
    const text = v.viz.textContent;
    expect(text).toContain('Try it free <img src=x onerror=alert(1)>');
    expect(text).toContain('for Declared: Evaluator');
    expect(text).toContain('heading 2 · Headline');
    expect(text).toContain('Built for <b>teams</b>');
    expect(text).toContain('Lives on /pricing');
    expect(text).toContain('Would replace unknown_v1');
    expect(v.sub.textContent).toContain('3 versions waiting');
    expect(v.htmlWrites.some((h) => h.includes('<img') || h.includes('<b>'))).toBe(false);
  });

  it('disables Approve when the API would refuse it, and says why', async () => {
    const v = await bootReview();
    const approve = buttons(v, 'Approve');
    expect(approve.map((b) => b.disabled)).toEqual([false, false, true]);
    expect(v.viz.textContent).toContain('audience was retired');
  });

  it('Approve calls the app-only tool via tools/call and shows the server sentence', async () => {
    const v = await bootReview();
    buttons(v, 'Approve')[0]!.click();
    const call = v.rpc('tools/call')[0]!;
    expect(call.params).toEqual({
      name: REVIEW_APP_TOOL,
      arguments: { projectId: REVIEWS.projectId, slotId: 'hero', persona: 'evaluator', action: 'approve' },
    });
    v.send({ jsonrpc: '2.0', id: call.id, result: { content: [{ type: 'text', text: 'Approved: now live.' }] } });
    await flush();
    expect(v.viz.textContent).toContain('Approved: now live.');
    expect(buttons(v, 'Approve')[0]!.shown).toBe(false);
    // The model is told, so it does not report the decided version as waiting.
    const ctx = v.rpc('ui/update-model-context').at(-1)!;
    expect(ctx.params.content[0].text).toContain('approved the version for persona "evaluator" in slot "hero"');
  });

  it('Reject needs a reason, sends it as feedback, and keeps the card open on a refusal', async () => {
    const v = await bootReview();
    buttons(v, 'Reject…')[1]!.click();
    const confirm = buttons(v, 'Reject with this reason')[1]!;
    expect(confirm.shown).toBe(true);

    confirm.click();
    expect(v.rpc('tools/call')).toHaveLength(0);
    expect(v.viz.textContent).toContain('Say what is wrong first');

    const reason = v.viz.findAll((e) => e.tagName === 'textarea')[1]!;
    reason.value = '  Off-brand tone  ';
    confirm.click();
    const call = v.rpc('tools/call')[0]!;
    expect(call.params.arguments).toEqual({
      projectId: REVIEWS.projectId, slotId: 'band', persona: 'unknown', action: 'reject', feedback: 'Off-brand tone',
    });
    v.send({
      jsonrpc: '2.0',
      id: call.id,
      result: { isError: true, content: [{ type: 'text', text: 'Agent access for Approve and publish is off.' }] },
    });
    await flush();
    expect(v.viz.textContent).toContain('Agent access for Approve and publish is off.');
    expect(confirm.disabled).toBe(false);
  });

  it('falls back to window.openai.callTool when the host has no spec bridge', async () => {
    const calls: unknown[] = [];
    const v = bootView('cell-review', {
      openai: {
        toolOutput: REVIEWS,
        callTool: (name: string, args: unknown) => {
          calls.push({ name, args });
          return Promise.resolve({ content: [{ type: 'text', text: 'Approved via openai.' }] });
        },
      },
    });
    buttons(v, 'Approve')[0]!.click();
    await flush();
    expect(calls).toEqual([
      { name: REVIEW_APP_TOOL, args: { projectId: REVIEWS.projectId, slotId: 'hero', persona: 'evaluator', action: 'approve' } },
    ]);
    expect(v.viz.textContent).toContain('Approved via openai.');
  });

  it('takes the project id from tool-input when the result lacks it', async () => {
    const v = bootView('cell-review');
    await initialize(v);
    v.send({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { projectId: 'from-input' } } });
    const { projectId: _omit, ...rest } = REVIEWS;
    v.send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: rest } });
    buttons(v, 'Approve')[0]!.click();
    expect(v.rpc('tools/call')[0]!.params.arguments.projectId).toBe('from-input');
  });
});
