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

## Next integrations

- Import the complete Rosan Reeves Apify dataset into `lots`.
- Add eBay sold and live-auction comparable tables.
- Add image-analysis results and risk flags.
- Add watchlists, alerts and additional auction-house adapters.
