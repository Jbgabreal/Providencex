/**
 * RangeUtils - Utility functions for working with price ranges
 * 
 * Provides discount/premium zone calculations and range checks
 */

import { ExternalRange } from './types';

/**
 * Get discount or premium zone for a price within a range
 * 
 * @param price Current price
 * @param range Range with swingLow and swingHigh
 * @param discountThreshold Optional threshold (default 0.5 = 50%)
 * @returns 'discount', 'premium', or 'mid'
 */
export function getDiscountOrPremium(
  price: number,
  range: { swingLow: number; swingHigh: number },
  discountThreshold: number = 0.5
): 'discount' | 'premium' | 'mid' {
  const { swingLow, swingHigh } = range;
  
  if (swingLow === null || swingHigh === null || swingLow >= swingHigh) {
    return 'mid';
  }

  const rangeSize = swingHigh - swingLow;
  const positionFromLow = price - swingLow;
  const ratio = positionFromLow / rangeSize;

  if (ratio < discountThreshold) {
    return 'discount';
  } else if (ratio > (1 - discountThreshold)) {
    return 'premium';
  } else {
    return 'mid';
  }
}

/**
 * Check if price is within a range
 */
export function isWithinRange(
  price: number,
  range: { swingLow: number | null; swingHigh: number | null }
): boolean {
  const { swingLow, swingHigh } = range;

  if (swingLow === null || swingHigh === null) {
    return false;
  }

  return price >= swingLow && price <= swingHigh;
}

/**
 * Get the percentage position within a range (0 = at swingLow, 1 = at swingHigh)
 */
export function getRangePosition(
  price: number,
  range: { swingLow: number; swingHigh: number }
): number {
  const { swingLow, swingHigh } = range;

  if (swingLow === null || swingHigh === null || swingLow >= swingHigh) {
    return 0.5; // Default to middle
  }

  const rangeSize = swingHigh - swingLow;
  const positionFromLow = price - swingLow;
  return positionFromLow / rangeSize;
}

/**
 * Get price at a specific percentage within range
 */
export function getPriceAtRangePosition(
  range: { swingLow: number; swingHigh: number },
  position: number // 0.0 to 1.0
): number {
  const { swingLow, swingHigh } = range;
  const rangeSize = swingHigh - swingLow;
  return swingLow + (rangeSize * position);
}

