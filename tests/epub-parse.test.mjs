// EPUB parser — the ZIP reader + pure path/date helpers. The XML/XHTML→
// markdown parts need DOMParser (browser) and are verified in-extension;
// here we cross-validate the central-directory reader (built with node's
// zlib, inflated by the module's DecompressionStream) and the helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

const { readZipEntries, resolveHref, parseEpubDate } = await import('../src/shared/epub-parse.js');

function concat(...arrs) {
    let len = 0;
    for (const a of arrs) len += a.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
}

// Minimal ZIP writer (stored=0 / deflate=8). CRC is left 0 — readZipEntries
// does not verify it, and this exercises the header/offset math + inflate.
function buildZip(files) {
    const enc = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const f of files) {
        const name = enc.encode(f.name);
        const stored = f.method === 8 ? new Uint8Array(zlib.deflateRawSync(Buffer.from(f.data))) : f.data;
        const lh = new Uint8Array(30 + name.length);
        const ldv = new DataView(lh.buffer);
        ldv.setUint32(0, 0x04034b50, true);
        ldv.setUint16(4, 20, true);
        ldv.setUint16(8, f.method, true);
        ldv.setUint32(18, stored.length, true);
        ldv.setUint32(22, f.data.length, true);
        ldv.setUint16(26, name.length, true);
        lh.set(name, 30);
        locals.push(concat(lh, stored));

        const ch = new Uint8Array(46 + name.length);
        const cdv = new DataView(ch.buffer);
        cdv.setUint32(0, 0x02014b50, true);
        cdv.setUint16(4, 20, true);
        cdv.setUint16(6, 20, true);
        cdv.setUint16(10, f.method, true);
        cdv.setUint32(20, stored.length, true);
        cdv.setUint32(24, f.data.length, true);
        cdv.setUint16(28, name.length, true);
        cdv.setUint32(42, offset, true);
        ch.set(name, 46);
        centrals.push(ch);
        offset += lh.length + stored.length;
    }
    const cdStart = offset;
    const cdSize = centrals.reduce((n, c) => n + c.length, 0);
    const eocd = new Uint8Array(22);
    const edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(8, files.length, true);
    edv.setUint16(10, files.length, true);
    edv.setUint32(12, cdSize, true);
    edv.setUint32(16, cdStart, true);
    return concat(...locals, ...centrals, eocd);
}

test('epub-parse: readZipEntries reads stored + deflate entries', async () => {
    const enc = new TextEncoder();
    const a = enc.encode('hello stored world');
    const b = enc.encode('deflate me please '.repeat(30));   // compressible
    const zipBytes = buildZip([
        { name: 'mimetype', data: enc.encode('application/epub+zip'), method: 0 },
        { name: 'a.txt', data: a, method: 0 },
        { name: 'OEBPS/b.txt', data: b, method: 8 }
    ]);
    const zip = await readZipEntries(zipBytes);
    assert.deepEqual(zip.names.sort(), ['OEBPS/b.txt', 'a.txt', 'mimetype']);
    assert.ok(zip.has('a.txt') && zip.has('OEBPS/b.txt') && !zip.has('nope'));
    assert.deepEqual([...(await zip.read('a.txt'))], [...a], 'stored entry round-trips');
    assert.deepEqual([...(await zip.read('OEBPS/b.txt'))], [...b], 'deflate entry inflates correctly');
    await assert.rejects(() => zip.read('missing.txt'), /not found/i);
});

test('epub-parse: readZipEntries rejects a non-ZIP', async () => {
    await assert.rejects(() => readZipEntries(new Uint8Array([1, 2, 3, 4, 5])), /no end-of-central-directory/i);
});

test('epub-parse: resolveHref resolves OPF-relative paths + strips fragments', () => {
    assert.equal(resolveHref('OEBPS', 'ch1.xhtml'), 'OEBPS/ch1.xhtml');
    assert.equal(resolveHref('OEBPS/text', '../images/c.png'), 'OEBPS/images/c.png');
    assert.equal(resolveHref('OEBPS', 'ch1.xhtml#frag'), 'OEBPS/ch1.xhtml');
    assert.equal(resolveHref('OEBPS', './sub/./x.xhtml'), 'OEBPS/sub/x.xhtml');
    assert.equal(resolveHref('', 'a/b/c.xhtml'), 'a/b/c.xhtml');
    assert.equal(resolveHref('OEBPS', ''), '');
});

test('epub-parse: parseEpubDate handles year-only, ISO, and junk', () => {
    assert.equal(parseEpubDate('2020'), Math.floor(Date.parse('2020-01-01') / 1000));
    assert.equal(parseEpubDate('2021-11-18'), Math.floor(Date.parse('2021-11-18') / 1000));
    assert.equal(parseEpubDate('2019-03-01T00:00:00Z'), Math.floor(Date.parse('2019-03-01T00:00:00Z') / 1000));
    assert.equal(parseEpubDate(''), null);
    assert.equal(parseEpubDate('not a date'), null);
});
