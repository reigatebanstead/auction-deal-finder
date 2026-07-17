const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const MAX_ERROR_BODY_LENGTH = 500;

const RESPONSE_SCHEMA = {
    type: 'OBJECT',
    required: [
        'expectedResaleValue',
        'maximumHammerPrice',
        'expectedProfit',
        'confidence',
        'reasoning',
        'conditionRisks',
    ],
    properties: {
        expectedResaleValue: { type: 'NUMBER' },
        maximumHammerPrice: { type: 'NUMBER' },
        expectedProfit: { type: 'NUMBER' },
        confidence: { type: 'STRING', enum: ['High', 'Medium', 'Low'] },
        reasoning: { type: 'STRING' },
        conditionRisks: { type: 'ARRAY', items: { type: 'STRING' } },
    },
};

function buildPrompt(lot) {
    return `You are an expert art and antique auctioneer. Analyze this auction lot and provide a realistic, conservative valuation in GBP.

Lot Details:
- Title: ${lot.title ?? 'N/A'}
- Auction House: ${lot.auction_house ?? 'N/A'}
- Current Bid: £${lot.current_bid ?? 'N/A'}
- Starting Price: £${lot.start_price ?? 'N/A'}
- Description: ${lot.description ?? 'N/A'}
- Condition Report: ${lot.condition_report ?? 'N/A'}

Calculate:
- expectedResaleValue: likely resale value in GBP
- maximumHammerPrice: maximum sensible hammer bid in GBP after allowing for buyer fees, resale costs, risk, and profit margin
- expectedProfit: expectedResaleValue minus the estimated all-in acquisition and resale costs at maximumHammerPrice
- confidence: High, Medium, or Low
- reasoning: a concise explanation
- conditionRisks: an array of material risks, or ["None identified"]

Do not invent provenance or condition details. Return only the requested JSON object.`;
}

function extractResponseText(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;
    return parts
        .map((part) => part?.text)
        .filter((text) => typeof text === 'string')
        .join('')
        .trim();
}

function validateValuation(valuation) {
    if (!valuation || typeof valuation !== 'object' || Array.isArray(valuation)) {
        throw new Error('Gemini valuation response must be a JSON object.');
    }

    for (const field of ['expectedResaleValue', 'maximumHammerPrice', 'expectedProfit']) {
        if (typeof valuation[field] !== 'number' || !Number.isFinite(valuation[field])) {
            throw new Error(`Gemini valuation field ${field} must be a finite number.`);
        }
    }

    if (!['High', 'Medium', 'Low'].includes(valuation.confidence)) {
        throw new Error('Gemini valuation confidence must be High, Medium, or Low.');
    }
    if (typeof valuation.reasoning !== 'string' || !valuation.reasoning.trim()) {
        throw new Error('Gemini valuation reasoning must be a non-empty string.');
    }
    if (!Array.isArray(valuation.conditionRisks)
        || valuation.conditionRisks.some((risk) => typeof risk !== 'string')) {
        throw new Error('Gemini valuation conditionRisks must be an array of strings.');
    }

    return {
        expectedResaleValue: valuation.expectedResaleValue,
        maximumHammerPrice: valuation.maximumHammerPrice,
        expectedProfit: valuation.expectedProfit,
        confidence: valuation.confidence,
        reasoning: valuation.reasoning.trim(),
        conditionRisks: valuation.conditionRisks,
    };
}

function parseRetryDelayMs(response, errorBody, attempt) {
    const retryAfter = response.headers?.get?.('retry-after');
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);

        const retryDate = Date.parse(retryAfter);
        if (Number.isFinite(retryDate)) return Math.max(0, retryDate - Date.now());
    }

    const bodyMatch = errorBody.match(/retry in\s+([0-9.]+)s/i);
    if (bodyMatch) return Math.ceil(Number(bodyMatch[1]) * 1_000);

    return DEFAULT_RETRY_DELAY_MS * (2 ** attempt);
}

function isRetryableStatus(status) {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export async function generateGeminiValuation(lot, {
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL,
    endpoint = DEFAULT_ENDPOINT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    fetchImpl = fetch,
    sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    onRetry = null,
} = {}) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is missing.');

    const url = `${endpoint.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent`;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
            },
            signal: AbortSignal.timeout(timeoutMs),
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ text: buildPrompt(lot) }],
                }],
                generationConfig: {
                    temperature: 0.2,
                    responseMimeType: 'application/json',
                    responseSchema: RESPONSE_SCHEMA,
                },
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            if (isRetryableStatus(response.status) && attempt < maxRetries) {
                const delayMs = parseRetryDelayMs(response, errorBody, attempt);
                onRetry?.({ attempt: attempt + 1, maxRetries, status: response.status, delayMs });
                await sleepImpl(delayMs);
                continue;
            }

            throw new Error(
                `Gemini valuation failed (${response.status}): ${errorBody.slice(0, MAX_ERROR_BODY_LENGTH)}`,
            );
        }

        const payload = await response.json();
        const responseText = extractResponseText(payload);
        if (!responseText) throw new Error('Gemini returned no valuation text.');

        let parsed;
        try {
            parsed = JSON.parse(responseText);
        } catch {
            throw new Error('Gemini valuation response was not valid JSON.');
        }

        return validateValuation(parsed);
    }

    throw new Error('Gemini valuation retry loop ended unexpectedly.');
}
