import test from 'node:test';
import assert from 'node:assert/strict';

import {
    fetchGeminiSoldComparables,
    normalizeActiveListing,
    normalizeComparable,
    summarizeComparableEvidence,
    summarizeMarketEvidence,
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

test('normalizes a valid active listing', () => {
    assert.equal(
        normalizeActiveListing({
            title: 'Active example',
            askingPrice: '£149.99',
            currency: 'GBP',
            url: 'https://www.ebay.co.uk/itm/456',
        }).askingPrice,
        149.99,
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
        normalizeActiveListing({
            askingPrice: 100,
            currency: 'GBP',
            url: 'https://example.com/item/123',
        }),
        null,
    );
});

test('deduplicates and calculates sold price statistics', () => {
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

test('calculates sell-through proxy and liquidity', () => {
    const sold = Array.from({ length: 8 }, (_, index) => ({
        title: `Sold ${index}`,
        soldPrice: 100 + index,
        currency: 'GBP',
        url: `https://www.ebay.co.uk/itm/sold-${index}`,
        confidence: 'High',
    }));
    const active = Array.from({ length: 2 }, (_, index) => ({
        title: `Active ${index}`,
        askingPrice: 150 + index,
        currency: 'GBP',
        url: `https://www.ebay.co.uk/itm/active-${index}`,
        confidence: 'High',
    }));

    const evidence = summarizeMarketEvidence('test item', sold, active);

    assert.equal(evidence.soldCount, 8);
    assert.equal(evidence.activeCount, 2);
    assert.equal(evidence.sellThroughRate, 80);
    assert.equal(evidence.marketLiquidity, 'High');
    assert.equal(evidence.soldPriceSummary.medianPrice, 103.5);
    assert.equal(evidence.activePriceSummary.medianPrice, 150.5);
});

test('fetches grounded Gemini market evidence with an injected fetch implementation', async () => {
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
                                            soldComparables: [
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
                                            activeListings: [
                                                {
                                                    title: 'Active example',
                                                    askingPrice: 225,
                                                    currency: 'GBP',
                                                    condition: 'Used',
                                                    url: 'https://www.ebay.co.uk/itm/1000',
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

    assert.equal(evidence.soldCount, 1);
    assert.equal(evidence.activeCount, 1);
    assert.equal(evidence.sellThroughRate, 50);
    assert.equal(evidence.soldComparables[0].soldPrice, 175);
    assert.deepEqual(evidence.searchQueries, ['sold example ebay']);
});
