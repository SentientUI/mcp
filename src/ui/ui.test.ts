import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from '../api-client.js';
import { registerPersonaTools } from '../tools/personas.js';
import { registerGoalTools } from '../tools/goals.js';
import { registerLayoutTools } from '../tools/layout.js';
import { registerComponentTools } from '../tools/components.js';
import {
  buildTemplate,
  registerUiResources,
  uiMeta,
  uiResourceUri,
  UI_TOOL_VIZ,
  VIZ_TITLES,
  type VizId,
} from './index.js';

const VIZ_IDS = Object.keys(VIZ_TITLES) as VizId[];

describe('uiMeta / uiResourceUri', () => {
  it('produces a ui:// uri and the _meta.ui + outputTemplate pointers', () => {
    const meta = uiMeta('persona-breakdown');
    expect(uiResourceUri('persona-breakdown')).toBe('ui://sentientui/persona-breakdown');
    expect((meta.ui as any).resourceUri).toBe('ui://sentientui/persona-breakdown');
    expect(meta['openai/outputTemplate']).toBe('ui://sentientui/persona-breakdown');
  });
});

describe('registerUiResources', () => {
  it('registers one ui:// text/html resource per viz', async () => {
    const resources: Array<{ name: string; uri: string; config: any; cb: any }> = [];
    const fakeServer = {
      registerResource: vi.fn((name, uri, config, cb) => {
        resources.push({ name, uri, config, cb });
      }),
    };

    registerUiResources(fakeServer as any);

    expect(resources).toHaveLength(VIZ_IDS.length);
    for (const r of resources) {
      expect(r.uri).toMatch(/^ui:\/\/sentientui\//);
      expect(r.config.mimeType).toBe('text/html');
      // The read callback returns the standalone HTML document.
      const result = await r.cb(new URL(r.uri));
      expect(result.contents[0].mimeType).toBe('text/html');
      expect(result.contents[0].text).toContain('<!doctype html>');
    }
  });
});

describe('buildTemplate', () => {
  for (const id of VIZ_IDS) {
    it(`${id}: is a self-contained HTML doc with no external URLs`, () => {
      const html = buildTemplate(id);
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain(`<title>${VIZ_TITLES[id]}`);
      expect(html).toContain('window.__render');
      // Security/CSP: no network references of any kind.
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).not.toMatch(/\ssrc=/);
      expect(html).not.toMatch(/\shref=/);
      expect(html).not.toMatch(/@import/);
    });
  }
});

describe('data-viz tools carry _meta.ui', () => {
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

  it('links each data-viz tool to its ui:// template via _meta.ui', () => {
    const configs = {
      ...captureTool(registerPersonaTools),
      ...captureTool(registerGoalTools),
      ...captureTool(registerLayoutTools),
      ...captureTool(registerComponentTools),
    };

    for (const [tool, viz] of Object.entries(UI_TOOL_VIZ)) {
      const meta = configs[tool]?._meta;
      expect(meta, `${tool} should declare _meta`).toBeTruthy();
      expect(meta.ui.resourceUri).toBe(uiResourceUri(viz));
    }
  });
});
