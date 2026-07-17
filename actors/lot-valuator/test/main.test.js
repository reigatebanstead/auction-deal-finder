import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runGeminiTestMode } from '../gemini-test-mode.js';

function makeDeps(fetchComparables) {
    const pushed = [];
    const stored = {};

    return {
        deps: {
            pushData: async (item) => { pushed.push(structuredClone(item)); },
            setValue: async (key, value) => { stored[key] = structuredClone(value); },
            fetchComparables,
        },
        pushed,
        stored,
    };
}

const VALID_EVIDENCE = {
    soldCount: 2,
    activeCount: 1,
    sellThroughRate: 66.67,
    marketLiquidity: 'Medium',
    soldComparables: [{ title: 'Sold A', soldPrice: 100 }],
    activeListings: [{ title: 'Active B', askingPrice: 150 }],
};

const REQUIRED_FIELDS = [
    'soldCount',
    'activeCount',
    'sellThroughRate',
    'liquidityAssessment',
    'soldListings',
    'activeListings',
    'errors',
];

function assertRequiredFields(result) {
    for (const field of REQUIRED_FIELDS) {
        assert.ok(Object.hasOwn(result, field), `result must contain field: ${field}`);
    }
}

test('calls fetchComparables once and writes one matching dataset/OUTPUT result', async () => {
    let callCount = 0;
    let capturedArgs;
    const state = makeDeps(async (args) => {
        callCount++;
        capturedArgs = args;
        return VALID_EVIDENCE;
    });

    const result = await runGeminiTestMode({
        testGeminiComparables: true,
        comparableQuery: 'Royal Doulton vase',
        comparableLimit: 5,
        comparableTimeoutMs: 250,
    }, state.deps);

    assert.equal(callCount, 1);
    assert.deepEqual(capturedArgs, {
        query: 'Royal Doulton vase',
        limit: 5,
        timeoutMs: 250,
    });
    assert.equal(state.pushed.length, 1);
    assert.deepEqual(state.stored.OUTPUT, state.pushed[0]);
    assert.deepEqual(result, state.pushed[0]);
    assertRequiredFields(result);
    assert.equal(result.errors.length, 0);
});

test('Gemini rejection produces one structured failure result', async () => {
    const error = Object.assign(new Error('Rate limit exceeded'), { name: 'RateLimitError' });
    const state = makeDeps(() => Promise.reject(error));

    await runGeminiTestMode({ comparableQuery: 'failing item' }, state.deps);

    assert.equal(state.pushed.length, 1);
    assert.deepEqual(state.stored.OUTPUT, state.pushed[0]);
    assertRequiredFields(state.pushed[0]);
    assert.deepEqual(state.pushed[0].errors, [{
        type: 'RateLimitError',
        message: 'Rate limit exceeded',
    }]);
});

test('hard timeout wins even when fetchComparables never settles', async () => {
    const state = makeDeps(() => new Promise(() => {}));

    const result = await runGeminiTestMode({
        comparableQuery: 'slow item',
        comparableTimeoutMs: 10,
    }, state.deps);

    assert.equal(state.pushed.length, 1, 'dataset must receive exactly one timeout result');
    assert.deepEqual(state.stored.OUTPUT, state.pushed[0], 'OUTPUT must match timeout dataset item');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].type, 'TimeoutError');
    assert.match(result.errors[0].message, /timed out after 10 ms/);
});

test('clears the hard-timeout timer after a successful fetch', async () => {
    const originalClearTimeout = globalThis.clearTimeout;
    let clearCount = 0;
    globalThis.clearTimeout = (timer) => {
        clearCount++;
        return originalClearTimeout(timer);
    };

    try {
        const state = makeDeps(() => Promise.resolve(VALID_EVIDENCE));
        await runGeminiTestMode({
            comparableQuery: 'fast item',
            comparableTimeoutMs: 1_000,
        }, state.deps);
        assert.equal(clearCount, 1);
    } finally {
        globalThis.clearTimeout = originalClearTimeout;
    }
});

test('missing query writes one failure without calling fetchComparables', async () => {
    let fetchCalled = 0;
    const state = makeDeps(() => {
        fetchCalled++;
        return Promise.resolve(VALID_EVIDENCE);
    });

    await runGeminiTestMode({ comparableQuery: '   ' }, state.deps);

    assert.equal(fetchCalled, 0);
    assert.equal(state.pushed.length, 1);
    assert.deepEqual(state.stored.OUTPUT, state.pushed[0]);
    assert.equal(state.pushed[0].errors.length, 1);
});

test('runGeminiTestMode dependencies do not include exit', async () => {
    const state = makeDeps(() => Promise.resolve(VALID_EVIDENCE));
    assert.equal(Object.hasOwn(state.deps, 'exit'), false);
    await assert.doesNotReject(runGeminiTestMode({ comparableQuery: 'test item' }, state.deps));
});

test('main has one Actor.exit cleanup and explicitly returns after test mode', async () => {
    const source = await readFile(new URL('../main.js', import.meta.url), 'utf8');
    assert.equal((source.match(/Actor\.exit\s*\(/g) ?? []).length, 1);
    assert.match(
        source,
        /if \(input\.testGeminiComparables === true\)[\s\S]*?await runGeminiTestMode\([\s\S]*?\);\s*return;/,
    );
    assert.match(source, /finally\s*{\s*await Actor\.exit\(\);\s*}/);
});
