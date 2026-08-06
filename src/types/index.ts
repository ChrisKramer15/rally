// ─── Portfolio & Investment ───────────────────────────────────────────────────

export type AssetClass = "stock" | "etf" | "crypto" | "futures" | "forex";

export interface Portfolio {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  investments: Investment[];
}

export interface Investment {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quantity: number;
  avgCost: number; // average cost basis per unit
  addedAt: string;
  bracketOrder?: BracketOrder;
}

// ─── Market Data ─────────────────────────────────────────────────────────────

export interface Quote {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  price: number;
  change: number; // absolute change
  changePercent: number; // percentage change
  open: number;
  high: number;
  low: number;
  volume: number;
  marketCap?: number;
  bid: number;
  ask: number;
  timestamp: number;
  source?: "live" | "mock";
}

export interface OHLCV {
  time: number; // unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Supply & Demand Zones ────────────────────────────────────────────────────

export type ZoneType = "supply" | "demand";
export type ZoneStrength = "strong" | "moderate" | "weak";

export interface Zone {
  id: string;
  type: ZoneType;
  strength: ZoneStrength;
  priceHigh: number;
  priceLow: number;
  description: string;
  tested: number; // how many times price has touched this zone
}

// ─── Valuation & Recommendations ─────────────────────────────────────────────

export type TradeDirection = "buy" | "short";
export type TradeStyle = "scalp" | "day" | "swing" | "position";

export interface BracketOrder {
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  riskRewardRatio: number;
}

export interface TradeRecommendation {
  direction: TradeDirection;
  style: TradeStyle;
  confidence: number; // 0-100
  rationale: string;
  bracket: BracketOrder;
  zone?: Zone;
}

export interface Valuation {
  symbol: string;
  intrinsicValue: number | null; // null for non-equity assets
  fairValueMethod: string;
  currentPrice: number;
  valueGapPercent: number; // positive = undervalued, negative = overvalued
  rsi: number;
  macd: { value: number; signal: number; histogram: number };
  atr: number; // average true range
  trend: "uptrend" | "downtrend" | "sideways";
  supplyZones: Zone[];
  demandZones: Zone[];
  recommendations: TradeRecommendation[];
}
