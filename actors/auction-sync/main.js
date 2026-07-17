import { Actor } from 'apify';

await Actor.init();

try {
    const input = (await Actor.getInput()) ?? {};
const datasetId = input.datasetId;

if (!datasetId) {
    throw new Error('datasetId is missing from the Actor input.');
}
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
        throw new Error('SUPABASE_URL is missing.');
    }

    if (!supabaseKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing.');
    }

    const dataset = await Actor.openDataset(datasetId);

    const { items } = await dataset.getData({
        clean: true,
        limit: 10000,
    });

    const toNumber = (value) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        const number = Number(
            String(value).replace(/[£,\s]/g, ''),
        );

        return Number.isFinite(number) ? number : null;
    };

    const rows = items
        .filter((item) => {
            return (
                item.lot_number !== undefined &&
                item.title &&
                item.lot_url
            );
        })
        .map((item) => ({
            id: `rosan-reeves-${item.lot_number}`,
            source: 'rosan-reeves',
            auction_house: 'Rosan Reeves',
            auction_title: 'Rosan Reeves — Hailsham',
            lot_number: Number(item.lot_number),
            title: item.title,
            description: item.description ?? '',
            condition_report: item.condition_report ?? '',
            image_urls: Array.isArray(item.image_urls)
                ? item.image_urls
                : [],
            current_bid: toNumber(item.current_bid),
            start_price: toNumber(
                item.start_price_gbp ?? item.start_price,
            ),
            estimated_resale_low: null,
            estimated_resale: null,
            estimated_resale_high: null,
            max_hammer_bid: null,
            expected_profit: null,
            confidence: 'Low',
            recommendation: 'WATCH',
            closing_at: null,
            url: item.lot_url,
            updated_at: new Date().toISOString(),
        }));

    console.log(`Prepared ${rows.length} lots.`);

    for (let index = 0; index < rows.length; index += 100) {
        const batch = rows.slice(index, index + 100);

        const response = await fetch(
            `${supabaseUrl.replace(/\/$/, '')}/rest/v1/lots?on_conflict=id`,
            {
                method: 'POST',
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json',
                    Prefer: 'resolution=merge-duplicates,return=minimal',
                },
                body: JSON.stringify(batch),
            },
        );

        if (!response.ok) {
            const errorText = await response.text();

            throw new Error(
                `Supabase upload failed (${response.status}): ${errorText}`,
            );
        }

        console.log(
            `Uploaded ${Math.min(
                index + batch.length,
                rows.length,
            )} of ${rows.length}.`,
        );
    }

    await Actor.setValue('OUTPUT', {
        imported: rows.length,
        datasetId,
        completedAt: new Date().toISOString(),
    });

    console.log(
        `Successfully imported ${rows.length} lots.`,
    );
} catch (error) {
    console.error('IMPORT FAILED:', error);
    await Actor.setValue('ERROR', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
    });
    throw error;
}
