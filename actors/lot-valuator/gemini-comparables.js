const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

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
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeComparable(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const soldPrice = toPrice(raw.soldPrice);
    const currency = toNullableString(raw.currency)?.toUpperCase() ?? null;
    const url = toNullableString(raw.url);

    if (soldPrice === null || soldPrice < 0 || currency !== 'GBP' || !url) {
        return null;
    }

    let hostname;
    try {
        hostname = new URL(url).hostname.toLowerCase();
    } catch {
        return null;
    }

    if (!hostname.endsWith('ebay.co.uk') && !hostname.endsWith('ebay.com')) {
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
        confidence: ['High', 'Medium', 'Low'].includes(raw.confidence)
            ? raw.confidence
            : 'Low',
    };
}

function deduplicateComparables(comparables) {
    const seen = new Set();

    return comparables.filter((item) => {
        const key = item.url.toLowerCase();
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function roundCurrency(value) {
    return Math.round(value * 100) / 100;
}

export function summarizeComparableEvidence(query, rawComparables, limit = 10) {
    const normalized = deduplicateComparables(
        rawComparables.map(normalizeComparable).filter(Boolean),
    )
        .sort((a, b) => a.soldPrice - b.soldPrice)
        .slice(0, limit);

    const prices = normalized.map((item) => item.soldPrice);
    const resultCount = prices.length;

    if (resultCount === 0) {
        return {
            query,
            source: 'gemini-google-search',
            resultCount: 0,
            lowPrice: null,
            medianPrice: null,
            highPrice: null,
            averagePrice: null,
            comparables: [],
        };
    }

    const midpoint = Math.floor(resultCount / 2);
    const median = resultCount % 2 === 0
        ? (prices[midpoint - 1] + prices[midpoint]) / 2
        : prices[midpoint];

    return {
        query,
        source: 'gemini-google-search',
        resultCount,
        lowPrice: prices[0],
        medianPrice: roundCurrency(median),
        highPrice: prices[resultCount - 1],
        averagePrice: roundCurrency(
            prices.reduce((sum, price) => sum + price, 0) / resultCount,
        ),
        comparables: normalized,
    };
}

function buildPrompt(query, limit) {
    return `Use Google Search to find up to ${limit} genuine completed or sold eBay listings comparable to this item:

${query}

Evidence rules:
- Use only individual eBay sold/completed listing pages.
- Prefer ebay.co.uk and prices in GBP.
- Exclude active listings, asking prices, category/search pages, guides, shops, and non-eBay sources.
- Never invent a sold price, date, or URL.
- If a detail is unavailable, use null.
- Confidence must be High, Medium, or Low.
- Return fewer results when evidence is weak.
- Return only JSON matching this shape:
{
  "comparables": [
    {
      "title": "string",
      "soldPrice": 123.45,
      "currency": "GBP",
      "soldDate": "YYYY-MM-DD or null",
      "condition": "string or null",
      "url": "https://...",
      "confidence": "High"
    }
  ]
}`;
}

function extractResponseText(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
        return null;
    }

    return parts
        .map((part) => part?.text)
        .filter((text) => typeof text === 'string')
        .join('')
        .trim();
}

export async function fetchGeminiSoldComparables({
    query,
    limit = 10,
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL,
    endpoint = DEFAULT_ENDPOINT,
    fetchImpl = fetch,
}) {
    if (!query?.trim()) {
        throw new Error('A non-empty comparable query is required.');
    }

    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is missing.');
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
        throw new Error('Comparable limit must be an integer between 1 and 25.');
    }

    const url = `${endpoint.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent`;

    const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
            contents: [
                {
                    role: 'user',
                    parts: [{ text: buildPrompt(query.trim(), limit) }],
                },
            ],
            tools: [{ google_search: {} }],
            generationConfig: {
                temperature: 0.1,
            },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            `Gemini comparable search failed (${response.status}): ${errorText}`,
        );
    }

    const payload = await response.json();
    const responseText = extractResponseText(payload);

    if (!responseText) {
        throw new Error('Gemini returned no comparable evidence text.');
    }

    const parsed = extractJson(responseText);
    const rawComparables = Array.isArray(parsed?.comparables)
        ? parsed.comparables
        : [];

    const summary = summarizeComparableEvidence(
        query.trim(),
        rawComparables,
        limit,
    );

    return {
        ...summary,
        model,
        searchQueries:
            payload?.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [],
        groundingSources:
            payload?.candidates?.[0]?.groundingMetadata?.groundingChunks
                ?.map((chunk) => chunk?.web)
                .filter(Boolean) ?? [],
    };
}
