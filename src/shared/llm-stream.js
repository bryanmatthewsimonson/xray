// Anthropic Messages STREAMING — the SSE wire, reassembled.
//
// WHY STREAM AT ALL. Every pass sends a forced `tool_choice`, so the
// answer arrives as one tool_use block and nothing renders
// incrementally — streaming is not a UX flourish here. It buys three
// things a single `await resp.json()` cannot:
//
//   1. NO WALL-CLOCK CEILING. A non-streaming response must arrive
//      whole before the fetch resolves, so raising an output cap
//      raises the odds of an HTTP/SW timeout with nothing to show for
//      it. A stream delivers continuously; the AbortController stays
//      the only limiter.
//   2. SALVAGE. When a call is cut off (`stop_reason: 'max_tokens'`),
//      the non-streaming path hands back partial, unparseable tool
//      JSON — a fully paid call, discarded. Here the partial text is
//      in hand, so a list-shaped payload can be trimmed to its last
//      COMPLETE element and used, with the loss disclosed.
//   3. PROGRESS. Byte counts and block starts are observable while the
//      call runs, so a long pass can say what it is doing.
//
// PURE: no chrome, no network, no DOM. llm-client.js owns the fetch and
// feeds decoded text in. That split is what makes the reassembly — the
// part with all the edge cases — unit-testable without a server.

// ------------------------------------------------------------------
// SSE framing
// ------------------------------------------------------------------

/**
 * Line-oriented SSE reader. `push` takes an arbitrary decoded chunk —
 * network chunks split anywhere, including mid-line and mid-UTF8 — and
 * returns the JSON payloads completed by it. Partial lines carry over.
 *
 * Only `data:` lines matter: every Anthropic stream event names itself
 * in the JSON (`{"type": "..."}`), so the `event:` line is redundant.
 */
export function createSseParser() {
    let buf = '';
    return {
        push(chunk) {
            buf += chunk;
            const out = [];
            let idx;
            while ((idx = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, idx).replace(/\r$/, '');
                buf = buf.slice(idx + 1);
                if (!line.startsWith('data:')) continue;      // event:/id:/retry:/blank
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                // A malformed data line is skipped rather than thrown:
                // one bad frame must not lose a whole paid response.
                try { out.push(JSON.parse(payload)); } catch (_) { /* skip */ }
            }
            return out;
        }
    };
}

// ------------------------------------------------------------------
// Partial-JSON salvage
// ------------------------------------------------------------------

/**
 * Parse JSON that may have been cut off mid-value.
 *
 * Walks the text tracking string/escape state and the open-container
 * stack, remembering the last position where a container CLOSED — the
 * last point at which every value so far is complete. Truncating there
 * and closing the still-open containers yields valid JSON holding every
 * complete element and nothing partial.
 *
 * This is deliberately conservative: it never repairs a value, only
 * drops an incomplete one. A caller must still treat the result as
 * SHORT — `salvaged` is true precisely when content was lost, and the
 * loss has to reach the human (guard rail: truncation is disclosed,
 * never silent).
 *
 * @returns {{ok:boolean, value?:any, salvaged?:boolean}}
 */
export function salvagePartialJson(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false };
    try { return { ok: true, value: JSON.parse(text), salvaged: false }; } catch (_) { /* fall through */ }

    const stack = [];
    let inStr = false, esc = false;
    let cut = -1, cutStack = null;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') { inStr = true; continue; }
        else if (c === '{') stack.push('}');
        else if (c === '[') stack.push(']');
        else if (c === '}' || c === ']') {
            stack.pop();
            // Every value up to here is complete — a valid cut point.
            cut = i;
            cutStack = stack.slice();
        }
    }

    if (cut === -1 || !cutStack || cutStack.length === 0) return { ok: false };
    const repaired = text.slice(0, cut + 1) + cutStack.reverse().join('');
    try { return { ok: true, value: JSON.parse(repaired), salvaged: true }; }
    catch (_) { return { ok: false }; }
}

// ------------------------------------------------------------------
// Event stream → Message
// ------------------------------------------------------------------

/**
 * Reassemble Anthropic stream events into the SAME object shape the
 * non-streaming endpoint returns — `{id, model, content, stop_reason,
 * stop_details, usage}` — so every existing caller (extractToolInput,
 * the stop_reason checks, refusalResult) works unchanged. That
 * shape-compatibility is the whole design constraint: streaming is a
 * transport change, not a contract change.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.salvage]  attempt partial-JSON recovery on a
 *        truncated tool call. OFF by default — only payloads that are a
 *        LIST of independent items (the map's atoms) are honest when
 *        short; a truncated audit or brief would read as complete.
 * @param {function} [opts.onProgress]  called with {type, blocks, chars}
 */
export function createMessageAssembler({ salvage = false, onProgress = null } = {}) {
    const msg = {
        id: '', type: 'message', role: 'assistant', model: '',
        content: [], stop_reason: null, stop_details: null, usage: null
    };
    const partials = new Map();       // block index → accumulated tool JSON
    let error = null;
    let salvaged = false;
    let chars = 0;

    const note = (type) => {
        if (onProgress) {
            try { onProgress({ type, blocks: msg.content.filter(Boolean).length, chars }); }
            catch (_) { /* a progress sink must never break the stream */ }
        }
    };

    return {
        handle(ev) {
            if (!ev || typeof ev.type !== 'string') return;
            switch (ev.type) {
                case 'message_start': {
                    const m = ev.message || {};
                    msg.id = m.id || '';
                    msg.model = m.model || '';
                    msg.role = m.role || 'assistant';
                    msg.usage = m.usage || null;
                    // A refusal can be decided before any output; the
                    // start frame already carries it.
                    if (m.stop_reason) msg.stop_reason = m.stop_reason;
                    if (m.stop_details) msg.stop_details = m.stop_details;
                    note('start');
                    break;
                }
                case 'content_block_start': {
                    const b = ev.content_block ? { ...ev.content_block } : {};
                    if (b.type === 'tool_use') { partials.set(ev.index, ''); b.input = {}; }
                    if (b.type === 'text' && typeof b.text !== 'string') b.text = '';
                    if (b.type === 'thinking' && typeof b.thinking !== 'string') b.thinking = '';
                    msg.content[ev.index] = b;
                    note('block');
                    break;
                }
                case 'content_block_delta': {
                    const b = msg.content[ev.index];
                    const d = ev.delta || {};
                    if (!b) break;
                    if (d.type === 'text_delta') { b.text = (b.text || '') + (d.text || ''); chars += (d.text || '').length; }
                    else if (d.type === 'thinking_delta') { b.thinking = (b.thinking || '') + (d.thinking || ''); }
                    else if (d.type === 'input_json_delta') {
                        const add = d.partial_json || '';
                        partials.set(ev.index, (partials.get(ev.index) || '') + add);
                        chars += add.length;
                    }
                    note('delta');
                    break;
                }
                case 'message_delta': {
                    const d = ev.delta || {};
                    if (d.stop_reason !== undefined) msg.stop_reason = d.stop_reason;
                    if (d.stop_details !== undefined) msg.stop_details = d.stop_details;
                    if (ev.usage) msg.usage = { ...(msg.usage || {}), ...ev.usage };
                    break;
                }
                case 'error':
                    error = (ev.error && ev.error.message) || 'The Anthropic stream reported an error.';
                    break;
                default: break;   // ping, content_block_stop, message_stop
            }
        },

        /**
         * @returns {{message:object, error:string|null, salvaged:boolean}}
         */
        result() {
            for (const [i, raw] of partials) {
                const b = msg.content[i];
                if (!b) continue;
                try {
                    b.input = raw ? JSON.parse(raw) : {};
                    continue;
                } catch (_) { /* truncated or malformed */ }

                const s = salvage ? salvagePartialJson(raw) : { ok: false };
                if (s.ok) { b.input = s.value; salvaged = true; }
                // Unrecoverable: DROP the block. Leaving it with an
                // empty input would read downstream as "the model
                // returned an empty extract" — a lie. Absent, it reads
                // as "no structured output", which is the truth.
                else msg.content[i] = null;
            }
            msg.content = msg.content.filter(Boolean);
            return { message: msg, error, salvaged };
        }
    };
}
