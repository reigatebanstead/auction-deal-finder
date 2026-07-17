const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TIMEOUT_MS = 60_000;
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

export async function generateGeminiValuation(lot, {
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL,
    endpoint = DEFAULT_ENDPOINT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
} = {}) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is missing.');

    const url = `${endpoint.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent`;
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
