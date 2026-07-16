import { Filters } from "@/components/Filters";
import { LotCard } from "@/components/LotCard";
import { getLots } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const lots = await getLots();
  const potentialProfit = lots.reduce((sum, lot) => sum + (lot.expectedProfit ?? 0), 0);
  const buyCount = lots.filter((lot) => lot.recommendation === "BUY").length;

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">Private sourcing dashboard</p>
          <h1>Auction Deal Finder</h1>
          <p className="intro">
            Compare auction lots with recent eBay sold prices, account for fees,
            and focus on opportunities with the strongest expected profit.
          </p>
        </div>
        <span className="live">Version 1 online</span>
      </header>

      <section className="stats">
        <article><span>Lots loaded</span><strong>{lots.length}</strong></article>
        <article><span>Buy recommendations</span><strong>{buyCount}</strong></article>
        <article><span>Sources</span><strong>2 ready</strong></article>
        <article><span>Potential profit</span><strong>£{Math.round(potentialProfit)}</strong></article>
      </section>

      <section className="sectionHeader">
        <div>
          <p className="eyebrow">Current opportunities</p>
          <h2>Rosan Reeves — Hailsham</h2>
        </div>
        <Filters />
      </section>

      <section className="grid">
        {lots.map((lot) => <LotCard key={lot.id} lot={lot} />)}
      </section>

      <footer>
        Values are estimates, not guarantees. Inspect condition, authenticity,
        completeness, buyer&apos;s premium and live bids before bidding.
      </footer>
    </main>
  );
}
