import type { Lot } from "@/lib/types";

const money = (value: number | null) =>
  value == null ? "—" : new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);

export function LotCard({ lot }: { lot: Lot }) {
  return (
    <article className="card">
      <div className="topline">
        <span>{lot.auctionHouse} · Lot {lot.lotNumber}</span>
        <span className={`badge ${lot.recommendation.toLowerCase()}`}>{lot.recommendation}</span>
      </div>
      <h3>{lot.title}</h3>
      <p className="description">{lot.description}</p>
      <div className="metrics">
        <div><small>Expected resale</small><strong>{money(lot.estimatedResale)}</strong></div>
        <div><small>Max hammer</small><strong>{money(lot.maxHammerBid)}</strong></div>
        <div><small>Expected profit</small><strong>{money(lot.expectedProfit)}</strong></div>
        <div><small>Confidence</small><strong>{lot.confidence}</strong></div>
      </div>
      <details>
        <summary>Condition and risk notes</summary>
        <p>{lot.conditionReport || "No condition report collected yet."}</p>
      </details>
      <a className="button" href={lot.url} target="_blank" rel="noreferrer">Open auction lot</a>
    </article>
  );
}
