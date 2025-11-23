import OpenAI from 'openai';
import { getNewsGuardrailConfig } from '@providencex/shared-config';
import { Logger } from '@providencex/shared-utils';
import { NewsWindow } from '@providencex/shared-types';
import { parseToPXTimezone, formatDateForPX, getNowInPXTimezone } from '@providencex/shared-utils';

const logger = new Logger('OpenAIService');

const openai = new OpenAI({
  apiKey: getNewsGuardrailConfig().openaiApiKey,
});

const PROMPT = `
You are a senior professional trader, macro analyst, and risk manager for an automated trading system called ProvidenceX.

The system trades:
- XAUUSD (primary)
- EURUSD
- GBPUSD
- US30

You are given a screenshot of the ForexFactory economic calendar for TODAY.

Your job:

1. Read every event on the calendar (high, medium, and low).
2. Identify ALL events for USD, EUR, and GBP.
3. For each USD/EUR/GBP event, determine how dangerous it is for short-term intraday trading.
4. Pay special attention to:
   - Gold (XAUUSD) volatility
   - USD-sensitive events (CPI, NFP, FOMC, rate decisions, major speeches)
   - Liquidity killers (bank holidays, early market closures, very thin sessions)
   - Overlapping clusters of events close together in time
   - Fed/ECB/BoE speeches (even if marked LOW impact)
   - Sentiment / confidence / expectations releases that can trigger sudden spikes
5. Produce the most accurate and conservative risk classification possible.

You must evaluate every event intelligently, not blindly based on color.

Low impact events can still be CRITICAL if:
- It is a central bank speaker
- It's an unscheduled remark or press conference
- It is a sentiment or expectations index
- It is overlapping with higher impact releases
- It occurs during thin liquidity periods

For each USD/EUR/GBP event on the calendar, output a JSON object containing:

{
  "event_name": "string",
  "currency": "USD | EUR | GBP",
  "impact": "high | medium | low",          // from the calendar
  "time": "HH:MM",                          // 24h format in America/New_York
  "is_critical": true/false,                // true if this event can seriously destabilize the market
  "risk_score": 0–100,                      // 0 = negligible, 100 = extremely dangerous
  "avoid_before_minutes": number,           // minutes to avoid BEFORE this event
  "avoid_after_minutes": number,            // minutes to avoid AFTER this event
  "reason": "short explanation (1 sentence)",
  "detailed_description": "full trader-level explanation of why this moment is unsafe or sensitive to trade, referencing volatility expectations, historical behavior, liquidity conditions, potential manipulation/sweep zones, or algo activity."
}

Guidance (modify intelligently, do NOT follow mechanically):

- Use the risk_score scale approximately as:
  - 0–15: very minor, almost no effect; avoid window can be 0–5 minutes.
  - 16–39: low risk; small avoid window (e.g. 5–15 minutes) is enough.
  - 40–69: medium risk; avoid 15–30 minutes before and 30–45 minutes after.
  - 70–84: high risk; avoid 30–60 minutes before and 45–90 minutes after.
  - 85–100: extreme risk (major releases / critical events); be very conservative with long avoid windows.

- Major releases (CPI, NFP, rate decisions, FOMC, key inflation/employment data):
  - Typically high or extreme risk (70–100) with long avoid windows.

- Fed/ECB/BoE leadership speeches:
  - Often high risk even when labeled low impact, especially if around other events.

- Clustered events (<30–45 minutes apart):
  - Treat the cluster as one extended danger area and lengthen avoid_before_minutes and avoid_after_minutes for those events.

- Thin liquidity conditions (holidays, partial closures, out-of-session releases):
  - Increase risk_score and extend avoid windows because price can move erratically on little volume.

Output Requirements:
- Include ALL USD, EUR, and GBP events visible on the calendar.
- If an event is truly minor, still include it but assign a low risk_score (e.g. 5–15) and small avoid windows.
- Return ONLY a clean JSON array (no markdown, no backticks, no extra commentary).
- Time MUST be converted to America/New_York.
- Ensure the JSON is valid and parses without errors.
`;


export async function analyzeScreenshot(screenshotBuffer: Buffer): Promise<NewsWindow[]> {
  try {
    const base64Image = screenshotBuffer.toString('base64');
    const today = formatDateForPX(getNowInPXTimezone());

    const response = await openai.chat.completions.create({
      model: 'gpt-4o', // or 'gpt-4-vision-preview'
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 4000, // Increased for detailed descriptions and more events
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    // Parse JSON response (may be wrapped in markdown code blocks)
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    }

    const events = JSON.parse(jsonStr) as Array<{
      event_name: string;
      currency: 'USD' | 'EUR' | 'GBP';
      impact: 'high' | 'medium' | 'low';
      time: string;
      is_critical: boolean;
      risk_score: number;
      avoid_before_minutes: number;
      avoid_after_minutes: number;
      reason: string;
      detailed_description: string;
    }>;

    // Convert events to NewsWindow format with avoid windows
    const windows: NewsWindow[] = [];
    const todayDate = getNowInPXTimezone();

    for (const event of events) {
      const [hours, minutes] = event.time.split(':').map(Number);
      const eventTime = todayDate.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
      
      // Create window using model-based avoid minutes
      const startTime = eventTime.minus({ minutes: event.avoid_before_minutes });
      const endTime = eventTime.plus({ minutes: event.avoid_after_minutes });

      windows.push({
        start_time: startTime.toISO()!,
        end_time: endTime.toISO()!,
        currency: event.currency,
        impact: event.impact,
        event_name: event.event_name,
        is_critical: event.is_critical,
        risk_score: event.risk_score,
        reason: event.reason,
        detailed_description: event.detailed_description,
      });
    }

    logger.info(`Extracted ${windows.length} avoid windows from screenshot`);
    // Log critical events for visibility
    const criticalEvents = windows.filter(w => w.is_critical);
    if (criticalEvents.length > 0) {
      logger.info(`Found ${criticalEvents.length} critical events:`, 
        criticalEvents.map(e => `${e.event_name} (${e.currency}, risk: ${e.risk_score})`).join(', ')
      );
    }
    return windows;
  } catch (error) {
    logger.error('Failed to analyze screenshot with OpenAI', error);
    throw new Error(`OpenAI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

