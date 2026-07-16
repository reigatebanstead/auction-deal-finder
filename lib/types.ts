export type Recommendation = "BUY" | "WATCH" | "AVOID";

export type Lot = {
  id: string;
  source: string;
  auctionHouse: string;
  auctionTitle: string;
  lotNumber: number;
  title: string;
  description: string;
  conditionReport: string;
  imageUrls: string[];
  currentBid: number | null;
  startPrice: number | null;
  estimatedResaleLow: number | null;
  estimatedResale: number | null;
  estimatedResaleHigh: number | null;
  maxHammerBid: number | null;
  expectedProfit: number | null;
  confidence: "High" | "Medium" | "Low";
  recommendation: Recommendation;
  closingAt: string | null;
  url: string;
};
