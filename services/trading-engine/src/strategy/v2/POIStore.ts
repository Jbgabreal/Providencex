/**
 * POIStore — In-memory store for Points of Interest (pending setups)
 *
 * Tracks where the strategy would place limit orders if price reaches
 * the zone. Updated every evaluation cycle. Exposed via engine-status API.
 */

export interface PointOfInterest {
  symbol: string;
  direction: 'buy' | 'sell';
  type: 'limit';  // could add 'stop' later
  h4Bias: 'bullish' | 'bearish';
  msbType: 'STRONG' | 'SIMPLE';

  // Order Block zone (the POI)
  obHigh: number;
  obLow: number;
  entryPrice: number;    // midpoint of OB

  // Impulse leg
  impulseHigh: number;
  impulseLow: number;
  equilibrium: number;

  // Risk levels
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;

  // Current state
  currentPrice: number;
  distanceToEntry: number;  // in price units
  distancePct: string;      // as percentage string

  // Metadata
  updatedAt: string;        // ISO timestamp
  status: 'watching' | 'approaching' | 'in_zone' | 'invalidated';
}

// Global singleton store
const poiMap = new Map<string, PointOfInterest>();

export function updatePOI(symbol: string, poi: PointOfInterest): void {
  poiMap.set(symbol, poi);
}

export function removePOI(symbol: string): void {
  poiMap.delete(symbol);
}

export function getAllPOIs(): PointOfInterest[] {
  return Array.from(poiMap.values());
}

export function getPOI(symbol: string): PointOfInterest | undefined {
  return poiMap.get(symbol);
}
