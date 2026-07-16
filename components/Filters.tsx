"use client";

export function Filters() {
  return (
    <div className="filters">
      <input id="search" placeholder="Search lots, brands or models…" />
      <select id="recommendation" defaultValue="all">
        <option value="all">All recommendations</option>
        <option value="BUY">Buy</option>
        <option value="WATCH">Watch</option>
        <option value="AVOID">Avoid</option>
      </select>
      <select id="source" defaultValue="all">
        <option value="all">All sources</option>
        <option value="rosan-reeves">Rosan Reeves</option>
        <option value="ebay">eBay</option>
      </select>
    </div>
  );
}
