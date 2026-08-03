import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Inline the package version at build time so server.ts doesn't have to read it
// at runtime via `import.meta.url` — tsup's `shims` mangled import.meta in the
// split ESM output (`var import_meta = {}`), producing createRequire(undefined)
// and crashing the API on boot. Reading it here keeps a single source of truth.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  entry: ['src/index.ts', 'src/lib.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  // No source uses import.meta/__dirname/require anymore, so the shim (which is
  // what broke the ESM build) is unnecessary — keep it off to avoid recurrence.
  shims: false,
  banner: { js: '#!/usr/bin/env node' },
  define: { __PKG_VERSION__: JSON.stringify(version) },
});
