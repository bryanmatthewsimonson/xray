// Test helper: turn a Messages-API response object into the SSE stream
// the real endpoint sends, wrapped in a minimal Response.
//
// llm-client.js streams (`stream: true`) and reassembles. A stub that
// returns `{ok, json()}` would therefore exercise a code path production
// never takes — green, and meaningless. Stubs use `sseResponse(msg)`
// instead, so the canned response travels the same framing, chunking,
// and reassembly the live call does.

/** A response object → the event sequence the API would emit for it. */
export function sseEventsFor(message = {}) {
    const events = [{
        type: 'message_start',
        message: {
            id: message.id || 'msg_test',
            role: message.role || 'assistant',
            model: message.model || 'claude-test',
            usage: message.usage || null
        }
    }];

    (message.content || []).forEach((block, index) => {
        if (block && block.type === 'tool_use') {
            const { input, ...rest } = block;
            events.push({ type: 'content_block_start', index, content_block: { ...rest, input: {} } });
            // One delta carrying the whole payload: the fragment-boundary
            // cases are covered directly in tests/llm-stream.test.mjs.
            events.push({
                type: 'content_block_delta', index,
                delta: { type: 'input_json_delta', partial_json: JSON.stringify(input ?? {}) }
            });
        } else if (block && block.type === 'text') {
            events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
            events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text || '' } });
        } else {
            events.push({ type: 'content_block_start', index, content_block: { ...(block || {}) } });
        }
        events.push({ type: 'content_block_stop', index });
    });

    events.push({
        type: 'message_delta',
        delta: {
            stop_reason: message.stop_reason ?? null,
            ...(message.stop_details !== undefined ? { stop_details: message.stop_details } : {})
        },
        ...(message.usage ? { usage: message.usage } : {})
    });
    events.push({ type: 'message_stop' });
    return events;
}

/** The wire text for those events. */
export function sseBody(message) {
    return sseEventsFor(message)
        .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
        .join('');
}

/**
 * A Response-alike whose body streams the given message.
 *
 * @param {object} message  the Messages-API response object to send
 * @param {object} [opts]
 * @param {number} [opts.chunk]  bytes per stream chunk — small values
 *        deliberately split frames mid-line, which is what the network
 *        does and what a naive parser gets wrong.
 */
export function sseResponse(message, { chunk = 64 } = {}) {
    const bytes = new TextEncoder().encode(sseBody(message));
    let pos = 0;
    return {
        ok: true,
        status: 200,
        body: {
            getReader() {
                return {
                    async read() {
                        if (pos >= bytes.length) return { done: true, value: undefined };
                        const value = bytes.slice(pos, pos + chunk);
                        pos += chunk;
                        return { done: false, value };
                    },
                    releaseLock() {}
                };
            }
        }
    };
}
