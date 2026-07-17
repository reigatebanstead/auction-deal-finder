import { Actor } from 'apify';
import OpenAI from 'openai';
import { fetchGeminiSoldComparables } from './gemini-comparables.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

function errorDetails(error) {
    return {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
    };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`, { cause: error });
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function runGeminiComparablesTest(input) {
    const startedAt = new Date();
    const query = input.comparableQuery?.trim();
    const limit = input.comparableLimit ?? 10;
    const requestTimeoutMs = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS)
        || DEFAULT_REQUEST_TIMEOUT_MS;

    if (!query) {
        throw new Error('comparableQuery is required when testGeminiComparables is enabled.');
    }

    console.log('Running Gemini comparable test mode.', {
        query,
        limit,
        requestTimeoutMs,
    });

    try {
        const evidence = await fetchGeminiSoldComparables({
            query,
            limit,
            activeLimit: limit,
            fetchImpl: (url, options) => fetchWithTimeout(url, options, requestTimeoutMs),
        });

        const result = {
            mode: 'gemini-ebay-sold-comparables-test',
            status: 'succeeded',
            query,
            requestedLimit: limit,
            requestTimeoutMs,
            durationMs: Date.now() - startedAt.getTime(),
            startedAt: startedAt.toISOString(),
            completedAt: new Date().toISOString(),
            evidence,
        };

        await Actor.pushData(result);
        await Actor.setValue('OUTPUT', result);
        console.log('Gemini comparable test completed.', {
            soldCount: evidence.soldCount,
            activeCount: evidence.activeCount,
            durationMs: result.durationMs,
        });
    } catch (error) {
        const result = {
            mode: 'gemini-ebay-sold-comparables-test',
            status: 'failed',
            query,
            requestedLimit: limit,
            requestTimeoutMs,
            durationMs: Date.now() - startedAt.getTime(),
            startedAt: startedAt.toISOString(),
            completedAt: new Date().toISOString(),
            error: errorDetails(error),
        };

        console.error('Gemini comparable test failed.', result.error);
        await Actor.pushData(result);
        await Actor.setValue('OUTPUT', result);
    }
}

async function runNormalBatch(input) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const batchSize = input.batchSize ?? 10;
    const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS)
        || DEFAULT_REQUEST_TIMEOUT_MS;

    if (!supabaseUrl) throw new Error('SUPABASE_URL is missing.');
    if (!supabaseKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing.');
    if (!openaiApiKey) throw new Error('OPENAI_API_KEY is missing.');

    const client = new OpenAI({
        apiKey: openaiApiKey,
        timeout: requestTimeoutMs,
        maxRetries: 2,
    });

    console.log(`Fetching up to ${batchSize} pending lots from Supabase...`);
    const pendingLotsUrl = new URL(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/lots`);
    pendingLotsUrl.searchParams.append('valuation_status', 'eq.pending');
    pendingLotsUrl.searchParams.append('limit', batchSize.toString());

    const pendingLotsResponse = await fetchWithTimeout(pendingLotsUrl.toString(), {
        method: 'GET',
        headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
        },
    }, requestTimeoutMs);

    if (!pendingLotsResponse.ok) {
        const errorText = await pendingLotsResponse.text();
        throw new Error(`Failed to fetch pending lots (${pendingLotsResponse.status}): ${errorText}`);
    }

    const lots = await pendingLotsResponse.json();
    console.log(`Found ${lots.length} lots pending valuation.`);

    if (lots.length === 0) {
        const output = {
            valuationsProcessed: 0,
            failuresProcessed: 0,
            totalProcessed: 0,
            completedAt: new Date().toISOString(),
        };
        await Actor.setValue('OUTPUT', output);
        console.log('No pending lots to valuate.');
        return;
    }

    const results = [];

    for (const lot of lots) {
        console.log(`Processing lot: ${lot.id} - ${lot.title}`);
        const prompt = `You are an expert art and antique auctioneer. Analyze the following auction lot and provide a valuation.

Lot Details:
- Title: ${lot.title}
- Auction House: ${lot.auction_house}
- Current Bid: £${lot.current_bid ?? 'N/A'}
- Starting Price: £${lot.start_price ?? 'N/A'}
- Description: ${lot.description ?? 'N/A'}
- Condition Report: ${lot.condition_report ?? 'N/A'}

Provide your analysis as JSON with expectedResaleValue, maximumHammerPrice, expectedProfit, confidence, reasoning, and conditionRisks. Be realistic and conservative. Only return valid JSON.`;

        try {
            const completion = await client.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                response_format: { type: 'json_object' },
            });
            const valuation = JSON.parse(completion.choices[0].message.content.trim());
            const requiredFields = [
                'expectedResaleValue',
                'maximumHammerPrice',
                'expectedProfit',
                'confidence',
                'reasoning',
                'conditionRisks',
            ];
            for (const field of requiredFields) {
                if (!(field in valuation)) throw new Error(`Missing field in valuation: ${field}`);
            }
            if (!Array.isArray(valuation.conditionRisks)) {
                throw new Error('conditionRisks must be an array');
            }

            results.push({
                success: true,
                id: lot.id,
                estimated_resale: valuation.expectedResaleValue,
                max_hammer_bid: valuation.maximumHammerPrice,
                expected_profit: valuation.expectedProfit,
                confidence: valuation.confidence,
                reasoning: valuation.reasoning,
                condition_risks: valuation.conditionRisks,
                valuation_status: 'complete',
                valuated_at: new Date().toISOString(),
            });
        } catch (error) {
            console.error(`Failed to valuate lot ${lot.id}.`, errorDetails(error));
            results.push({
                success: false,
                id: lot.id,
                valuation_status: 'failed',
                valuation_error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    for (const result of results) {
        const updateUrl = new URL(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/lots`);
        updateUrl.searchParams.append('id', `eq.${result.id}`);
        const updatePayload = result.success ? {
            estimated_resale: result.estimated_resale,
            max_hammer_bid: result.max_hammer_bid,
            expected_profit: result.expected_profit,
            confidence: result.confidence,
            reasoning: result.reasoning,
            condition_risks: result.condition_risks,
            valuation_status: result.valuation_status,
            valuated_at: result.valuated_at,
            valuation_error: null,
        } : {
            valuation_status: result.valuation_status,
            valuation_error: result.valuation_error,
        };

        try {
            const updateResponse = await fetchWithTimeout(updateUrl.toString(), {
                method: 'PATCH',
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=minimal',
                },
                body: JSON.stringify(updatePayload),
            }, requestTimeoutMs);

            if (!updateResponse.ok) {
                console.error(`Failed to update lot ${result.id} (${updateResponse.status}): ${await updateResponse.text()}`);
            }
        } catch (error) {
            console.error(`Request failed while updating lot ${result.id}.`, errorDetails(error));
        }
    }

    const successCount = results.filter((result) => result.success).length;
    const output = {
        valuationsProcessed: successCount,
        failuresProcessed: results.length - successCount,
        totalProcessed: results.length,
        completedAt: new Date().toISOString(),
    };
    await Actor.setValue('OUTPUT', output);
    console.log('Valuation batch completed.', output);
}

await Actor.init();
let exitCode = 0;

try {
    const input = (await Actor.getInput()) ?? {};
    if (input.testGeminiComparables === true) {
        await runGeminiComparablesTest(input);
    } else {
        await runNormalBatch(input);
    }
} catch (error) {
    exitCode = 1;
    const details = errorDetails(error);
    console.error('VALUATION FAILED:', details);
    await Actor.setValue('ERROR', details);
} finally {
    await Actor.exit({ exitCode });
}
