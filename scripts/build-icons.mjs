#!/usr/bin/env node
// Rasterize icons/source.svg to icons/icon-{16,48,128}.png at the
// sizes the manifest references. Run on demand (`npm run icons`)
// when source.svg changes — not in CI, since the PNGs are checked
// in alongside the SVG so a fresh clone works without the dev dep.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'icons/source.svg');
const SIZES = [16, 48, 128];

const svg = readFileSync(SRC, 'utf8');
console.log(`Rasterizing icons/source.svg at ${SIZES.join(', ')}px:`);

for (const size of SIZES) {
    const r = new Resvg(svg, {
        fitTo: { mode: 'width', value: size },
        background: 'rgba(0,0,0,0)'
    });
    const png = r.render().asPng();
    const out = resolve(ROOT, `icons/icon-${size}.png`);
    writeFileSync(out, png);
    console.log(`  → icons/icon-${size}.png  (${png.length} bytes)`);
}
