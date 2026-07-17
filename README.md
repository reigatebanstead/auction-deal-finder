# Auction Deal Finder — Version 1

A mobile-friendly Next.js dashboard for auction sourcing, eBay sold comparisons,
maximum-bid calculations and resale opportunity ranking.

## Deploy to Vercel

1. Upload the extracted project files to the root of your GitHub repository.
2. In Vercel, import that repository.
3. Deploy. The site works immediately with sample data.
4. To connect Supabase, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Run `supabase/schema.sql` in the Supabase SQL Editor.
6. Optionally run `supabase/sample-data.sql`.

## Deploy Lot Valuator Actor to Apify

The workflow `.github/workflows/deploy-lot-valuator.yml` deploys
`actors/lot-valuator` to `valorous_ocarina/auction-deal-finder` on Apify.
It runs automatically on every push to `main` that changes files under
`actors/lot-valuator/`, and can also be triggered manually from your phone.

### One-time setup

1. Go to [Apify Console → Settings → Integrations](https://console.apify.com/account/integrations) and copy your Personal API token.
2. In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**.
3. Name it exactly `APIFY_TOKEN` and paste the token. Never share or commit the token value.

### Deploy from your phone (manual trigger)

1. Open GitHub → **Actions**.
2. Select **Deploy lot-valuator to Apify**.
3. Tap **Run workflow**.
4. Choose branch **main**.
5. Tap **Run workflow**.

The workflow will deploy the actor, verify the input schema, and run a smoke test.
It fails clearly if any step does not pass.

## Next integrations

- Import the complete Rosan Reeves Apify dataset into `lots`.
- Add eBay sold and live-auction comparable tables.
- Add image-analysis results and risk flags.
- Add watchlists, alerts and additional auction-house adapters.
