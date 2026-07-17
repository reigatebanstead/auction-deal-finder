/**
 * Behavioural tests for runGeminiTestMode.
 *
 * All Gemini network calls are injected via the `fetchComparables` dep so no real API
 * key or live marketplace access is required.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runGeminiTestMode } from '../gemini-test-mode.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a mock dependencies object and returns it alongside result recorders. */
function makeDeps(fetchComparables) {
    const pushed = [];
    const stored = {};
    let exitCount = 0;

    return {
        deps: {
            pushData: async (item) => { pushed.push(structuredClone(item)); },
            setValue: async (key, value) => { stored[key] = structuredClone(value); },
            exit: async () => { exitCount++; },
            fetchComparables,
        },
        pushed,
        stored,
        get exitCount() { return exitCount; },
    };
}

const VALID_EVIDENCE = {
    soldCount: 2,
    activeCount: 1,
    sellThroughRate: 66.67,
    marketLiquidity: 'Medium',
    soldComparables: [
        {
            source: 'ebay',
            title: 'Sold A',
            soldPrice: 100,
            currency: 'GBP',
            url: 'https://www.ebay.co.uk/itm/a',
            confidence: 'High',
        },
    ],
    activeListings: [
        {
            source: 'ebay',
            title: 'Active B',
            askingPrice: 150,
            currency: 'GBP',
            url: 'https://www.ebay.co.uk/itm/b',
            confidence: 'Medium',
        },
    ],
    model: 'gemini-2.5-flash',
    searchQueries: ['test query ebay'],
    groundingSources: [],
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

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

test('calls fetchComparables exactly once with the correct query and limit', async () => {
    let callCount = 0;
    let capturedArgs;

    const mock = (args) => {
        callCount++;
        capturedArgs = args;
        return Promise.resolve(VALID_EVIDENCE);
    };

    const { deps } = makeDeps(mock);
    await runGeminiTestMode(
        { testGeminiComparables: true, comparableQuery: 'Royal Doulton vase', comparableLimit: 5 },
        deps,
    );

    assert.equal(callCount, 1, 'fetchComparables must be called exactly once');
    assert.equal(capturedArgs.query, 'Royal Doulton vase');
    assert.equal(capturedArgs.limit, 5);
});

test('pushes exactly one item to the dataset on success', async () => {
    const { deps, pushed } = makeDeps(() => Promise.resolve(VALID_EVIDENCE));
    await runGeminiTestMode(
        { testGeminiComparables: true, comparableQuery: 'test item' },
        deps,
    );
    assert.equal(pushed.length, 1);
});

test('OUTPUT receives the same structured result as the dataset on success', async () => {
    const { deps, pushed, stored } = makeDeps(() => Promise.resolve(VALID_EVIDENCE));
    await runGeminiTestMode(
        { testGeminiComparables: true, comparableQuery: 'test item' },
        deps,
    );
    assert.deepEqual(stored.OUTPUT, pushed[0]);
});

test('success result contains all required fields with correct values', async () => {
    const { deps, pushed } = makeDeps(() => Promise.resolve(VALID_EVIDENCE));
    await runGeminiTestMode(
        { testGeminiComparables: true, comparableQuery: 'test item' },
        deps,
    );
    const result = pushed[0];

    assertRequiredFields(result);
    assert.equal(result.soldCount, VALID_EVIDENCE.soldCount);
    assert.equal(result.activeCount, VALID_EVIDENCE.activeCount);
    assert.equal(result.sellThroughRate, VALID_EVIDENCE.sellThroughRate);
    assert.equal(result.liquidityAssessment, VALID_EVIDENCE.marketLiquidity, 'liquidityAssessment must alias marketLiquidity');
    assert.deepEqual(result.soldListings, VALID_EVIDENCE.soldComparables, 'soldListings must alias soldComparables');
    assert.deepEqual(result.activeListings, VALID_EVIDENCE.activeListings);
    assert.deepEqual(result.errors, [], 'errors must be an empty array on success');
    assert.equal(result.query, 'test item');
});

test('exit is called exactly once on success', async () => {
    const state = makeDeps(() => Promise.resolve(VALID_EVIDENCE));
    await runGeminiTestMode(
        { testGeminiComparables: true, comparableQuery: 'test item' },
        state.deps,
    );
    assert.equal(state.exitCount, 1);
});

// ---------------------------------------------------------------------------
// Failure path: Gemini throws
// ---------------------------------------------------------------------------

test('Gemini error produces a structured failure result with a non-empty errors array', async () => {
    const geminiError = Object.assign(new Error('Rate limit exceeded'), { name: 'RateLimitError' });
    const { deps, pushed } = makeDeps(() => Promise.reject(geminiError));
    await runGeminiTestMode(
        { testGeminiComparables: true, comparableQuery: 'failing item' },
        deps,
    );

    const result = pushed[0];
    assertRequiredFields(result);
    assert.equal(result.soldCount, 0);
    assert.equal(result.activeCount, 0);
    assert.equal(result.sellThroughRate, null);
    assert.equal(result.liquidityAssessment, 'Unknown');
    assert.deepEqual(result.soldListings, []);
    assert.deepEqual(result.activeListings, []);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].type, 'RateLimitError');
    assert.equal(result.errors[0].message, geminiError.message);
});

test('failure: dataset receives exactly one item and OUTPUT matches', async () => {
    const { deps, pushed, stored } = makeDeps(() => Promise.reject(new Error('fail')));
    await runGeminiTestMode(
        { testGeminiComparables: true, comparableQuery: 'failing item' },
        deps,
    );
    assert.equal(pushed.length, 1);
    assert.deepEqual(stored.OUTPUT, pushed[0]);
});

test('exit is called exactly once even when Gemini throws', async () => {
    const state = makeDeps(() => Promise.reject(new Error('fail')));
    await runGeminiTestMode(
        { testGeminiComparables: true, comparableQuery: 'failing item' },
        state.deps,
    );
    assert.equal(state.exitCount, 1);
});

// ---------------------------------------------------------------------------
// Timeout path
// ---------------------------------------------------------------------------

test('timeout produces a structured failure result with TimeoutError details', async () => {
    const timeoutError = new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
    );
    const { deps, pushed, stored } = makeDeps(() => Promise.reject(timeoutError));
    await runGeminiTestMode(
        { testGeminiComparables: true, comparableQuery: 'slow item' },
        deps,
    );

    const result = pushed[0];
    assertRequiredFields(result);
    assert.equal(result.soldCount, 0);
    assert.equal(result.liquidityAssessment, 'Unknown');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].type, 'TimeoutError');
    assert.deepEqual(stored.OUTPUT, pushed[0], 'OUTPUT must match the dataset item on timeout');
});

// ---------------------------------------------------------------------------
// Missing query
// ---------------------------------------------------------------------------

test('missing query: produces a structured failure result without calling fetchComparables', async () => {
    let fetchCalled = 0;
    const { deps, pushed } = makeDeps(() => {
        fetchCalled++;
        return Promise.resolve(VALID_EVIDENCE);
    });

    await runGeminiTestMode(
        { testGeminiComparables: true, comparableQuery: '' },
        deps,
    );

    assert.equal(fetchCalled, 0, 'fetchComparables must not be called when query is empty');
    assert.equal(pushed.length, 1, 'dataset must still receive one item');
    assertRequiredFields(pushed[0]);
    assert.equal(pushed[0].errors.length, 1);
    assert.ok(pushed[0].errors[0].message.length > 0);
});

test('no normal lot-processing functions are called in test mode', async () => {
    // runGeminiTestMode only has access to the four injected deps.
    // If this test completes without any unexpected error, no Supabase or OpenAI
    // client was instantiated (there are no such deps in the signature).
    const { deps } = makeDeps(() => Promise.resolve(VALID_EVIDENCE));
    await assert.doesNotReject(
        runGeminiTestMode(
            { testGeminiComparables: true, comparableQuery: 'no-lot-processing item' },
            deps,
        ),
    );
});
