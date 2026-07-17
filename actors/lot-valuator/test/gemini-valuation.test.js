import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateGeminiValuation } from '../gemini-valuation.js';

const LOT = {
    title: 'Royal Doulton stoneware vase',
    auction_house: 'Example Auctions',
    current_bid: 40,
    start_price: 20,
    description: 'Signed stoneware vase',
    condition_report: 'Minor surface wear',
};

const VALID_VALUATION = {
    expectedResaleValue: 180,
    maximumHammerPrice: 85,
    expectedProfit: 45,
    confidence: 'Medium',
    reasoning: 'Comparable decorative stoneware suggests a modest resale market.',
    conditionRisks: ['Surface wear'],
};

function responseWith(payload, { ok = true, status = 200, text = '', headers = {} } = {}) {
    return {
        ok,
        status,
        headers: { get: (name) => headers[name.toLowerCase()] ?? null },
        json: async () => payload,
        text: async () => text,
    };
}

function validResponse() {
    return responseWith({
        candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_VALUATION) }] } }],
    });
}

test('calls Gemini generateContent with JSON schema and returns validated valuation', async () => {
    let capturedUrl;
    let capturedOptions;
    const result = await generateGeminiValuation(LOT, {
        apiKey: 'test-key',
        model: 'gemini-test-model',
        timeoutMs: 500,
        fetchImpl: async (url, options) => {
            capturedUrl = url;
            capturedOptions = options;
            return validResponse();
        },
    });

    assert.match(capturedUrl, /models\/gemini-test-model:generateContent$/);
    assert.equal(capturedOptions.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.responseSchema.type, 'OBJECT');
    assert.deepEqual(result, VALID_VALUATION);
});

test('requires GEMINI_API_KEY', async () => {
    await assert.rejects(
        generateGeminiValuation(LOT, { apiKey: '' }),
        /GEMINI_API_KEY is missing/,
    );
});

test('retries a 429 using the delay from the response body', async () => {
    let calls = 0;
    const delays = [];
    const retries = [];

    const result = await generateGeminiValuation(LOT, {
        apiKey: 'test-key',
        fetchImpl: async () => {
            calls += 1;
            if (calls === 1) {
                return responseWith({}, {
                    ok: false,
                    status: 429,
                    text: 'Please retry in 2.5s.',
                });
            }
            return validResponse();
        },
        sleepImpl: async (delayMs) => delays.push(delayMs),
        onRetry: (retry) => retries.push(retry),
    });

    assert.equal(calls, 2);
    assert.deepEqual(delays, [2500]);
    assert.equal(retries[0].status, 429);
    assert.deepEqual(result, VALID_VALUATION);
});

test('prefers Retry-After header for retry delay', async () => {
    let calls = 0;
    const delays = [];

    await generateGeminiValuation(LOT, {
        apiKey: 'test-key',
        fetchImpl: async () => {
            calls += 1;
            return calls === 1
                ? responseWith({}, {
                    ok: false,
                    status: 503,
                    text: 'temporarily unavailable',
                    headers: { 'retry-after': '4' },
                })
                : validResponse();
        },
        sleepImpl: async (delayMs) => delays.push(delayMs),
    });

    assert.deepEqual(delays, [4000]);
});

test('includes Gemini error response details after retries are exhausted', async () => {
    let calls = 0;
    await assert.rejects(
        generateGeminiValuation(LOT, {
            apiKey: 'test-key',
            maxRetries: 2,
            fetchImpl: async () => {
                calls += 1;
                return responseWith({}, {
                    ok: false,
                    status: 429,
                    text: '{"error":"quota exceeded"}',
                });
            },
            sleepImpl: async () => {},
        }),
        /Gemini valuation failed \(429\).*quota exceeded/,
    );
    assert.equal(calls, 3);
});

test('does not retry non-transient Gemini errors', async () => {
    let calls = 0;
    await assert.rejects(
        generateGeminiValuation(LOT, {
            apiKey: 'test-key',
            fetchImpl: async () => {
                calls += 1;
                return responseWith({}, {
                    ok: false,
                    status: 400,
                    text: 'bad request',
                });
            },
            sleepImpl: async () => {},
        }),
        /Gemini valuation failed \(400\).*bad request/,
    );
    assert.equal(calls, 1);
});

test('rejects invalid valuation fields', async () => {
    await assert.rejects(
        generateGeminiValuation(LOT, {
            apiKey: 'test-key',
            fetchImpl: async () => responseWith({
                candidates: [{
                    content: { parts: [{ text: JSON.stringify({ ...VALID_VALUATION, confidence: 'Certain' }) }] },
                }],
            }),
        }),
        /confidence must be High, Medium, or Low/,
    );
});

test('production actor no longer imports OpenAI or requires OPENAI_API_KEY', async () => {
    const source = await readFile(new URL('../main.js', import.meta.url), 'utf8');
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

    assert.doesNotMatch(source, /from ['"]openai['"]/);
    assert.doesNotMatch(source, /OPENAI_API_KEY/);
    assert.match(source, /generateGeminiValuation/);
    assert.match(source, /GEMINI_API_KEY/);
    assert.equal(Object.hasOwn(packageJson.dependencies, 'openai'), false);
});
