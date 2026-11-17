// The page harness's own click contract (tests/helpers/page-stub.mjs).
//
// The LLM-job consumer tests drive real page blocks by dispatching
// clicks on a DOM stub. Two rules keep such a click honest, and this
// file pins them:
//
//   - a dispatch NOTHING LISTENS FOR throws. It used to run zero
//     listeners and resolve, so a test that clicked a control its block
//     had appended but not yet wired carried on and read a page the
//     click never touched — a failure reported far from its cause, and
//     only when a poll happened to land in the window (JOURNAL
//     2026-11-16: once in nine full runs);
//   - `untilListening` hands a control back only once it is wired, and
//     says which half is missing — the node, or its listener — when the
//     wait runs out.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDomStub, untilListening } from './helpers/page-stub.mjs';

const { document, body } = installDomStub();

function mountButton(text) {
    const btn = document.createElement('button');
    btn.textContent = text;
    body.appendChild(btn);
    return btn;
}

test('page-stub: a dispatch nothing listens for throws — it never resolves as though the click had run', () => {
    const btn = mountButton('Unwired');
    assert.equal(btn.hasListener('click'), false);
    assert.throws(() => btn.dispatch('click'),
        /dispatch\('click'\) on <BUTTON> "Unwired" would run no listener/);

    // A listener of ANOTHER type does not answer a click.
    btn.addEventListener('keydown', () => {});
    assert.equal(btn.hasListener('click'), false);
    assert.throws(() => btn.dispatch('click'), /would run no listener/);
});

test('page-stub: a dispatch runs every listener of its type and awaits them all', async () => {
    const btn = mountButton('Wired');
    const ran = [];
    btn.addEventListener('click', (ev) => { ran.push(['sync', ev.type, ev.target === btn]); });
    btn.addEventListener('click', async () => {
        await new Promise((r) => setTimeout(r, 5));
        ran.push(['async']);
    });
    assert.equal(btn.hasListener('click'), true);
    await btn.dispatch('click');
    assert.deepEqual(ran, [['sync', 'click', true], ['async']], 'the async listener had settled when dispatch resolved');
});

test('page-stub: untilListening waits out a control that is rendered first and wired later', async () => {
    const btn = mountButton('Late');
    let clicks = 0;
    setTimeout(() => btn.addEventListener('click', () => { clicks += 1; }), 20);
    assert.equal(btn.hasListener('click'), false, 'rendered, not yet wired: the window');

    const node = await untilListening(body, 'Late');
    assert.equal(node, btn);
    await node.dispatch('click');
    assert.equal(clicks, 1);
});

test('page-stub: untilListening says which half is missing when the wait runs out', async () => {
    const quick = { tries: 3, ms: 1 };
    await assert.rejects(untilListening(body, 'Never rendered', 'click', quick),
        /no node with the text "Never rendered" rendered/);

    mountButton('Never wired');
    await assert.rejects(untilListening(body, 'Never wired', 'click', quick),
        /"Never wired" rendered, but nothing attached a click listener to it/);
});
