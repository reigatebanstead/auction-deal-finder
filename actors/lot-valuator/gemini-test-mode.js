import { fetchGeminiSoldComparables as defaultFetchComparables } from './gemini-comparables.js';

const DEFAULT_TIMEOUT_MS = 60_000;

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

function createTimeoutError(timeoutMs) {
    const error = new Error(`Gemini comparable search timed out after ${timeoutMs} ms.`);
    error.name = 'TimeoutError';
    return error;
}

/**
 * Runs the Gemini comparable test mode: executes exactly one Gemini search and writes one
 * structured result to the dataset and OUTPUT key. Actor lifecycle cleanup is owned by main.js.
 *
 * @param {object} input - Actor input (comparableQuery, comparableLimit, comparableTimeoutMs).
 * @param {object} deps - Injected dependencies.
 * @param {function} deps.pushData - Writes one item to the default dataset.
 * @param {function} deps.setValue - Writes a value to a named key-value store key.
 * @param {function} [deps.fetchComparables] - Gemini search implementation (defaults to the real one).
 */
export async function runGeminiTestMode(input, {
    pushData,
    setValue,
    fetchComparables = defaultFetchComparables,
}) {
    const query = input.comparableQuery?.trim() ?? '';
    const timeoutMs = input.comparableTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    let result;
    if (!query) {
        const error = new Error('comparableQuery is required when testGeminiComparables is enabled.');
        console.error(`[gemini-test-mode] Missing query — ${error.name}: ${error.message}`);
        result = buildFailureResult('', error);
    } else {
        let timeoutTimer;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timeoutTimer = setTimeout(() => reject(createTimeoutError(timeoutMs)), timeoutMs);
            });

            const evidence = await Promise.race([
                fetchComparables({
                    query,
                    limit: input.comparableLimit ?? 10,
                    timeoutMs,
                }),
                timeoutPromise,
            ]);

            result = buildSuccessResult(query, evidence);
            console.log(
                `[gemini-test-mode] Found ${result.soldCount} sold and ${result.activeCount} active listings for "${query}".`,
            );
        } catch (error) {
            console.error(
                `[gemini-test-mode] Search failed for "${query}" — ${error.name}: ${error.message}`,
            );
            result = buildFailureResult(query, error);
        } finally {
            if (timeoutTimer !== undefined) {
                clearTimeout(timeoutTimer);
            }
        }
    }

    await pushData(result);
    await setValue('OUTPUT', result);
    return result;
}
