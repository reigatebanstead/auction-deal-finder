import { fetchGeminiSoldComparables as defaultFetchComparables } from './gemini-comparables.js';

function buildSuccessResult(query, evidence) {
    return {
        mode: 'gemini-ebay-sold-comparables-test',
        query,
        soldCount: evidence.soldCount,
        activeCount: evidence.activeCount,
        sellThroughRate: evidence.sellThroughRate,
        liquidityAssessment: evidence.marketLiquidity,
        soldListings: evidence.soldComparables,
        activeListings: evidence.activeListings,
        errors: [],
        completedAt: new Date().toISOString(),
    };
}

function buildFailureResult(query, error) {
    return {
        mode: 'gemini-ebay-sold-comparables-test',
        query,
        soldCount: 0,
        activeCount: 0,
        sellThroughRate: null,
        liquidityAssessment: 'Unknown',
        soldListings: [],
        activeListings: [],
        errors: [{ type: error.name ?? 'Error', message: error.message ?? String(error) }],
        completedAt: new Date().toISOString(),
    };
}

/**
 * Runs the Gemini comparable test mode: executes exactly one Gemini search, writes one
 * structured result to the dataset and OUTPUT key, then calls exit(). All external
 * dependencies (storage writes, process exit, and the Gemini fetch) are injected so the
 * function is testable without a real Apify environment or API key.
 *
 * @param {object} input - Actor input (comparableQuery, comparableLimit).
 * @param {object} deps - Injected dependencies.
 * @param {function} deps.pushData - Writes one item to the default dataset.
 * @param {function} deps.setValue - Writes a value to a named key-value store key.
 * @param {function} deps.exit - Cleanly exits the Actor process.
 * @param {function} [deps.fetchComparables] - Gemini search implementation (defaults to the real one).
 */
export async function runGeminiTestMode(input, {
    pushData,
    setValue,
    exit,
    fetchComparables = defaultFetchComparables,
}) {
    const query = input.comparableQuery?.trim() ?? '';

    let result;
    if (!query) {
        const error = new Error('comparableQuery is required when testGeminiComparables is enabled.');
        console.error(`[gemini-test-mode] Missing query — ${error.name}: ${error.message}`);
        result = buildFailureResult('', error);
    } else {
        try {
            const evidence = await fetchComparables({
                query,
                limit: input.comparableLimit ?? 10,
                // Use a conservative 60 s timeout so the Actor exits well within
                // Apify's 300 s run limit even if the Gemini API is slow.
                timeoutMs: 60_000,
            });
            result = buildSuccessResult(query, evidence);
            console.log(
                `[gemini-test-mode] Found ${result.soldCount} sold and ${result.activeCount} active listings for "${query}".`,
            );
        } catch (error) {
            console.error(
                `[gemini-test-mode] Search failed for "${query}" — ${error.name}: ${error.message}`,
            );
            result = buildFailureResult(query, error);
        }
    }

    try {
        await pushData(result);
        await setValue('OUTPUT', result);
    } finally {
        // Always exit cleanly so no open handles keep the Actor run alive.
        await exit();
    }
}
