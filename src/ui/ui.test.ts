import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from '../api-client.js';
import { registerPersonaTools } from '../tools/personas.js';
import { registerGoalTools } from '../tools/goals.js';
import { registerLayoutTools } from '../tools/layout.js';
import { registerComponentTools } from '../tools/components.js';
import { registerCellTools } from '../tools/cells.js';
import {
  buildTemplate,
  registerUiResources,
  uiMeta,
  uiResourceUri,
  PUBLIC_UI_RESOURCE_URIS,
  RESOURCE_MIME_TYPE,
  UI_TOOL_VIEWS,
  VIEW_IDS,
} from './index.js';

describe('uiMeta / uiResourceUri', () => {
  it('produces a ui:// uri and the _meta.ui + outputTemplate pointers', () => {
    const meta = uiMeta('persona-breakdown');
    expect(uiResourceUri('persona-breakdown')).toBe('ui://sentientui/persona-breakdown');
    expect((meta.ui as any).resourceUri).toBe('ui://sentientui/persona-breakdown');
    expect(meta['openai/outputTemplate']).toBe('ui://sentientui/persona-breakdown');
  });

  // preferredFrameSize was never in the stable MCP Apps spec; sizing is the
  // view's ui/notifications/size-changed.
  it('carries no non-spec frame-size hint', () => {
    for (const id of VIEW_IDS) expect(JSON.stringify(uiMeta(id))).not.toContain('preferredFrameSize');
  });
});

describe('registerUiResources', () => {
  it('registers one ui:// resource per view with the spec-mandated mime type', async () => {
    const resources: Array<{ name: string; uri: string; config: any; cb: any }> = [];
    const fakeServer = {
      registerResource: vi.fn((name, uri, config, cb) => {
        resources.push({ name, uri, config, cb });
      }),
    };

    registerUiResources(fakeServer as any);

    // The spec mandates this exact media type; anything else is ignored by hosts.
    expect(RESOURCE_MIME_TYPE).toBe('text/html;profile=mcp-app');
    expect(resources.map((r) => r.uri).sort()).toEqual([...PUBLIC_UI_RESOURCE_URIS].sort());
    expect(resources).toHaveLength(VIEW_IDS.length);
    for (const r of resources) {
      expect(r.uri).toMatch(/^ui:\/\/sentientui\//);
      expect(r.config.mimeType).toBe(RESOURCE_MIME_TYPE);
      // The read callback returns the standalone HTML document, with the
      // resource _meta.ui where the spec reads it (the read contents).
      const result = await r.cb(new URL(r.uri));
      expect(result.contents[0].mimeType).toBe(RESOURCE_MIME_TYPE);
      expect(result.contents[0].text).toContain('<!doctype html>');
      expect(result.contents[0]._meta.ui.prefersBorder).toBe(true);
      // An absent csp is the spec's "no external origins" — never widen it.
      expect(result.contents[0]._meta.ui.csp).toBeUndefined();
    }
  });

  it('lists the review view as a public static template', () => {
    expect(PUBLIC_UI_RESOURCE_URIS).toContain('ui://sentientui/cell-review');
  });
});

describe('buildTemplate', () => {
  for (const id of VIEW_IDS) {
    it(`${id}: is a self-contained HTML doc with no external URLs`, () => {
      const html = buildTemplate(id);
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('window.__render');
      // Security/CSP: no network references of any kind.
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).not.toMatch(/\ssrc=/);
      expect(html).not.toMatch(/\shref=/);
      expect(html).not.toMatch(/@import/);
    });
  }

  // Untrusted text (model output, visitor-reachable page copy) must never be
  // parsed as HTML in the review view.
  it('cell-review builds its cards without innerHTML', () => {
    const html = buildTemplate('cell-review');
    const render = html.slice(html.indexOf('var __decided'), html.indexOf('var __b ='));
    expect(render).toContain('textContent');
    expect(render).not.toContain('innerHTML');
  });
});

describe('templates never rank arms by raw rate (S6)', () => {
  it('variant-performance groups by component and shows n + verdict, not a CVR sort', () => {
    const html = buildTemplate('variant-performance');
    expect(html).not.toMatch(/b\.currentCvr\|\|0\) - \(a\.currentCvr/);
    expect(html).toContain('v.componentId');
    expect(html).toContain('v.verdict');
    expect(html).toContain('sessions');
  });

  it('goal-funnel no longer crowns a "best" variant by raw completion rate', () => {
    expect(buildTemplate('goal-funnel')).not.toContain('best:');
  });
});

describe('view tools carry _meta.ui', () => {
  function captureTool(register: (s: any, c: ApiClient) => void) {
    const configs: Record<string, any> = {};
    const fakeServer = {
      registerTool: vi.fn((name, config) => {
        configs[name] = config;
      }),
    };
    register(fakeServer as any, new ApiClient({ apiKey: 'sk_test' }));
    return configs;
  }

  it('links each view tool to its ui:// template via _meta.ui', () => {
    const configs = {
      ...captureTool(registerPersonaTools),
      ...captureTool(registerGoalTools),
      ...captureTool(registerLayoutTools),
      ...captureTool(registerComponentTools),
      ...captureTool(registerCellTools),
    };

    for (const [tool, view] of Object.entries(UI_TOOL_VIEWS)) {
      const meta = configs[tool]?._meta;
      expect(meta, `${tool} should declare _meta`).toBeTruthy();
      expect(meta.ui.resourceUri).toBe(uiResourceUri(view));
    }
  });
});
