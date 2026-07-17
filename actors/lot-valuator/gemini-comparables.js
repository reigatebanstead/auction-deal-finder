const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_ERROR_LOG_LENGTH = 500;

function extractJson(text) {
    const trimmed = text.trim();
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

    try {
        return JSON.parse(candidate);
    } catch {
        const objectStart = candidate.indexOf('{');
        const objectEnd = candidate.lastIndexOf('}');
        if (objectStart !== -1 && objectEnd > objectStart) {
            return JSON.parse(candidate.slice(objectStart, objectEnd + 1));
        }

        throw new Error('Gemini response did not contain valid JSON.');
    }
}

function toNullableString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toPrice(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;

    const normalized = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function isEbayUrl(url) {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return hostname.endsWith('ebay.co.uk') || hostname.endsWith('ebay.com');
    } catch {
        return false;
    }
}

export function normalizeComparable(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const soldPrice = toPrice(raw.soldPrice);
    const currency = toNullableString(raw.currency)?.toUpperCase() ?? null;
    const url = toNullableString(raw.url);

    if (soldPrice === null || soldPrice < 0 || currency !== 'GBP' || !url || !isEbayUrl(url)) {
        return null;
    }

    return {
        source: 'ebay',
        title: toNullableString(raw.title) ?? 'Untitled eBay sold listing',
        soldPrice,
        currency,
        soldDate: toNullableString(raw.soldDate),
        condition: toNullableString(raw.condition),
        url,
        confidence: ['High', 'Medium', 'Low'].includes(raw.confidence) ? raw.confidence : 'Low',
    };
}

export function normalizeActiveListing(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const askingPrice = toPrice(raw.askingPrice);
    const currency = toNullableString(raw.currency)?.toUpperCase() ?? null;
    const url = toNullableString(raw.url);

    if (askingPrice === null || askingPrice < 0 || currency !== 'GBP' || !url || !isEbayUrl(url)) {
        return null;
    }

    return {
        source: 'ebay',
        title: toNullableString(raw.title) ?? 'Untitled eBay active listing',
        askingPrice,
        currency,
        condition: toNullableString(raw.condition),
        url,
        confidence: ['High', 'Medium', 'Low'].includes(raw.confidence) ? raw.confidence : 'Low',
    };
}

function deduplicateByUrl(items) {
    const seen = new Set();
    return items.filter((item) => {
        const key = item.url.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function roundCurrency(value) {
    return Math.round(value * 100) / 100;
}

function median(values) {
    if (values.length === 0) return null;
    const midpoint = Math.floor(values.length / 2);
    return values.length % 2 === 0
        ? roundCurrency((values[midpoint - 1] + values[midpoint]) / 2)
        : values[midpoint];
}

function summarizePrices(values) {
    if (values.length === 0) {
        return { lowPrice: null, medianPrice: null, highPrice: null, averagePrice: null };
    }

    return {
        lowPrice: values[0],
        medianPrice: median(values),
        highPrice: values[values.length - 1],
        averagePrice: roundCurrency(values.reduce((sum, price) => sum + price, 0) / values.length),
    };
}

function classifyLiquidity(sellThroughRate, soldCount) {
    if (sellThroughRate === null || soldCount < 3) return 'Unknown';
    if (sellThroughRate >= 60 && soldCount >= 8) return 'High';
    if (sellThroughRate >= 30 && soldCount >= 4) return 'Medium';
    return 'Low';
}

export function summarizeMarketEvidence(
    query,
    rawSoldComparables,
    rawActiveListings,
    { soldLimit = 10, activeLimit = 10, marketWindowDays = 90 } = {},
) {
    const soldComparables = deduplicateByUrl(
        rawSoldComparables.map(normalizeComparable).filter(Boolean),
    ).sort((a, b) => a.soldPrice - b.soldPrice).slice(0, soldLimit);

    const activeListings = deduplicateByUrl(
        rawActiveListings.map(normalizeActiveListing).filter(Boolean),
    ).sort((a, b) => a.askingPrice - b.askingPrice).slice(0, activeLimit);

    const soldPrices = soldComparables.map((item) => item.soldPrice);
    const activePrices = activeListings.map((item) => item.askingPrice);
    const soldCount = soldComparables.length;
    const activeCount = activeListings.length;
    const denominator = soldCount + activeCount;
    const sellThroughRate = denominator > 0
        ? roundCurrency((soldCount / denominator) * 100)
        : null;

    return {
        query,
        source: 'gemini-google-search',
        marketWindowDays,
        sellThroughMethod: 'proxy: normalized sold samples / (normalized sold samples + normalized active samples)',
        soldCount,
        activeCount,
        sellThroughRate,
        marketLiquidity: classifyLiquidity(sellThroughRate, soldCount),
        soldPriceSummary: summarizePrices(soldPrices),
        activePriceSummary: summarizePrices(activePrices),
        soldComparables,
        activeListings,
    };
}

export function summarizeComparableEvidence(query, rawComparables, limit = 10) {
    const market = summarizeMarketEvidence(query, rawComparables, [], {
        soldLimit: limit,
        activeLimit: 0,
    });

    return {
        query: market.query,
        source: market.source,
        resultCount: market.soldCount,
        ...market.soldPriceSummary,
        comparables: market.soldComparables,
    };
}

function buildPrompt(query, soldLimit, activeLimit, marketWindowDays) {
    return `Use Google Search to gather eBay market evidence for this item:

${query}

Find:
1. Up to ${soldLimit} genuine eBay sold/completed listings sold within the last ${marketWindowDays} days.
2. Up to ${activeLimit} genuine currently active eBay listings.

Evidence rules:
- Use only individual eBay listing pages.
- Prefer ebay.co.uk and prices in GBP.
- Put completed/sold listings only in soldComparables.
- Put live asking-price listings only in activeListings.
- Exclude category/search pages, guides, shops, sponsored pages, and non-eBay sources.
- Never invent a price, date, status, or URL.
- If a detail is unavailable, use null.
- Confidence must be High, Medium, or Low.
- Return fewer results when evidence is weak.
- Return only JSON matching this shape:
{
  "soldComparables": [{
    "title": "string", "soldPrice": 123.45, "currency": "GBP",
    "soldDate": "YYYY-MM-DD or null", "condition": "string or null",
    "url": "https://...", "confidence": "High"
  }],
  "activeListings": [{
    "title": "string", "askingPrice": 149.99, "currency": "GBP",
    "condition": "string or null", "url": "https://...", "confidence": "High"
  }]
}`;
}

function extractResponseText(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;
    return parts.map((part) => part?.text).filter((text) => typeof text === 'string').join('').trim();
}

export async function fetchGeminiSoldComparables({
    query,
    limit = 10,
    activeLimit = limit,
    marketWindowDays = 90,
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL,
    endpoint = DEFAULT_ENDPOINT,
    fetchImpl = fetch,
    timeoutMs = 120_000,
}) {
    if (!query?.trim()) throw new Error('A non-empty comparable query is required.');
    if (!apiKey) throw new Error('GEMINI_API_KEY is missing.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
        throw new Error('Comparable limit must be an integer between 1 and 25.');
    }
    if (!Number.isInteger(activeLimit) || activeLimit < 1 || activeLimit > 25) {
        throw new Error('Active listing limit must be an integer between 1 and 25.');
    }
    if (!Number.isInteger(marketWindowDays) || marketWindowDays < 7 || marketWindowDays > 365) {
        throw new Error('Market window must be an integer between 7 and 365 days.');
    }

    const url = `${endpoint.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent`;

    // Use AbortController + explicit setTimeout rather than AbortSignal.timeout().
    // AbortSignal.timeout() uses an unref'd timer and, in some Node.js 20 / undici
    // configurations, does not reliably cancel the response-body-reading phase of a
    // fetch() call.  An explicit ref'd timer + Promise.race guarantees that the
    // entire HTTP round-trip (headers + body) is bounded by timeoutMs.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    }, timeoutMs);

    // Helper that rejects as soon as the abort signal fires (or immediately if it
    // has already fired).  Used to race against response.json() below.
    // The .catch() suppresses an unhandled-rejection warning in the case where
    // the fetch phase itself throws before abortRace is ever awaited.
    const abortRace = new Promise((_, reject) => {
        if (controller.signal.aborted) {
            reject(controller.signal.reason);
            return;
        }
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    });
    abortRace.catch(() => {});

    let response;
    try {
        response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ text: buildPrompt(query.trim(), limit, activeLimit, marketWindowDays) }],
                }],
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0.1 },
            }),
        });
    } catch (fetchError) {
        clearTimeout(timeoutId);
        // Normalise AbortError → TimeoutError so callers always see a consistent
        // error type when the timeout fires.
        const err = (fetchError.name === 'AbortError' && controller.signal.aborted)
            ? (controller.signal.reason ?? new DOMException('The operation timed out.', 'TimeoutError'))
            : fetchError;
        console.error('Gemini request error:', {
            query: query.trim(),
            model,
            timeoutMs,
            errorName: err.name,
            message: err.message,
        });
        throw err;
    }

    if (!response.ok) {
        clearTimeout(timeoutId);
        const errorBody = await response.text();
        console.error('Gemini non-2xx response:', {
            query: query.trim(),
            model,
            status: response.status,
            body: errorBody.slice(0, MAX_ERROR_LOG_LENGTH),
        });
        throw new Error(`Gemini comparable search failed (${response.status}): ${errorBody.slice(0, MAX_ERROR_LOG_LENGTH)}`);
    }

    // Race the body-read against the abort signal.  gemini-2.5-flash with
    // google_search grounding streams the response body for up to several minutes;
    // without this race the timeout has no effect once the HTTP 200 headers have
    // been received.
    let payload;
    try {
        payload = await Promise.race([response.json(), abortRace]);
    } catch (bodyError) {
        clearTimeout(timeoutId);
        const err = (bodyError.name === 'AbortError' && controller.signal.aborted)
            ? (controller.signal.reason ?? new DOMException('The operation timed out.', 'TimeoutError'))
            : bodyError;
        console.error('Gemini JSON parse error:', {
            query: query.trim(),
            model,
            errorName: err.name,
            message: err.message,
        });
        throw err;
    }

    clearTimeout(timeoutId);

    const responseText = extractResponseText(payload);
    if (!responseText) {
        console.error('Gemini returned no text:', { query: query.trim(), model });
        throw new Error('Gemini returned no comparable evidence text.');
    }

    let parsed;
    try {
        parsed = extractJson(responseText);
    } catch (parseError) {
        console.error('Gemini JSON parse error:', {
            query: query.trim(),
            model,
            errorName: parseError.name,
            message: parseError.message,
        });
        throw parseError;
    }
    const rawSoldComparables = Array.isArray(parsed?.soldComparables)
        ? parsed.soldComparables
        : Array.isArray(parsed?.comparables) ? parsed.comparables : [];
    const rawActiveListings = Array.isArray(parsed?.activeListings) ? parsed.activeListings : [];

    const summary = summarizeMarketEvidence(
        query.trim(),
        rawSoldComparables,
        rawActiveListings,
        { soldLimit: limit, activeLimit, marketWindowDays },
    );

    return {
        ...summary,
        model,
        searchQueries: payload?.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [],
        groundingSources: payload?.candidates?.[0]?.groundingMetadata?.groundingChunks
            ?.map((chunk) => chunk?.web).filter(Boolean) ?? [],
    };
}
