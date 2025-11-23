1. Conceptual SMC / ICT Definitions
1.1 Market Structure: HH, HL, LH, LL and Swings

Core idea:
Market structure is read from a sequence of swing highs and swing lows.

Swing High (SH): a local peak in price.

Swing Low (SL): a local trough in price.

From the sequence of swings:

Higher High (HH): a new swing high above the previous swing high.

Higher Low (HL): a new swing low above the previous swing low.

Lower High (LH): a new swing high below the previous swing high.

Lower Low (LL): a new swing low below the previous swing low.

Example (uptrend):

Price forms swing lows and highs:
SL₁ → SH₁ → SL₂ → SH₂ → SL₃ → SH₃ …

If SL₂ > SL₁ and SH₂ > SH₁ → HL + HH → bullish structure.

If price keeps printing HH-HL-HH-HL → bullish trend.

Example (downtrend):

SL₁ → SH₁ → SL₂ → SH₂ → SL₃ → SH₃ …

If SL₂ < SL₁ and SH₂ < SH₁ → LL + LH → bearish structure.

Swing High / Swing Low definitions

In ICT/SMC, swings are usually defined via simple pivots (“fractals”):

Swing High: a candle whose high is higher than N candles on its left and N candles on its right.

Swing Low: a candle whose low is lower than N candles on its left and N candles on its right.

This is fractal/pivot-based and is easy to mechanize.

1.2 Trend Bias via BOS & PD Arrays
Break of Structure (BOS)

A BOS is when price breaks a prior swing point in the trend direction, confirming continuation:

In an uptrend:
Price closes above a previous swing high → bullish BOS.

In a downtrend:
Price closes below a previous swing low → bearish BOS.

ICT-style reading usually requires that the body (close) breaks the level, not just a wick.

PD Arrays (Premium / Discount)

Given a range from a key swing low to a swing high:

Range high: H_range

Range low: L_range

Equilibrium (EQ / 50%): (H_range + L_range) / 2

Lower half (below EQ) → Discount (cheap / buy side).

Upper half (above EQ) → Premium (expensive / sell side).

SMC thinking:

In a bullish environment, you want to buy in discount and target premium.

In a bearish environment, you want to sell in premium and target discount.

1.3 BOS Details & Internal vs External Structure
Bullish BOS

Conceptually:

Price is in bullish structure (HH-HL).

There is a prior significant swing high SH_prev.

A bullish BOS is confirmed when a candle closes above SH_prev (strict version).

A weaker version: any candle whose high breaks SH_prev (with optional close filter).

Bearish BOS

Symmetric:

Price in bearish structure (LL-LH).

Prior swing low SL_prev.

Bearish BOS: candle closes below SL_prev (strict), or wick breaks low (relaxed).

Internal vs External Structure

External structure: major swing points that define the broader trend (HTF or large pivots).

Internal structure: smaller swings inside the external range (ITF/LTF or minor pivots).

Example:

On H4, you see a big HH-HL-HH sequence (external).

On M15 inside that H4 upswing, lots of tiny lower-timeframe swings and mini BOS events (internal).

For coding, you typically:

Use a larger pivotPeriod / lookback for external swings.

Use a smaller pivotPeriod / lookback for internal swings.

1.4 CHoCH (Change of Character)

Idea:
A CHoCH is the first valid BOS against the current trend that suggests potential reversal, not just continuation.

Example (bullish → bearish):

Market is making HH-HL-HH-HL (bullish).

Last confirmed HL = HL_last.

Price then breaks below HL_last with a proper BOS (close below).

That break is a CHoCH, signaling a likely change from bullish to bearish.

Differences vs normal BOS:

Normal BOS: continuation in the same direction (e.g., break of swing high in an uptrend).

CHoCH: BOS against the current trend (break of HL in an uptrend or break of LH in a downtrend).

1.5 Liquidity & Swing Points

Liquidity in SMC:

Stop orders cluster above prior highs and below prior lows (especially clean, obvious ones).

Equal highs/lows (multiple swing points at similar levels) are considered liquidity pools.

A liquidity grab / stop hunt is when price wicks through a prior high/low (taking stops) but then closes back inside the range, often before reversing.

Example:

Equal highs at 1.2000.

Price spikes to 1.2005, then closes below 1.2000 → liquidity taken above equal highs; potential reversal.

In code: you detect these patterns by comparing wick extremes vs closes relative to levels.

1.6 Multi-Timeframe Alignment (HTF / ITF / LTF)

Typical SMC workflow:

HTF (Daily / H4)

Define macro bias using external swings, BOS, PD arrays.

Example: HTF bearish, price in premium of last HTF down-leg.

ITF (M15 / M5)

Read execution structure in context of HTF.

Look for ITF BOS/CHoCH that aligns with HTF idea.

Example: HTF bearish, ITF prints a CHoCH from bullish to bearish and BOS to downside.

LTF (M1)

Find precise entries:

LTF liquidity sweep.

LTF CHoCH into HTF/ITF direction.

LTF OB / FVG entry with BOS confirmation.

Example (short):

HTF: bearish bias, price trading in HTF premium zone.

ITF: price rallies into an HTF POI, prints ITF CHoCH + bearish BOS.

LTF: after liquidity sweep above a local high, prints LTF CHoCH bearish → short entry.

2. Formal Rules & Algorithms

We now turn these into deterministic, backtestable rules using only OHLCV and config parameters.

Notation:

candles[i] = { open, high, low, close, volume, timestamp }

Arrays: open[i], high[i], low[i], close[i].

i increases with time.

2.1 Swing Highs / Swing Lows
Approach 1: Pivot-Based (Fractals)

Parameters:

pivotLeft: number of bars to the left.

pivotRight: number of bars to the right.
Often pivotLeft == pivotRight, e.g., 2, 3.

Human rule:

A candle at index i is a swing high if its high is the maximum among the highs of [i - pivotLeft, ..., i + pivotRight].

A candle at index i is a swing low if its low is the minimum among the lows of [i - pivotLeft, ..., i + pivotRight].

Implementation logic (non-repainting, with delay):

You cannot know that a pivot at i is confirmed until you see pivotRight bars after it.

So, swing identification is delayed by pivotRight bars.

Pseudo-code:

function detectFractalSwings(candles, pivotLeft, pivotRight) {
  const swings = []; // { index, type: 'high' | 'low', price }

  for (let i = pivotLeft; i < candles.length - pivotRight; i++) {
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - pivotLeft; j <= i + pivotRight; j++) {
      if (candles[j].high > candles[i].high) isSwingHigh = false;
      if (candles[j].low < candles[i].low) isSwingLow = false;
      if (!isSwingHigh && !isSwingLow) break;
    }

    if (isSwingHigh) {
      swings.push({ index: i, type: 'high', price: candles[i].high });
    }
    if (isSwingLow) {
      swings.push({ index: i, type: 'low', price: candles[i].low });
    }
  }

  return swings;
}


Pros:

Captures structural turning points nicely.

External structure: use large pivot (e.g., 5–10).

Internal structure: smaller pivot (e.g., 2–3).

Cons:

Delayed by pivotRight bars (lag).

Fewer swings when pivot is large.

Approach 2: Rolling Lookback Range

Parameters:

lookbackHigh: how many bars back to search for the highest high.

lookbackLow: how many bars back to search for the lowest low.

Human rule:

At each candle i, define:

rolling swing high: max high in [i - lookbackHigh + 1, ..., i].

rolling swing low: min low in [i - lookbackLow + 1, ..., i].

When this max/min changes, treat it as a potential new swing.

Implementation logic:

function detectRollingSwings(candles, lookbackHigh, lookbackLow) {
  const swings = [];
  let lastSwingHighIdx = null;
  let lastSwingLowIdx = null;

  for (let i = 0; i < candles.length; i++) {
    if (i >= lookbackHigh - 1) {
      let maxHigh = -Infinity;
      let maxIdx = null;
      for (let j = i - lookbackHigh + 1; j <= i; j++) {
        if (candles[j].high >= maxHigh) {
          maxHigh = candles[j].high;
          maxIdx = j;
        }
      }
      if (maxIdx !== lastSwingHighIdx) {
        swings.push({ index: maxIdx, type: 'high', price: maxHigh });
        lastSwingHighIdx = maxIdx;
      }
    }

    if (i >= lookbackLow - 1) {
      let minLow = Infinity;
      let minIdx = null;
      for (let j = i - lookbackLow + 1; j <= i; j++) {
        if (candles[j].low <= minLow) {
          minLow = candles[j].low;
          minIdx = j;
        }
      }
      if (minIdx !== lastSwingLowIdx) {
        swings.push({ index: minIdx, type: 'low', price: minLow });
        lastSwingLowIdx = minIdx;
      }
    }
  }

  return swings;
}


Pros:

No future knowledge: uses only past data (no repaint once printed).

Easy to update in streaming fashion.

Cons:

Can generate “noisy” swings.

Sensitivity depends heavily on lookback lengths.

2.2 BOS (Break of Structure)

We assume we already have an ordered list of swings:
swingsSortedByIndex = sort(swings by index ascending).

Strict ICT-style BOS

Human rule (bullish):

Identify significant swing highs.

When a candle closes above a previous swing high, that is a bullish BOS.

The candle that closes above is the BOS candle.

Human rule (bearish):

Identify significant swing lows.

When a candle closes below a previous swing low, that is a bearish BOS.

Config parameters:

bosLookbackSwings: how many previous swings to consider as candidates for BOS.

strictClose: boolean. If true, use close vs level. If false, allow wick break.

Relaxed BOS

Relaxed version: a BOS is triggered if high > level (bullish) or low < level (bearish).

Optional filter: require close to be at least X% beyond the level or in the direction of the break.

Pseudo-code to detect BOS
type SwingPoint = {
  index: number;
  type: 'high' | 'low';
  price: number;
};

type BosEvent = {
  index: number;           // index of BOS candle
  direction: 'bullish' | 'bearish';
  brokenSwingIndex: number;
  brokenSwingType: 'high' | 'low';
  level: number;           // price of broken swing
};

function detectBOS(candles, swings, config): BosEvent[] {
  const bosEvents: BosEvent[] = [];
  const { bosLookbackSwings, strictClose } = config;

  // Sort swings by index
  const swingsSorted = swings.slice().sort((a, b) => a.index - b.index);

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    // 1. Find candidate prior swing highs/lows within lookback
    const candidateSwings = swingsSorted.filter(
      s => s.index < i && s.index >= i - config.swingIndexLookback
    );

    for (const sw of candidateSwings) {
      if (sw.type === 'high') {
        const broken = strictClose ? (c.close > sw.price) : (c.high > sw.price);
        if (broken) {
          bosEvents.push({
            index: i,
            direction: 'bullish',
            brokenSwingIndex: sw.index,
            brokenSwingType: 'high',
            level: sw.price
          });
        }
      }
      if (sw.type === 'low') {
        const broken = strictClose ? (c.close < sw.price) : (c.low < sw.price);
        if (broken) {
          bosEvents.push({
            index: i,
            direction: 'bearish',
            brokenSwingIndex: sw.index,
            brokenSwingType: 'low',
            level: sw.price
          });
        }
      }
    }
  }

  return bosEvents;
}


You’ll typically want to deduplicate BOS events (pick the “nearest” swing or latest swing) instead of firing multiple BOS on one candle. You can, for example, pick the most recent swing only.

2.3 CHoCH (Change of Character)
Conceptual rule

Let current trend be:

trend = 'bullish' if last confirmed structure is HH-HL with bullish BOS.

trend = 'bearish' if LL-LH with bearish BOS.

trend = 'sideways' otherwise.

Then:

In a bullish trend, a CHoCH occurs when price prints a bearish BOS that breaks the last significant HL.

In a bearish trend, a CHoCH occurs when price prints a bullish BOS that breaks the last significant LH.

Step-by-step logic

Maintain a swing structure state as you process swings in time:

Track last few swing highs and lows.

Determine the current trend (up, down, sideways) based on sequences like HH-HL or LL-LH.

Identify “protected” swing points:

In bullish trend, the last HL is the protected low.

In bearish trend, the last LH is the protected high.

When a BOS event arrives:

If trend === 'bullish' and BOS direction is bearish and it breaks the protected low (last HL) → CHoCH (bullish → bearish).

If trend === 'bearish' and BOS direction is bullish and it breaks the protected high (last LH) → CHoCH (bearish → bullish).

CHoCH event structure
type ChoChEvent = {
  index: number;                // candle index where CHoCH BOS occurred
  fromTrend: 'bullish' | 'bearish';
  toTrend: 'bullish' | 'bearish';
  brokenSwingIndex: number;
  brokenSwingType: 'high' | 'low';
  level: number;
  bosIndex: number;             // BOS candle index (same as index)
};

Pseudo-code
function detectChoCh(candles, swings, bosEvents, config): ChoChEvent[] {
  const chochEvents: ChoChEvent[] = [];

  // First, derive trend state across time from swings and BOS.
  const trendStateByIndex = computeTrendState(candles, swings, bosEvents, config);

  for (const bos of bosEvents) {
    const idx = bos.index;
    const trend = trendStateByIndex[idx]; // 'bullish' | 'bearish' | 'sideways'

    // Determine protected swing for current trend
    const protectedSwing = getProtectedSwingBeforeIndex(
      swings,
      bos.index,
      trend
    );
    if (!protectedSwing) continue;

    if (trend === 'bullish' && bos.direction === 'bearish') {
      if (protectedSwing.type === 'low' && bos.level <= protectedSwing.price) {
        chochEvents.push({
          index: bos.index,
          fromTrend: 'bullish',
          toTrend: 'bearish',
          brokenSwingIndex: protectedSwing.index,
          brokenSwingType: protectedSwing.type,
          level: protectedSwing.price,
          bosIndex: bos.index
        });
      }
    }

    if (trend === 'bearish' && bos.direction === 'bullish') {
      if (protectedSwing.type === 'high' && bos.level >= protectedSwing.price) {
        chochEvents.push({
          index: bos.index,
          fromTrend: 'bearish',
          toTrend: 'bullish',
          brokenSwingIndex: protectedSwing.index,
          brokenSwingType: protectedSwing.type,
          level: protectedSwing.price,
          bosIndex: bos.index
        });
      }
    }
  }

  return chochEvents;
}


You’ll define computeTrendState and getProtectedSwingBeforeIndex in section 2.4.

2.4 Trend Bias (Structure + PD Arrays)
2.4.1 Structure-based trend

Human rule:

Look at last K alternating swings: ... SL, SH, SL, SH (up) or ... SH, SL, SH, SL (down).

If last few swings show consistent HH-HL pattern + last BOS is bullish → bullish trend.

If LL-LH + last BOS is bearish → bearish trend.

Else → sideways.

Implementation sketch:

type TrendBias = 'bullish' | 'bearish' | 'sideways';

type TrendBiasResult = {
  index: number;
  trend: TrendBias;
  lastSwingHigh?: number;
  lastSwingLow?: number;
  lastBosDirection?: 'bullish' | 'bearish' | null;
  pdPosition?: number; // 0..1
};

function computeTrendBias(candles, swings, bosEvents, config): TrendBiasResult[] {
  const results: TrendBiasResult[] = [];
  const swingsSorted = swings.slice().sort((a, b) => a.index - b.index);
  const bosByIndex = indexBosByCandle(bosEvents);

  let currentTrend: TrendBias = 'sideways';
  let lastSwingHigh = null;
  let lastSwingLow = null;
  let lastBosDirection = null;

  for (let i = 0; i < candles.length; i++) {
    // Update swings up to i
    const activeSwings = swingsSorted.filter(s => s.index <= i);

    // Determine last swing high/low
    const highs = activeSwings.filter(s => s.type === 'high');
    const lows = activeSwings.filter(s => s.type === 'low');
    lastSwingHigh = highs.length ? highs[highs.length - 1].price : null;
    lastSwingLow = lows.length ? lows[lows.length - 1].price : null;

    // Update last BOS direction if one at this index
    if (bosByIndex[i]) {
      const lastBos = bosByIndex[i][bosByIndex[i].length - 1];
      lastBosDirection = lastBos.direction;
    }

    // Determine structural trend from recent swings (simplified)
    currentTrend = inferTrendFromSwings(activeSwings, lastBosDirection, config);

    // PD-array position
    const pdPosition = computePdPosition(
      candles[i].close,
      lastSwingLow,
      lastSwingHigh
    );

    results.push({
      index: i,
      trend: currentTrend,
      lastSwingHigh,
      lastSwingLow,
      lastBosDirection,
      pdPosition
    });
  }

  return results;
}

// position in PD array: 0 at low, 1 at high, null if invalid
function computePdPosition(price, low, high) {
  if (low == null || high == null || high === low) return null;
  return (price - low) / (high - low);
}


inferTrendFromSwings idea:

Take last n alternating swings.

If there are at least 2 highs and 2 lows:

If each new high > previous high and new low > previous low and lastBosDirection === 'bullish' → bullish.

If each new high < previous high and new low < previous low and lastBosDirection === 'bearish' → bearish.

Else sideways.

2.4.2 PD-array aware bias

Now incorporate where price is within the range:

Let:

pdPosition = 0..1 where 0 = at lastSwingLow, 1 = at lastSwingHigh.

Define thresholds:

discountZoneMax = 0.5 (0–0.5).

premiumZoneMin = 0.5 (0.5–1).

You can further define 0.33 / 0.66 for finer zones.

Rules:

If trend === 'bullish' AND pdPosition <= discountZoneMax → strong bullish bias (discount in uptrend).

If trend === 'bearish' AND pdPosition >= premiumZoneMin → strong bearish bias (premium in downtrend).

If price in middle (near 0.5) or trend is sideways → bias is weaker.

You can encode this as “bias score” or just keep trend and pdPosition separately.

2.5 Multi-Timeframe Framework (HTF / ITF / LTF)

We’ll reuse the same logic on different timeframes.

2.5.1 HTF

Goal: define global bias.

Steps:

Run detectSwings on HTF with larger pivots / lookbacks (external structure).

Run detectBOS on HTF swings with strict close.

Run computeTrendBias on HTF (TrendBiasResult_HTF).

Keep or expose:

htfTrendBias at each HTF candle.

htfPdPosition.

htfLastSwingHigh, htfLastSwingLow.

2.5.2 ITF

Goal: execution structure within HTF context.

Steps:

Run the same swing/BOS/trend pipeline on ITF with smaller pivotLeft/pivotRight (internal structure).

For each ITF candle, map its time to the current HTF bias (nearest or last HTF candle).

Determine:

If htfTrendBias === 'bearish' and itfTrendBias === 'bearish' → alignment.

If htfTrendBias === 'bullish' and itfTrendBias === 'bearish' due to recent CHoCH → possible HTF reversal region or deep pullback.

2.5.3 LTF

Goal: refined entry.

Steps:

Run swing/BOS/CHoCH on LTF.

For each LTF candle, associate current ITF/HTF context (via timestamp).

Look for:

LTF liquidity sweeps.

LTF CHoCH into the dominant direction (HTF/ITF).

BOS confirmation after sweep.

2.5.4 Combined Entry Logic – Examples
Short setup (generic)

HTF context:

htfTrendBias === 'bearish'.

htfPdPosition >= premiumZoneMin (price in premium of last HTF down-leg).

ITF structure:

ITF recently had a bullish retracement into a HTF POI (this you can approximate as ITF trend flipping bullish temporarily).

Then ITF prints a CHoCH bearish:

BOS that breaks last ITF HL.

ITF trend flips from bullish to bearish.

LTF confirmation:

Within the ITF swing that made the CHoCH, on LTF you see:

LTF liquidity grab above a recent LTF high (wick above, close below).

Followed by LTF bearish CHoCH (break of LTF HL).

Entry: on retest of LTF OB/FVG or after BOS candle.

SL: above LTF high that was swept.

TP targets: HTF discount / next HTF low.

This is implementable as a chain of events:
HTF bearish + price in premium → ITF CHoCH bearish → LTF CHoCH bearish after liquidity sweep.

Long setup (generic)

Symmetric:

HTF bullish, price in discount.

ITF prints CHoCH bullish (break of last ITF LH).

LTF takes liquidity below a local low and then prints LTF CHoCH bullish → long entry.

3. Implementation-Oriented Summary (TypeScript-Oriented)

This is the “hand to dev” section.

3.1 Data Models
type Candle = {
  timestamp: number; // ms since epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type SwingType = 'high' | 'low';

type SwingPoint = {
  index: number;      // index into candles array
  type: SwingType;
  price: number;
};

type BosDirection = 'bullish' | 'bearish';

type BosEvent = {
  index: number;          // candle index where BOS confirmed
  direction: BosDirection;
  brokenSwingIndex: number;
  brokenSwingType: SwingType;
  level: number;          // price of broken swing
};

type TrendBias = 'bullish' | 'bearish' | 'sideways';

type TrendBiasSnapshot = {
  index: number;
  timestamp: number;
  trend: TrendBias;
  lastSwingHigh?: number | null;
  lastSwingLow?: number | null;
  lastBosDirection?: BosDirection | null;
  pdPosition?: number | null;   // 0..1 in PD array (low->high)
};

type ChoChEvent = {
  index: number;               // candle index where CHoCH BOS happened
  timestamp: number;
  fromTrend: 'bullish' | 'bearish';
  toTrend: 'bullish' | 'bearish';
  brokenSwingIndex: number;
  brokenSwingType: SwingType;
  level: number;
  bosIndex: number;            // same as index
};


Config:

type SwingConfig = {
  method: 'fractal' | 'rolling';
  pivotLeft?: number;
  pivotRight?: number;
  lookbackHigh?: number;
  lookbackLow?: number;
};

type BosConfig = {
  bosLookbackSwings: number;
  swingIndexLookback: number; // how far back in candle indices
  strictClose: boolean;       // true = ICT-style strict close; false = wick allowed
};

type TrendConfig = {
  minSwingPairs: number;      // how many recent swing pairs to confirm trend
  // thresholds for PD arrays
  discountMax: number;        // e.g., 0.5
  premiumMin: number;         // e.g., 0.5
};

type FrameworkConfig = {
  swing: SwingConfig;
  bos: BosConfig;
  trend: TrendConfig;
};

3.2 Functions to Implement
1. detectSwings(candles, config): SwingPoint[]

Purpose: Identify swing highs and lows.

Inputs:

candles: Candle[]

config.swing: SwingConfig

Output:

SwingPoint[] sorted by index.

Logic outline:

If config.method === 'fractal', run fractal pivot detection.

If config.method === 'rolling', run rolling lookback detection.

Sort swings by index and optionally deduplicate if same index appears multiple times.

2. detectBOS(candles, swings, config): BosEvent[]

Purpose: Detect BOS events based on swings.

Inputs:

candles: Candle[]

swings: SwingPoint[]

config.bos: BosConfig

Output:

BosEvent[] sorted by index.

Logic outline:

Sort swings by index.

For each candle index i:

Select candidate swings where s.index < i and within s.index >= i - swingIndexLookback.

For bullish BOS:

For each candidate swing high:

If strictClose:

if candles[i].close > sw.price → candidate bullish BOS.

Else:

if candles[i].high > sw.price → candidate.

For bearish BOS:

For each candidate swing low:

If strictClose:

if candles[i].close < sw.price → candidate bearish BOS.

Else:

if candles[i].low < sw.price → candidate.

Optionally select only the most recent swing as the broken one.

Append BOS events to array.

3. computeTrendBias(candles, swings, bosEvents, config): TrendBiasSnapshot[]

Purpose: Compute trend bias and PD array position for each candle.

Inputs:

candles: Candle[]

swings: SwingPoint[]

bosEvents: BosEvent[]

config.trend: TrendConfig

Output:

TrendBiasSnapshot[] (same length as candles).

Logic outline:

Sort swings and BOS.

Maintain rolling lists of last few swing highs and lows.

At each candle index i:

Update last swing high/low seen so far.

Check if any BOS occurs at i; update lastBosDirection.

Evaluate recent pattern of swings:

Take last K highs and lows (at least 2 each).

If highs and lows strictly increasing and lastBosDirection === 'bullish' → trend = 'bullish'.

If strictly decreasing and lastBosDirection === 'bearish' → trend = 'bearish'.

Else → trend = 'sideways'.

Compute PD position with last swing low & high.

Return array of snapshots.

This function will also support CHoCH detection by exposing trend over time.

4. detectChoCh(candles, swings, bosEvents, trendSnapshots, config): ChoChEvent[]

Purpose: Detect CHoCH events.

Inputs:

candles: Candle[]

swings: SwingPoint[]

bosEvents: BosEvent[]

trendSnapshots: TrendBiasSnapshot[] (per index)

config: TrendConfig (if needed for tie-breaking)

Output:

ChoChEvent[].

Logic outline:

For each BOS event bos:

Get trendAtBos = trendSnapshots[bos.index].trend.

If trendAtBos === 'sideways' → skip.

Identify the “protected swing”:

If trend bullish: last swing low (HL) before bos.index.

If trend bearish: last swing high (LH) before bos.index.

(You may want to track alternating swings to ensure HL/LH property).

If trendAtBos === 'bullish' and bos.direction === 'bearish' and BOS level breaks that HL (i.e., bos.level <= protectedLow.price) → CHoCH from bullish to bearish.

If trendAtBos === 'bearish' and bos.direction === 'bullish' and BOS level breaks that LH (i.e., bos.level >= protectedHigh.price) → CHoCH from bearish to bullish.

Construct ChoChEvent and push.

5. analyzeMultiTimeframe(htf, itf, ltf, config): MultiTimeframeContext

Define a combined structure:

type TimeframeAnalysis = {
  candles: Candle[];
  swings: SwingPoint[];
  bosEvents: BosEvent[];
  trendSnapshots: TrendBiasSnapshot[];
  chochEvents: ChoChEvent[];
};

type MultiTimeframeContext = {
  htf: TimeframeAnalysis;
  itf: TimeframeAnalysis;
  ltf: TimeframeAnalysis;
  // Optionally:
  entrySignals: EntrySignal[];
};

type EntrySignalDirection = 'long' | 'short';

type EntrySignal = {
  direction: EntrySignalDirection;
  timeframe: 'LTF';
  index: number;
  timestamp: number;
  reason: string;
};


Inputs:

htf: Candle[]

itf: Candle[]

ltf: Candle[]

config: FrameworkConfig (possibly per TF overrides).

Output:

MultiTimeframeContext.

Logic outline:

For each TF (htf, itf, ltf):

swings = detectSwings(candles, config.swingTF);

bosEvents = detectBOS(candles, swings, config.bosTF);

trendSnapshots = computeTrendBias(candles, swings, bosEvents, config.trendTF);

chochEvents = detectChoCh(candles, swings, bosEvents, trendSnapshots, config.trendTF);

Cross-map time:

Build helpers to map an LTF time to current ITF trend and HTF trend:

For each LTF candle, find latest HTF candle with timestamp <= ltfCandle.timestamp.

Same for ITF.

Derive entry signals:

For each LTF CHoCH event:

Get htfTrend and itfTrend at that time.

Example short criteria:

htfTrend === 'bearish'

itfTrend === 'bearish' OR ITF just printed CHoCH bearish recently.

LTF CHoCH is fromTrend: 'bullish', toTrend: 'bearish'.

If satisfied, emit EntrySignal with direction: 'short'.

For long criteria: mirror conditions.

Return the full context.