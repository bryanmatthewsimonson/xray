// Missing-API shims for the pinned pdf.js 6.x on the oldest supported
// engines (the Firefox 128 ESR floor and older Chrome). pdf.js's modern
// build calls several very recent TC39 additions UNCONDITIONALLY:
//
//   - Map/WeakMap.prototype.getOrInsertComputed ("upsert" proposal —
//     Firefox 143 / Chrome 141): inside PDFPageProxy.getOperatorList
//     among others; without it figure extraction dies silently.
//   - Promise.try (Firefox 134 / Chrome 128): inside MessageHandler,
//     the main↔worker RPC that EVERY pdf.js call crosses — without it
//     the very first getDocument message throws and PDF capture is
//     dead on the whole Firefox 128–133 range.
//   - Math.sumPrecise (proposal): text layout measurement; degrades
//     positioning where missing.
//   - Uint8Array.fromBase64 / prototype.toBase64 (Firefox 133 /
//     Chrome 140): attachment, signature, and XFA content paths.
//
// Side-effect module: imported FIRST by both pdf-engine.js (main thread)
// and pdf-worker-entry.js (worker), so the methods exist before pdf.js
// runs in either context. Idempotent; a no-op where native support
// exists. Each shim covers exactly the call shapes pdf.js uses (checked
// against the pinned build) with proposal-faithful semantics.
//
// Upsert semantics per the proposal: getOrInsertComputed(key, callbackFn)
// calls callbackFn(key) only on a miss (nothing inserted if it throws);
// getOrInsert(key, value) inserts a plain default on a miss. Both return
// the stored value.

for (const Ctor of [
    typeof Map !== 'undefined' ? Map : null,
    typeof WeakMap !== 'undefined' ? WeakMap : null
]) {
    if (!Ctor) continue;
    const proto = Ctor.prototype;

    if (typeof proto.getOrInsertComputed !== 'function') {
        Object.defineProperty(proto, 'getOrInsertComputed', {
            value: function getOrInsertComputed(key, callbackFn) {
                if (this.has(key)) return this.get(key);
                const value = callbackFn(key);
                this.set(key, value);
                return value;
            },
            configurable: true,
            writable: true
        });
    }

    if (typeof proto.getOrInsert !== 'function') {
        Object.defineProperty(proto, 'getOrInsert', {
            value: function getOrInsert(key, value) {
                if (this.has(key)) return this.get(key);
                this.set(key, value);
                return value;
            },
            configurable: true,
            writable: true
        });
    }
}

// Promise.try — the spec calls the callback synchronously with the given
// arguments and reflects a sync throw as a rejection; `new this(...)`
// keeps subclass behavior.
if (typeof Promise.try !== 'function') {
    Object.defineProperty(Promise, 'try', {
        value: function (callbackFn, ...args) {
            return new this((resolve) => resolve(callbackFn(...args)));
        },
        configurable: true,
        writable: true
    });
}

// Uint8Array.fromBase64 / toBase64 — pdf.js calls both without options,
// so the default alphabet (handled by atob/btoa, which exist in both
// window and worker scopes) suffices. The spec ignores ASCII whitespace
// on decode.
if (typeof Uint8Array.fromBase64 !== 'function') {
    Object.defineProperty(Uint8Array, 'fromBase64', {
        value: function fromBase64(string) {
            const bin = atob(String(string).replace(/\s+/g, ''));
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out;
        },
        configurable: true,
        writable: true
    });
}
if (typeof Uint8Array.prototype.toBase64 !== 'function') {
    Object.defineProperty(Uint8Array.prototype, 'toBase64', {
        value: function toBase64() {
            let bin = '';
            const CHUNK = 0x8000;   // String.fromCharCode arg-count limit
            for (let i = 0; i < this.length; i += CHUNK) {
                bin += String.fromCharCode.apply(null, this.subarray(i, i + CHUNK));
            }
            return btoa(bin);
        },
        configurable: true,
        writable: true
    });
}

// Math.sumPrecise (TC39 proposal) — pdf.js 6.x uses it for text layout
// measurement; also absent from the Firefox 128 floor / older Chrome, where
// it emits a caught warning and degrades positioning. A compensated
// (Kahan-Neumaier) sum is a faithful-enough fallback where it is missing.
if (typeof Math.sumPrecise !== 'function') {
    Object.defineProperty(Math, 'sumPrecise', {
        value: function sumPrecise(values) {
            let sum = 0;
            let compensation = 0;
            for (const raw of values) {
                const value = Number(raw);
                const t = sum + value;
                compensation += Math.abs(sum) >= Math.abs(value)
                    ? (sum - t) + value
                    : (value - t) + sum;
                sum = t;
            }
            return sum + compensation;
        },
        configurable: true,
        writable: true
    });
}
