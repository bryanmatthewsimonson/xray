// TC39 "upsert" proposal shims — Map/WeakMap.prototype.getOrInsert and
// getOrInsertComputed. pdf.js 6.x calls getOrInsertComputed unconditionally
// (e.g. inside PDFPageProxy.getOperatorList), but the method only landed in
// very recent engines — it is ABSENT from the Firefox 128 floor and older
// Chrome. Without it, getOperatorList() throws, which silently kills PDF
// figure extraction (the text path uses a different call and still works).
//
// Side-effect module: imported FIRST by both pdf-engine.js (main thread) and
// pdf-worker-entry.js (worker), so the method exists before pdf.js runs in
// either context. Idempotent; a no-op where native support exists.
//
// Semantics per the proposal: getOrInsertComputed(key, callbackFn) calls
// callbackFn(key) only on a miss; getOrInsert(key, value) inserts a plain
// default on a miss. Both return the stored value.

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
