import { sampleLots } from "./sample-data";
import { getSupabase } from "./supabase";
import type { Lot } from "./types";

export async function getLots(): Promise<Lot[]> {
  const supabase = getSupabase();
  if (!supabase) return sampleLots;

  const { data, error } = await supabase
    .from("lots")
    .select("*")
    .order("expected_profit", { ascending: false });

  if (error || !data?.length) return sampleLots;

  return data.map((row: any) => ({
    id: row.id,
    source: row.source,
    auctionHouse: row.auction_house,
    auctionTitle: row.auction_title,
    lotNumber: row.lot_number,
    title: row.title,
    description: row.description ?? "",
    conditionReport: row.condition_report ?? "",
    imageUrls: row.image_urls ?? [],
    currentBid: row.current_bid,
    startPrice: row.start_price,
    estimatedResaleLow: row.estimated_resale_low,
    estimatedResale: row.estimated_resale,
    estimatedResaleHigh: row.estimated_resale_high,
    maxHammerBid: row.max_hammer_bid,
    expectedProfit: row.expected_profit,
    confidence: row.confidence,
    recommendation: row.recommendation,
    closingAt: row.closing_at,
    url: row.url
  }));
}
