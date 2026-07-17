import { Actor } from 'apify';
import OpenAI from 'openai';

await Actor.init();

try {
    const input = (await Actor.getInput()) ?? {};
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
    const pendingLotsResponse = await fetch(
        `${supabaseUrl.replace(/\/$/, '')}/rest/v1/lots?valuation_status=eq.pending&limit=${batchSize}`,
        {
            method: 'GET',
            headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
            },
        },
    );

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
            completedAt: new Date().toISOString(),
        });
        console.log('No pending lots to valuate.');
        process.exit(0);
    }

    const valuations = [];

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
  "conditionRisks": "<identified condition or provenance risks, or 'None identified'>"
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
            });

            const responseText = completion.choices[0].message.content.trim();

            // Extract JSON from the response
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in OpenAI response');
            }

            const valuation = JSON.parse(jsonMatch[0]);

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

            console.log(`✓ Valuation for lot ${lot.id}:`, valuation);

            valuations.push({
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
            console.error(`✗ Failed to valuate lot ${lot.id}:`, error.message);
            // Continue with next lot instead of failing entirely
        }
    }

    // Update lots in Supabase
    if (valuations.length > 0) {
        console.log(`\nUpdating ${valuations.length} lots in Supabase...`);

        for (const valuation of valuations) {
            const updateResponse = await fetch(
                `${supabaseUrl.replace(/\/$/, '')}/rest/v1/lots?id=eq.${valuation.id}`,
                {
                    method: 'PATCH',
                    headers: {
                        apikey: supabaseKey,
                        Authorization: `Bearer ${supabaseKey}`,
                        'Content-Type': 'application/json',
                        Prefer: 'return=minimal',
                    },
                    body: JSON.stringify(valuation),
                },
            );

            if (!updateResponse.ok) {
                const errorText = await updateResponse.text();
                console.error(
                    `Failed to update lot ${valuation.id} (${updateResponse.status}): ${errorText}`,
                );
            } else {
                console.log(`✓ Updated lot ${valuation.id}`);
            }
        }
    }

    await Actor.setValue('OUTPUT', {
        valuationsProcessed: valuations.length,
        completedAt: new Date().toISOString(),
    });

    console.log(`\nSuccessfully valuated and updated ${valuations.length} lots.`);
} catch (error) {
    console.error('VALUATION FAILED:', error);
    await Actor.setValue('ERROR', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
    });
    throw error;
}
