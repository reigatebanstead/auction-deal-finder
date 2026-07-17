import { Actor } from 'apify';
import OpenAI from 'openai';
import { fetchGeminiSoldComparables } from './gemini-comparables.js';

await Actor.init();

try {
    const input = (await Actor.getInput()) ?? {};

    if (input.testGeminiComparables === true) {
        const query = input.comparableQuery?.trim();
        if (!query) {
            throw new Error(
                'comparableQuery is required when testGeminiComparables is enabled.',
            );
        }

        const errors = [];
        let evidence;
        try {
            evidence = await fetchGeminiSoldComparables({
                query,
                limit: input.comparableLimit ?? 10,
                // Use a conservative 60 s timeout so the Actor exits well within
                // Apify's 300 s run limit even if the Gemini API is slow.
                timeoutMs: 60_000,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('Gemini comparable search failed:', message);
            errors.push(message);
        }

        const result = {
            mode: 'gemini-ebay-sold-comparables-test',
            query,
            soldCount: evidence?.soldCount ?? 0,
            activeCount: evidence?.activeCount ?? 0,
            sellThroughRate: evidence?.sellThroughRate ?? null,
            liquidityAssessment: evidence?.marketLiquidity ?? 'Unknown',
            soldListings: evidence?.soldComparables ?? [],
            activeListings: evidence?.activeListings ?? [],
            errors,
            completedAt: new Date().toISOString(),
        };

        await Actor.pushData(result);
        await Actor.setValue('OUTPUT', result);

        console.log(
            `Found ${result.soldCount} sold and ${result.activeCount} active listings for "${query}".`,
        );
        await Actor.exit();
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const batchSize = input.batchSize ?? 10;

    if (!supabaseUrl) {
        throw new Error('SUPABASE_URL is missing.');
    }

    if (!supabaseKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing.');
    }

    if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY is missing.');
    }

    const client = new OpenAI({
        apiKey: openaiApiKey,
    });

    // Fetch pending lots from Supabase
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
            completedAt: new Date().toISOString(),
        });
        console.log('No pending lots to valuate.');
        await Actor.exit();
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

Provide your analysis in the following JSON format:
{
  "expectedResaleValue": <number in GBP>,
  "maximumHammerPrice": <number in GBP>,
  "expectedProfit": <number in GBP>,
  "confidence": "High" | "Medium" | "Low",
  "reasoning": "<brief explanation of valuation>",
  "conditionRisks": ["<risk 1>", "<risk 2>", "None identified"]
}

Be realistic and conservative in your estimates. Only return valid JSON.`;

        try {
            const completion = await client.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: 0.7,
                response_format: { type: 'json_object' },
            });

            const responseText = completion.choices[0].message.content.trim();
            const valuation = JSON.parse(responseText);

            // Validate required fields
            const requiredFields = [
                'expectedResaleValue',
                'maximumHammerPrice',
                'expectedProfit',
                'confidence',
                'reasoning',
                'conditionRisks',
            ];
            for (const field of requiredFields) {
                if (!(field in valuation)) {
                    throw new Error(`Missing field in valuation: ${field}`);
                }
            }

            // Ensure conditionRisks is an array
            if (!Array.isArray(valuation.conditionRisks)) {
                throw new Error('conditionRisks must be an array');
            }

            console.log(`✓ Valuation for lot ${lot.id}:`, valuation);

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
            console.error(`✗ Failed to valuate lot ${lot.id}:`, errorMessage);
            results.push({
                success: false,
                id: lot.id,
                valuation_status: 'failed',
                valuation_error: errorMessage,
            });
        }
    }

    // Update lots in Supabase
    if (results.length > 0) {
        console.log(`\nUpdating ${results.length} lots in Supabase...`);

        for (const result of results) {
            const updateUrl = new URL(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/lots`);
            updateUrl.searchParams.append('id', `eq.${result.id}`);

            // Prepare update payload based on success/failure
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

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    await Actor.setValue('OUTPUT', {
        valuationsProcessed: successCount,
        failuresProcessed: failureCount,
        totalProcessed: results.length,
        completedAt: new Date().toISOString(),
    });

    console.log(
        `\nSuccessfully valuated ${successCount} lots with ${failureCount} failures.`,
    );
} catch (error) {
    console.error('VALUATION FAILED:', error);
    await Actor.setValue('ERROR', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
    });
    throw error;
}
