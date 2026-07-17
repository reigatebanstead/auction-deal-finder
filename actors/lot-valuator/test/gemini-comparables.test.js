import test from 'node:test';
import assert from 'node:assert/strict';

import {
    fetchGeminiSoldComparables,
    normalizeComparable,
    summarizeComparableEvidence,
} from '../gemini-comparables.js';

test('normalizes a valid GBP eBay sold comparable', () => {
    assert.deepEqual(
        normalizeComparable({
            title: 'Vintage example',
            soldPrice: '£125.50',
            currency: 'gbp',
            soldDate: '2026-07-01',
            condition: 'Used',
            url: 'https://www.ebay.co.uk/itm/123',
            confidence: 'High',
        }),
        {
            source: 'ebay',
            title: 'Vintage example',
            soldPrice: 125.5,
            currency: 'GBP',
            soldDate: '2026-07-01',
            condition: 'Used',
            url: 'https://www.ebay.co.uk/itm/123',
            confidence: 'High',
        },
    );
});

test('rejects unsupported currencies and non-eBay URLs', () => {
    assert.equal(
        normalizeComparable({
            soldPrice: 100,
            currency: 'USD',
            url: 'https://www.ebay.com/itm/123',
        }),
        null,
    );

    assert.equal(
        normalizeComparable({
            soldPrice: 100,
            currency: 'GBP',
            url: 'https://example.com/item/123',
        }),
        null,
    );
});

test('deduplicates and calculates evidence statistics', () => {
    const evidence = summarizeComparableEvidence('test item', [
        {
            title: 'A',
            soldPrice: 100,
            currency: 'GBP',
            url: 'https://www.ebay.co.uk/itm/a',
            confidence: 'High',
        },
        {
            title: 'A duplicate',
            soldPrice: 100,
            currency: 'GBP',
            url: 'https://www.ebay.co.uk/itm/a',
            confidence: 'High',
        },
        {
            title: 'B',
            soldPrice: 200,
            currency: 'GBP',
            url: 'https://www.ebay.co.uk/itm/b',
            confidence: 'Medium',
        },
    ]);

    assert.equal(evidence.resultCount, 2);
    assert.equal(evidence.lowPrice, 100);
    assert.equal(evidence.medianPrice, 150);
    assert.equal(evidence.highPrice, 200);
    assert.equal(evidence.averagePrice, 150);
});

test('fetches grounded Gemini evidence with an injected fetch implementation', async () => {
    const fakeFetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.deepEqual(body.tools, [{ google_search: {} }]);

        return {
            ok: true,
            async json() {
                return {
                    candidates: [
                        {
                            content: {
                                parts: [
                                    {
                                        text: JSON.stringify({
                                            comparables: [
                                                {
                                                    title: 'Sold example',
                                                    soldPrice: 175,
                                                    currency: 'GBP',
                                                    soldDate: null,
                                                    condition: 'Used',
                                                    url: 'https://www.ebay.co.uk/itm/999',
                                                    confidence: 'Medium',
                                                },
                                            ],
                                        }),
                                    },
                                ],
                            },
                            groundingMetadata: {
                                webSearchQueries: ['sold example ebay'],
                                groundingChunks: [
                                    {
                                        web: {
                                            uri: 'https://www.ebay.co.uk/itm/999',
                                            title: 'Sold example',
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                };
            },
        };
    };

    const evidence = await fetchGeminiSoldComparables({
        query: 'sold example',
        apiKey: 'test-key',
        fetchImpl: fakeFetch,
    });

    assert.equal(evidence.resultCount, 1);
    assert.equal(evidence.comparables[0].soldPrice, 175);
    assert.deepEqual(evidence.searchQueries, ['sold example ebay']);
});
