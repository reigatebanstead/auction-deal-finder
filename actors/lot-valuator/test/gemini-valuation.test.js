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

function responseWith(payload, { ok = true, status = 200, text = '' } = {}) {
    return {
        ok,
        status,
        json: async () => payload,
        text: async () => text,
    };
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
            return responseWith({
                candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_VALUATION) }] } }],
            });
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

test('includes Gemini error response details', async () => {
    await assert.rejects(
        generateGeminiValuation(LOT, {
            apiKey: 'test-key',
            fetchImpl: async () => responseWith({}, {
                ok: false,
                status: 429,
                text: '{"error":"quota exceeded"}',
            }),
        }),
        /Gemini valuation failed \(429\).*quota exceeded/,
    );
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
