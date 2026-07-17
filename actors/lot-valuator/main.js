import { Actor } from 'apify';
import { fetchGeminiSoldComparables } from './gemini-comparables.js';
import { runGeminiTestMode } from './gemini-test-mode.js';
import { generateGeminiValuation } from './gemini-valuation.js';

await Actor.init();

async function main() {
    const input = (await Actor.getInput()) ?? {};

    if (input.testGeminiComparables === true) {
        await runGeminiTestMode(input, {
            pushData: (item) => Actor.pushData(item),
            setValue: (key, value) => Actor.setValue(key, value),
            fetchComparables: fetchGeminiSoldComparables,
        });
        return;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const batchSize = input.batchSize ?? 10;

    if (!supabaseUrl) {
        throw new Error('SUPABASE_URL is missing.');
    }

    if (!supabaseKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing.');
    }

    if (!geminiApiKey) {
        throw new Error('GEMINI_API_KEY is missing.');
    }

    console.log(`Fetching up to ${batchSize} pending lots from Supabase...`);
    const pendingLotsUrl = new URL(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/lots`);
    pendingLotsUrl.searchParams.append('valuation_status', 'eq.pending');
    pendingLotsUrl.searchParams.append('limit', batchSize.toString());

    const pendingLotsResponse = await fetch(pendingLotsUrl.toString(), {
        method: 'GET',
        headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
        },
    });

    if (!pendingLotsResponse.ok) {
        const errorText = await pendingLotsResponse.text();
        throw new Error(
            `Failed to fetch pending lots (${pendingLotsResponse.status}): ${errorText}`,
        );
    }

    const lots = await pendingLotsResponse.json();
    console.log(`Found ${lots.length} lots pending valuation.`);

    if (lots.length === 0) {
        await Actor.setValue('OUTPUT', {
            valuationsProcessed: 0,
            failuresProcessed: 0,
            totalProcessed: 0,
            provider: 'gemini',
            completedAt: new Date().toISOString(),
        });
        console.log('No pending lots to valuate.');
        return;
    }

    const results = [];

    for (const lot of lots) {
        console.log(`Processing lot with Gemini: ${lot.id} - ${lot.title}`);

        try {
            const valuation = await generateGeminiValuation(lot, {
                apiKey: geminiApiKey,
                timeoutMs: input.valuationTimeoutMs ?? 60_000,
            });

            console.log(`✓ Gemini valuation for lot ${lot.id}:`, valuation);

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
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`✗ Failed to valuate lot ${lot.id} with Gemini:`, errorMessage);
            results.push({
                success: false,
                id: lot.id,
                valuation_status: 'failed',
                valuation_error: errorMessage,
            });
        }
    }

    if (results.length > 0) {
        console.log(`\nUpdating ${results.length} lots in Supabase...`);

        for (const result of results) {
            const updateUrl = new URL(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/lots`);
            updateUrl.searchParams.append('id', `eq.${result.id}`);

            let updatePayload;
            if (result.success) {
                updatePayload = {
                    estimated_resale: result.estimated_resale,
                    max_hammer_bid: result.max_hammer_bid,
                    expected_profit: result.expected_profit,
                    confidence: result.confidence,
                    reasoning: result.reasoning,
                    condition_risks: result.condition_risks,
                    valuation_status: result.valuation_status,
                    valuated_at: result.valuated_at,
                    valuation_error: null,
                };
            } else {
                updatePayload = {
                    valuation_status: result.valuation_status,
                    valuation_error: result.valuation_error,
                };
            }

            const updateResponse = await fetch(updateUrl.toString(), {
                method: 'PATCH',
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=minimal',
                },
                body: JSON.stringify(updatePayload),
            });

            if (!updateResponse.ok) {
                const errorText = await updateResponse.text();
                console.error(
                    `Failed to update lot ${result.id} (${updateResponse.status}): ${errorText}`,
                );
            } else {
                console.log(`✓ Updated lot ${result.id}`);
            }
        }
    }

    const successCount = results.filter((result) => result.success).length;
    const failureCount = results.length - successCount;

    await Actor.setValue('OUTPUT', {
        valuationsProcessed: successCount,
        failuresProcessed: failureCount,
        totalProcessed: results.length,
        provider: 'gemini',
        completedAt: new Date().toISOString(),
    });

    console.log(
        `\nSuccessfully valuated ${successCount} lots with Gemini, with ${failureCount} failures.`,
    );
}

try {
    await main();
} catch (error) {
    console.error('VALUATION FAILED:', error);
    await Actor.setValue('ERROR', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
    });
    throw error;
} finally {
    await Actor.exit({ timeoutSecs: 5, exit: true });
}
