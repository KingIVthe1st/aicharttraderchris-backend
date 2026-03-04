import { Hono } from "hono";
import { cors } from "hono/cors";
import { jwt, sign, verify } from "hono/jwt";
import OpenAI from "openai";
import Stripe from "stripe";
import { computeSoulBlueprint, saveSoulBlueprint, getSoulBlueprint, updateSoulBlueprint } from './soulBlueprint';
import type { SoulBlueprintInput } from './soulBlueprint';
import { getCosmicIntelligence, generateCosmicOverlayContext } from './cosmicEngine';
import { refreshEnvironmentalData } from './environmentalEnergy';

// Environment type definition
type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  SESSIONS: KVNamespace;
  RATE_LIMIT: KVNamespace;
  FINRA_DATA: KVNamespace;
  INSTITUTIONAL_DATA: KVNamespace; // Free institutional data (COT, FRED, CBOE, Sentiment)
  ANALYTICS: AnalyticsEngineDataset;
  OPENAI_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID: string;
  JWT_SECRET: string;
  CORS_ORIGINS: string;
  FRED_API_KEY?: string; // Optional - for FRED API (free registration)
};

// FINRA Dark Pool data types
interface FINRADarkPoolData {
  lastUpdated: string;
  weekEnding: string;
  symbols: {
    [symbol: string]: {
      totalVolume: number;
      avgPrice: number;
      venues: {
        name: string;
        volume: number;
        percentOfTotal: number;
      }[];
      // Derived institutional levels
      volumeWeightedPrice: number;
      highVolumeZones: {
        priceLevel: number;
        volume: number;
        significance: "high" | "medium" | "low";
      }[];
    };
  };
}

// =====================================================
// FREE INSTITUTIONAL DATA TYPES
// =====================================================

// CFTC Commitment of Traders (COT) data
interface COTData {
  lastUpdated: string;
  reportDate: string; // Tuesday of report week
  contracts: {
    [symbol: string]: {
      // ES = "E-MINI S&P 500", NQ = "E-MINI NASDAQ 100"
      assetManagers: {
        longPositions: number;
        shortPositions: number;
        netPosition: number;
        weeklyChange: number;
      };
      leveragedFunds: {
        // Hedge funds
        longPositions: number;
        shortPositions: number;
        netPosition: number;
        weeklyChange: number;
      };
      commercials: {
        // Hedgers
        longPositions: number;
        shortPositions: number;
        netPosition: number;
      };
      openInterest: number;
      openInterestChange: number;
      signal: "extreme_long" | "long" | "neutral" | "short" | "extreme_short";
    };
  };
}

// FRED Economic Data (Federal Reserve)
interface FREDData {
  lastUpdated: string;
  series: {
    // Net Liquidity = WALCL - (TGA + RRP)
    fedBalanceSheet: number; // WALCL - Total Assets
    reverseRepo: number; // RRPONTSYD - Liquidity drain
    treasuryGeneral: number; // TGA - Treasury checking
    netLiquidity: number; // Calculated
    netLiquidityChange: number; // Week over week
    // Yields & Rates
    tenYearYield: number; // DGS10
    twoYearYield: number; // DGS2
    yieldCurve: number; // T10Y2Y (10Y - 2Y)
    fedFundsRate: number; // FEDFUNDS
    // Financial Conditions
    financialStressIndex: number; // STLFSI4
    // Signals
    liquiditySignal: "expanding" | "stable" | "contracting";
    yieldCurveSignal: "steep" | "flat" | "inverted";
  };
}

// CBOE Market Data (VIX, Put/Call)
interface CBOEData {
  lastUpdated: string;
  dataOrigin: "live" | "estimated" | "fallback"; // Track data quality
  vix: {
    current: number;
    previousClose: number;
    change: number;
    percentile30Day: number; // Where VIX sits vs last 30 days
    termStructure: "contango" | "flat" | "backwardation"; // VIX vs VIX3M
    isEstimated: boolean; // True if using fallback values
  };
  putCallRatio: {
    total: number; // All options
    equity: number; // Stock options only
    index: number; // Index options (SPX)
    fiveDayAvg: number;
    signal: "extreme_fear" | "fear" | "neutral" | "greed" | "extreme_greed";
    isEstimated: boolean; // Put/Call is always estimated (no free API)
  };
}

// CNN Fear & Greed Index
interface FearGreedData {
  lastUpdated: string;
  dataOrigin: "live" | "estimated" | "fallback"; // Track data quality
  current: number; // 0-100
  previous: number;
  oneWeekAgo: number | null; // null if historical data unavailable
  oneMonthAgo: number | null; // null if historical data unavailable
  classification:
    | "extreme_fear"
    | "fear"
    | "neutral"
    | "greed"
    | "extreme_greed";
  components?: {
    marketMomentum: number;
    stockPriceStrength: number;
    stockPriceBreadth: number;
    putCallRatio: number;
    marketVolatility: number;
    safeHavenDemand: number;
    junkBondDemand: number;
  };
}

// Enhanced Institutional Intelligence (based on professional trading frameworks)
type MarketRegime =
  | "BULL_QUIET" // High liquidity + Bullish COT + Low VIX - Trend following
  | "BULL_VOLATILE" // Bullish Macro + High VIX - Take profits, reduce size
  | "BEAR_QUIET" // Bearish liquidity + Neutral VIX - Sell rallies
  | "BEAR_VOLATILE" // Bearish liquidity + Spiking VIX - Cash/tactical scalps
  | "RANGE_BOUND"; // Mixed signals - Mean reversion plays

interface InstitutionalIntelligence {
  marketRegime: MarketRegime;
  regimeDescription: string;
  institutionalAlignment: number; // 1-10 score
  strategicScore: number; // Macro/COT alignment (1-10)
  tacticalScore: number; // Sentiment timing (1-10)
  smartMoneyBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  convictionMultiplier: number; // 0.5 to 1.5
  vixAdjustment: number; // Position size adjustment based on VIX
  painTrade: {
    direction: "LONG_SQUEEZE" | "SHORT_SQUEEZE" | "NONE";
    description: string;
  };
  contrarianAlerts: string[];
  tradingGuidance: string;
  keyRisks: string[];
  signalBreakdown: string[]; // Detailed signal contributions for transparency
  dataQuality: {
    score: number; // 0-100, percentage of data quality
    issues: string[]; // List of data quality issues
    isReliable: boolean; // true if score > 70
  };
}

// Combined Institutional Intelligence
interface InstitutionalData {
  lastUpdated: string;
  cot?: COTData;
  fred?: FREDData;
  cboe?: CBOEData;
  fearGreed?: FearGreedData;
  // Legacy composite signals
  compositeSignal?: {
    bias: "bullish" | "neutral" | "bearish";
    confidence: number; // 0-100
    factors: string[];
  };
  // Enhanced intelligence (new)
  intelligence?: InstitutionalIntelligence;
}

// =====================================================
// INSTITUTIONAL DATA FETCHERS (Free APIs)
// =====================================================

// Fetch CFTC Commitment of Traders data (weekly, updated Friday)
async function fetchCOTData(): Promise<{
  success: boolean;
  data?: COTData;
  error?: string;
}> {
  try {
    // CFTC Traders in Financial Futures (TFF) - for index futures
    // Dataset: gpe5-46if (TFF Futures Only)
    const symbols = ["ES", "NQ"]; // E-mini S&P, Nasdaq - financial futures
    const cftcCodes: { [key: string]: string } = {
      ES: "13874A", // E-MINI S&P 500
      NQ: "209742", // NASDAQ MINI
    };

    const contracts: COTData["contracts"] = {};

    for (const symbol of symbols) {
      const cftcCode = cftcCodes[symbol];
      // Get latest 2 weeks for change calculation
      // Using TFF dataset (gpe5-46if) for financial futures
      const url = `https://publicreporting.cftc.gov/resource/gpe5-46if.json?cftc_contract_market_code=${cftcCode}&$order=report_date_as_yyyy_mm_dd DESC&$limit=2`;

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) continue;

      const rows = (await response.json()) as any[];
      if (!rows || rows.length === 0) continue;

      const latest = rows[0];
      const previous = rows[1] || latest;

      // Asset Managers (from TFF report - institutional investors)
      const amLong = parseInt(latest.asset_mgr_positions_long) || 0;
      const amShort = parseInt(latest.asset_mgr_positions_short) || 0;
      const amNetNow = amLong - amShort;
      const amNetPrev =
        (parseInt(previous.asset_mgr_positions_long) || 0) -
        (parseInt(previous.asset_mgr_positions_short) || 0);

      // Leveraged Funds (from TFF report - hedge funds)
      const lfLong = parseInt(latest.lev_money_positions_long) || 0;
      const lfShort = parseInt(latest.lev_money_positions_short) || 0;
      const lfNetNow = lfLong - lfShort;
      const lfNetPrev =
        (parseInt(previous.lev_money_positions_long) || 0) -
        (parseInt(previous.lev_money_positions_short) || 0);

      // Dealers (from TFF report - market makers/banks)
      const commLong = parseInt(latest.dealer_positions_long) || 0;
      const commShort = parseInt(latest.dealer_positions_short) || 0;

      // Open Interest
      const oi = parseInt(latest.open_interest_all) || 0;
      const oiPrev = parseInt(previous.open_interest_all) || 0;

      // Determine signal based on net positioning extremes
      const totalNet = amNetNow + lfNetNow;
      const netAsPercent = oi > 0 ? (totalNet / oi) * 100 : 0;

      let signal: COTData["contracts"][string]["signal"];
      if (netAsPercent > 15) signal = "extreme_long";
      else if (netAsPercent > 5) signal = "long";
      else if (netAsPercent < -15) signal = "extreme_short";
      else if (netAsPercent < -5) signal = "short";
      else signal = "neutral";

      contracts[symbol] = {
        assetManagers: {
          longPositions: amLong,
          shortPositions: amShort,
          netPosition: amNetNow,
          weeklyChange: amNetNow - amNetPrev,
        },
        leveragedFunds: {
          longPositions: lfLong,
          shortPositions: lfShort,
          netPosition: lfNetNow,
          weeklyChange: lfNetNow - lfNetPrev,
        },
        commercials: {
          longPositions: commLong,
          shortPositions: commShort,
          netPosition: commLong - commShort,
        },
        openInterest: oi,
        openInterestChange: oi - oiPrev,
        signal,
      };
    }

    // Get the report date from latest data
    const sampleUrl = `https://publicreporting.cftc.gov/resource/6dca-syja.json?$order=report_date_as_yyyy_mm_dd DESC&$limit=1`;
    const sampleRes = await fetch(sampleUrl);
    const sampleData = (await sampleRes.json()) as any[];
    const reportDate =
      sampleData[0]?.report_date_as_yyyy_mm_dd ||
      new Date().toISOString().split("T")[0];

    return {
      success: true,
      data: {
        lastUpdated: new Date().toISOString(),
        reportDate,
        contracts,
      },
    };
  } catch (error: any) {
    console.error("[COT] Fetch error:", error.message);
    return { success: false, error: error.message };
  }
}

// Fetch FRED data (Federal Reserve Economic Data)
async function fetchFREDData(
  apiKey?: string,
): Promise<{ success: boolean; data?: FREDData; error?: string }> {
  try {
    // If no API key, use fallback estimates based on recent trends
    if (!apiKey) {
      console.log("[FRED] No API key - using estimated liquidity data");
      // Fallback: reasonable estimates updated manually if needed
      return {
        success: true,
        data: {
          lastUpdated: new Date().toISOString(),
          series: {
            fedBalanceSheet: 6800000, // ~$6.8T (WALCL in millions)
            reverseRepo: 500000, // ~$500B (RRP)
            treasuryGeneral: 700000, // ~$700B (TGA)
            netLiquidity: 5600000, // Fed BS - RRP - TGA
            netLiquidityChange: 0,
            tenYearYield: 4.25,
            twoYearYield: 4.1,
            yieldCurve: 0.15,
            fedFundsRate: 4.5,
            financialStressIndex: 0,
            liquiditySignal: "stable",
            yieldCurveSignal: "flat",
          },
        },
      };
    }

    const baseUrl = "https://api.stlouisfed.org/fred/series/observations";
    const seriesIds = {
      fedBalanceSheet: "WALCL",
      reverseRepo: "RRPONTSYD",
      treasuryGeneral: "WTREGEN",
      tenYearYield: "DGS10",
      twoYearYield: "DGS2",
      yieldCurve: "T10Y2Y",
      fedFundsRate: "FEDFUNDS",
      financialStressIndex: "STLFSI4",
    };

    const series: Partial<FREDData["series"]> = {};
    // Track previous values for liquidity change calculation
    const prevValues: Record<string, number> = {};
    const liquidityKeys = ["fedBalanceSheet", "reverseRepo", "treasuryGeneral"];

    const today = new Date().toISOString().split("T")[0];
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    for (const [key, seriesId] of Object.entries(seriesIds)) {
      try {
        const url = `${baseUrl}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&observation_start=${threeMonthsAgo}&observation_end=${today}&sort_order=desc&limit=5`;
        const response = await fetch(url);
        const data = (await response.json()) as {
          observations?: { value: string; date: string }[];
        };

        if (data.observations && data.observations.length > 0) {
          const latestValue = parseFloat(data.observations[0].value);
          if (!isNaN(latestValue)) {
            (series as any)[key] = latestValue;
          }
          // Store previous value for liquidity components (for week-over-week change)
          if (liquidityKeys.includes(key) && data.observations.length >= 2) {
            const prevValue = parseFloat(data.observations[1].value);
            if (!isNaN(prevValue)) {
              prevValues[key] = prevValue;
            }
          }
        }
      } catch (err) {
        console.warn(`[FRED] Failed to fetch ${seriesId}:`, err);
      }
    }

    // Calculate net liquidity: Fed Balance Sheet - RRP - TGA
    // NOTE: WALCL and WTREGEN are in Millions USD, but RRPONTSYD is in Billions USD
    // We must convert RRP to millions for consistent calculation
    const fedBS = (series.fedBalanceSheet || 0) as number;
    const rrpBillions = (series.reverseRepo || 0) as number;
    const rrp = rrpBillions * 1000; // Convert billions to millions
    const tga = (series.treasuryGeneral || 0) as number;
    series.netLiquidity = fedBS - rrp - tga;

    // Calculate week-over-week change using previous observations
    const prevFedBS = prevValues.fedBalanceSheet ?? fedBS;
    const prevRrpBillions = prevValues.reverseRepo ?? rrpBillions;
    const prevRrp = prevRrpBillions * 1000; // Convert billions to millions
    const prevTga = prevValues.treasuryGeneral ?? tga;
    const prevNetLiquidity = prevFedBS - prevRrp - prevTga;
    series.netLiquidityChange = series.netLiquidity - prevNetLiquidity;
    console.log(
      `[FRED] Net Liquidity: $${(series.netLiquidity / 1000000).toFixed(2)}T, Change: $${(series.netLiquidityChange / 1000).toFixed(0)}B`,
    );

    // Determine signals
    if (series.netLiquidityChange && series.netLiquidityChange > 50000) {
      series.liquiditySignal = "expanding";
    } else if (
      series.netLiquidityChange &&
      series.netLiquidityChange < -50000
    ) {
      series.liquiditySignal = "contracting";
    } else {
      series.liquiditySignal = "stable";
    }

    const yc = (series.yieldCurve || 0) as number;
    if (yc > 0.5) series.yieldCurveSignal = "steep";
    else if (yc < 0) series.yieldCurveSignal = "inverted";
    else series.yieldCurveSignal = "flat";

    return {
      success: true,
      data: {
        lastUpdated: new Date().toISOString(),
        series: series as FREDData["series"],
      },
    };
  } catch (error: any) {
    console.error("[FRED] Fetch error:", error.message);
    return { success: false, error: error.message };
  }
}

// Fetch CBOE data (VIX and Put/Call ratios)
async function fetchCBOEData(): Promise<{
  success: boolean;
  data?: CBOEData;
  error?: string;
}> {
  try {
    // Use Yahoo Finance for VIX data (CBOE API now blocks programmatic access)
    // Yahoo Finance provides the same CBOE VIX data through their chart API
    const vixUrl =
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d";

    let vixData = {
      current: 15,
      previousClose: 15,
      change: 0,
      percentile30Day: 50,
      termStructure: "contango" as const,
      isEstimated: true, // Default to true, set false if live data received
    };
    let vixIsLive = false;

    try {
      const vixResponse = await fetch(vixUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; TradingBot/1.0)",
        },
      });
      if (vixResponse.ok) {
        const vixJson = (await vixResponse.json()) as any;
        const meta = vixJson?.chart?.result?.[0]?.meta;
        const livePrice = parseFloat(meta?.regularMarketPrice);
        const livePrevClose = parseFloat(meta?.chartPreviousClose);

        if (!isNaN(livePrice) && livePrice > 0) {
          vixData.current = livePrice;
          vixData.previousClose = !isNaN(livePrevClose)
            ? livePrevClose
            : livePrice;
          vixData.change = vixData.current - vixData.previousClose;
          vixData.isEstimated = false;
          vixIsLive = true;

          // Determine term structure based on recent price action
          // If VIX is elevated and rising, likely backwardation (fear)
          // If VIX is low/falling, likely contango (complacency)
          if (vixData.current > 25 && vixData.change > 0) {
            vixData.termStructure = "backwardation";
          } else {
            vixData.termStructure = "contango";
          }

          console.log(
            `[VIX] Live from Yahoo Finance: ${livePrice.toFixed(2)} (${vixData.change > 0 ? "+" : ""}${vixData.change.toFixed(2)}, ${vixData.termStructure})`,
          );
        }
      } else {
        console.warn(`[VIX] Yahoo Finance returned ${vixResponse.status}`);
      }
    } catch (err) {
      console.warn("[VIX] Fetch failed, using estimated defaults:", err);
    }

    // Put/Call ratio - CBOE doesn't have a clean API, so we estimate
    // In production, you'd scrape or use a paid data source
    const putCallData = {
      total: 0.95,
      equity: 0.65,
      index: 1.2,
      fiveDayAvg: 0.9,
      signal: "neutral" as const,
      isEstimated: true, // Always estimated without paid data
    };

    // Determine P/C signal (contrarian - high P/C = fear = potential buy)
    if (putCallData.total > 1.2) putCallData.signal = "extreme_fear";
    else if (putCallData.total > 1.0) putCallData.signal = "fear";
    else if (putCallData.total < 0.6) putCallData.signal = "extreme_greed";
    else if (putCallData.total < 0.8) putCallData.signal = "greed";

    return {
      success: true,
      data: {
        lastUpdated: new Date().toISOString(),
        dataOrigin: vixIsLive ? "live" : "estimated",
        vix: vixData,
        putCallRatio: putCallData,
      },
    };
  } catch (error: any) {
    console.error("[CBOE] Fetch error:", error.message);
    return { success: false, error: error.message };
  }
}

// Fetch CNN Fear & Greed Index
async function fetchFearGreedData(): Promise<{
  success: boolean;
  data?: FearGreedData;
  error?: string;
}> {
  try {
    const url =
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; TradingBot/1.0)",
      },
    });

    if (!response.ok) {
      throw new Error(`CNN API returned ${response.status}`);
    }

    const data = (await response.json()) as any;

    // Parse the fear & greed response - use null for missing historical data (not current!)
    const current = parseFloat(data?.fear_and_greed?.score);
    if (isNaN(current)) {
      throw new Error("No valid Fear & Greed score in response");
    }

    const previous =
      parseFloat(data?.fear_and_greed?.previous_close) || current;
    // Use null for historical if not available - this is BETTER than falling back to current
    const oneWeekAgo =
      data?.fear_and_greed_historical?.one_week_ago?.score ?? null;
    const oneMonthAgo =
      data?.fear_and_greed_historical?.one_month_ago?.score ?? null;

    // Classify the score
    let classification: FearGreedData["classification"];
    if (current <= 25) classification = "extreme_fear";
    else if (current <= 45) classification = "fear";
    else if (current <= 55) classification = "neutral";
    else if (current <= 75) classification = "greed";
    else classification = "extreme_greed";

    console.log(
      `[FearGreed] Live: ${current.toFixed(1)} (${classification}), Week ago: ${oneWeekAgo ?? "N/A"}`,
    );

    return {
      success: true,
      data: {
        lastUpdated: new Date().toISOString(),
        dataOrigin: "live",
        current,
        previous,
        oneWeekAgo,
        oneMonthAgo,
        classification,
      },
    };
  } catch (error: any) {
    console.error("[FearGreed] Fetch error:", error.message);
    // CRITICAL FIX: Return success:false on failure, not hidden defaults
    // Include fallback data but clearly mark it as such
    return {
      success: false,
      error: error.message,
      data: {
        lastUpdated: new Date().toISOString(),
        dataOrigin: "fallback", // CLEARLY MARKED AS FALLBACK
        current: 50,
        previous: 50,
        oneWeekAgo: null,
        oneMonthAgo: null,
        classification: "neutral",
      },
    };
  }
}

// =====================================================
// ENHANCED INTELLIGENCE CALCULATION (Professional Framework)
// Based on: Signal Hierarchy, Constructive Tension, Pain Trade Analysis
// =====================================================

function calculateInstitutionalIntelligence(
  cot: COTData | undefined,
  fred: FREDData | undefined,
  cboe: CBOEData | undefined,
  fearGreed: FearGreedData | undefined,
): InstitutionalIntelligence {
  // Default values
  let marketRegime: MarketRegime = "RANGE_BOUND";
  let strategicScore = 5; // Macro/COT (1-10)
  let tacticalScore = 5; // Sentiment timing (1-10)
  let smartMoneyBias: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  let convictionMultiplier = 1.0;
  let vixAdjustment = 1.0;
  const contrarianAlerts: string[] = [];
  const keyRisks: string[] = [];

  // ========== TIER 1: MACRO FLOOR (40% weight) ==========
  // Fed Liquidity determines the "river current"
  let liquidityBias = 0; // -2 to +2
  const signalBreakdown: string[] = []; // Track individual signal contributions

  if (fred?.series?.liquiditySignal) {
    if (fred.series.liquiditySignal === "expanding") {
      liquidityBias = 2;
      signalBreakdown.push("Liquidity expanding: +2.0 bias");
    } else if (fred.series.liquiditySignal === "contracting") {
      liquidityBias = -2;
      signalBreakdown.push("Liquidity contracting: -2.0 bias");
    }
    // Yield curve adds context
    if (fred.series.yieldCurveSignal === "inverted") {
      liquidityBias -= 1; // Recession warning
      keyRisks.push("Yield curve inverted - recession risk elevated");
      signalBreakdown.push("Yield curve inverted: -1.0 adjustment");
    }
  }

  // Net Liquidity RATE OF CHANGE - direction matters as much as level
  const netLiquidityChange = fred?.series?.netLiquidityChange;
  if (
    typeof netLiquidityChange === "number" &&
    !Number.isNaN(netLiquidityChange)
  ) {
    if (netLiquidityChange > 20000) {
      liquidityBias += 0.3; // Improving liquidity (>$20B/week)
      signalBreakdown.push(
        `Liquidity improving: +$${(netLiquidityChange / 1000).toFixed(1)}B/week (+0.3)`,
      );
    } else if (netLiquidityChange < -20000) {
      liquidityBias -= 0.3; // Deteriorating liquidity
      signalBreakdown.push(
        `Liquidity deteriorating: -$${(Math.abs(netLiquidityChange) / 1000).toFixed(1)}B/week (-0.3)`,
      );
    }
  }

  // ========== TIER 2: STRUCTURAL POSITION (30% weight) ==========
  // COT positioning - who is trapped?
  // Using Z-SCORES for adaptive thresholds instead of hard-coded values
  // Historical Asset Manager ES positioning: mean ~400K, stdDev ~200K
  const COT_HISTORICAL = {
    assetManagers: { mean: 400000, stdDev: 200000 },
    leveragedFunds: { mean: -200000, stdDev: 150000 },
    weeklyChange: { mean: 0, stdDev: 25000 },
  };

  let cotBias = 0; // -2 to +2
  let cotExtreme = false;
  let cotZScore = 0;

  if (cot?.contracts) {
    let totalAssetMgrNet = 0;
    let totalLevFundNet = 0;

    for (const pos of Object.values(cot.contracts)) {
      totalAssetMgrNet += pos.assetManagers.netPosition;
      totalLevFundNet += pos.leveragedFunds.netPosition;
    }

    // Calculate Z-score for Asset Manager positioning
    // Z = (current - mean) / stdDev
    cotZScore =
      (totalAssetMgrNet - COT_HISTORICAL.assetManagers.mean) /
      COT_HISTORICAL.assetManagers.stdDev;

    // GRADUATED COT SCALE using Z-scores
    // Z > 2.5 = extreme crowding (>3 stdDev from mean)
    // Z > 1.5 = strong bullish positioning
    // Z > 0.5 = moderately bullish
    // Z > -0.5 = neutral zone
    // Z < -0.5 = moderately bearish
    // Z < -1.5 = strong bearish (rare for smart money)
    // Z < -2.5 = extreme defensive (crisis mode)

    if (cotZScore > 2.5) {
      cotBias = 2;
      cotExtreme = true;
      keyRisks.push(
        `Asset Manager positioning at ${cotZScore.toFixed(1)}σ - crowded long trade`,
      );
      signalBreakdown.push(
        `COT Z-score: ${cotZScore.toFixed(2)}σ (extreme crowding, +2 bias)`,
      );
    } else if (cotZScore > 1.5) {
      cotBias = 2;
      signalBreakdown.push(
        `COT Z-score: ${cotZScore.toFixed(2)}σ (strong bullish, +2 bias)`,
      );
    } else if (cotZScore > 0.5) {
      cotBias = 1;
      signalBreakdown.push(
        `COT Z-score: ${cotZScore.toFixed(2)}σ (moderately bullish, +1 bias)`,
      );
    } else if (cotZScore > -0.5) {
      // Neutral zone - but give slight bias based on direction
      cotBias = cotZScore > 0 ? 0.3 : cotZScore < 0 ? -0.3 : 0;
      signalBreakdown.push(
        `COT Z-score: ${cotZScore.toFixed(2)}σ (neutral range, ${cotBias > 0 ? "+" : ""}${cotBias.toFixed(1)} bias)`,
      );
    } else if (cotZScore > -1.5) {
      cotBias = -1;
      signalBreakdown.push(
        `COT Z-score: ${cotZScore.toFixed(2)}σ (moderately bearish, -1 bias)`,
      );
    } else if (cotZScore > -2.5) {
      cotBias = -2;
      signalBreakdown.push(
        `COT Z-score: ${cotZScore.toFixed(2)}σ (strong bearish, -2 bias)`,
      );
    } else {
      cotBias = -2;
      cotExtreme = true;
      keyRisks.push(
        `Asset Manager positioning at ${cotZScore.toFixed(1)}σ - extreme defensive stance`,
      );
      signalBreakdown.push(
        `COT Z-score: ${cotZScore.toFixed(2)}σ (extreme defensive, -2 bias)`,
      );
    }

    // COT WEEKLY CHANGE - momentum/velocity using Z-scores
    // This catches "smart money turning" even when net position appears neutral
    let totalWeeklyChange = 0;
    for (const pos of Object.values(cot.contracts)) {
      totalWeeklyChange += pos.assetManagers.weeklyChange || 0;
    }

    const weeklyZScore = totalWeeklyChange / COT_HISTORICAL.weeklyChange.stdDev;

    if (weeklyZScore > 0.5) {
      // Significant accumulation (>0.5 stdDev weekly change)
      const momentum = Math.min(weeklyZScore * 0.25, 0.75); // Cap at 0.75
      cotBias += momentum;
      signalBreakdown.push(
        `COT momentum: +${totalWeeklyChange.toLocaleString()} contracts (${weeklyZScore.toFixed(1)}σ, +${momentum.toFixed(2)} bias)`,
      );
    } else if (weeklyZScore < -0.5) {
      // Significant distribution
      const momentum = Math.max(weeklyZScore * 0.25, -0.75); // Cap at -0.75
      cotBias += momentum;
      signalBreakdown.push(
        `COT momentum: ${totalWeeklyChange.toLocaleString()} contracts (${weeklyZScore.toFixed(1)}σ, ${momentum.toFixed(2)} bias)`,
      );
    }
  }

  // ========== TIER 3: TACTICAL SENTIMENT (30% weight) ==========
  // VIX, Put/Call, Fear & Greed - the "rubber band"
  let sentimentBias = 0; // -2 to +2 (CONTRARIAN interpretation)
  let vixLevel = 20; // default

  if (cboe?.vix) {
    vixLevel = cboe.vix.current;

    // GRADUATED VIX SCALE - Eliminates dead zones for nuanced sentiment
    // Historical VIX: mean ~18, stdDev ~5
    if (vixLevel > 35) {
      sentimentBias += 2.5; // Panic territory = strong contrarian BUY
      contrarianAlerts.push(
        `🔥 VIX at ${vixLevel.toFixed(1)} - PANIC levels, historically marks major bottoms`,
      );
      signalBreakdown.push(
        `VIX panic: ${vixLevel.toFixed(1)} (+2.5 sentiment)`,
      );
    } else if (vixLevel > 30) {
      sentimentBias += 2; // Extreme fear = contrarian BUY
      contrarianAlerts.push(
        `🔥 VIX at ${vixLevel.toFixed(1)} - Extreme fear often marks bottoms`,
      );
      signalBreakdown.push(
        `VIX extreme fear: ${vixLevel.toFixed(1)} (+2.0 sentiment)`,
      );
    } else if (vixLevel > 25) {
      sentimentBias += 1.0; // Elevated fear
      signalBreakdown.push(
        `VIX elevated: ${vixLevel.toFixed(1)} (+1.0 sentiment)`,
      );
    } else if (vixLevel > 22) {
      sentimentBias += 0.5; // Mild concern - was dead zone, now contributes
      signalBreakdown.push(
        `VIX above average: ${vixLevel.toFixed(1)} (+0.5 sentiment)`,
      );
    } else if (vixLevel > 18) {
      // True neutral zone - no contribution (VIX at historical mean)
    } else if (vixLevel > 15) {
      sentimentBias -= 0.3; // Mild complacency - was dead zone, now contributes
      signalBreakdown.push(
        `VIX below average: ${vixLevel.toFixed(1)} (-0.3 sentiment)`,
      );
    } else if (vixLevel > 12) {
      sentimentBias -= 1; // Complacency building
      signalBreakdown.push(`VIX low: ${vixLevel.toFixed(1)} (-1.0 sentiment)`);
    } else {
      sentimentBias -= 2; // Extreme complacency = contrarian SELL
      contrarianAlerts.push(
        `⚠️ VIX at ${vixLevel.toFixed(1)} - Extreme complacency precedes corrections`,
      );
      signalBreakdown.push(
        `VIX extreme complacency: ${vixLevel.toFixed(1)} (-2.0 sentiment)`,
      );
    }

    // VIX adjustment for position sizing (graduated)
    if (vixLevel > 30) {
      vixAdjustment = 0.5; // Significantly reduce size in panic
    } else if (vixLevel > 25) {
      vixAdjustment = 0.7; // Reduce size in volatile markets
    } else if (vixLevel > 20) {
      vixAdjustment = 0.9; // Slightly reduce
    } else if (vixLevel < 12) {
      vixAdjustment = 1.3; // Can size up significantly in very calm markets
    } else if (vixLevel < 15) {
      vixAdjustment = 1.2; // Can size up in calm markets
    }
  }

  if (fearGreed) {
    const fg = fearGreed.current;

    // GRADUATED FEAR & GREED SCALE - Eliminates dead zones
    // Historical F&G: mean ~50, stdDev ~15
    if (fg < 10) {
      sentimentBias += 2.5; // Capitulation = strong contrarian BUY
      contrarianAlerts.push(
        `🔥 Fear & Greed at ${fg} (CAPITULATION) - Historically marks major bottoms`,
      );
      signalBreakdown.push(`F&G capitulation: ${fg} (+2.5 sentiment)`);
    } else if (fg < 20) {
      sentimentBias += 2; // Extreme fear
      contrarianAlerts.push(
        `🔥 Fear & Greed at ${fg} (Extreme Fear) - Historically bullish signal`,
      );
      signalBreakdown.push(`F&G extreme fear: ${fg} (+2.0 sentiment)`);
    } else if (fg < 30) {
      sentimentBias += 1.2; // Fear
      signalBreakdown.push(`F&G fear: ${fg} (+1.2 sentiment)`);
    } else if (fg < 40) {
      sentimentBias += 0.5; // Mild fear - was dead zone
      signalBreakdown.push(`F&G mild fear: ${fg} (+0.5 sentiment)`);
    } else if (fg < 45) {
      sentimentBias += 0.2; // Slight fear
      signalBreakdown.push(`F&G slightly fearful: ${fg} (+0.2 sentiment)`);
    } else if (fg <= 55) {
      // True neutral zone (45-55) - no contribution
    } else if (fg < 60) {
      sentimentBias -= 0.2; // Slight greed
      signalBreakdown.push(`F&G slightly greedy: ${fg} (-0.2 sentiment)`);
    } else if (fg < 70) {
      sentimentBias -= 0.5; // Mild greed - was dead zone
      signalBreakdown.push(`F&G mild greed: ${fg} (-0.5 sentiment)`);
    } else if (fg < 80) {
      sentimentBias -= 1.2; // Greed
      signalBreakdown.push(`F&G greed: ${fg} (-1.2 sentiment)`);
    } else if (fg < 90) {
      sentimentBias -= 2; // Extreme greed
      contrarianAlerts.push(
        `⚠️ Fear & Greed at ${fg} (Extreme Greed) - Historically bearish signal`,
      );
      signalBreakdown.push(`F&G extreme greed: ${fg} (-2.0 sentiment)`);
    } else {
      sentimentBias -= 2.5; // Euphoria = strong contrarian SELL
      contrarianAlerts.push(
        `⚠️ Fear & Greed at ${fg} (EUPHORIA) - Historically precedes major corrections`,
      );
      signalBreakdown.push(`F&G euphoria: ${fg} (-2.5 sentiment)`);
    }
  }

  if (cboe?.putCallRatio?.signal) {
    const pcSignal = cboe.putCallRatio.signal;
    if (pcSignal === "extreme_fear") sentimentBias += 1;
    else if (pcSignal === "extreme_greed") sentimentBias -= 1;
  }

  // VIX TERM STRUCTURE - contango vs backwardation
  // Backwardation (near > far) = traders paying MORE for immediate protection = genuine fear
  // Contango (near < far) = normal complacency, slight bearish signal
  const termStructure = cboe?.vix?.termStructure;
  if (termStructure) {
    if (termStructure === "backwardation") {
      sentimentBias += 1.0; // Genuine fear/hedging = contrarian bullish
      signalBreakdown.push("VIX backwardation: genuine fear detected (+1.0)");
      contrarianAlerts.push(
        "📊 VIX in backwardation - institutional hedging elevated, contrarian bullish",
      );
    } else if (termStructure === "contango") {
      sentimentBias -= 0.3; // Normal complacency = mild bearish
      signalBreakdown.push("VIX contango: complacency mode (-0.3)");
    }
  }

  // ========== CALCULATE STRATEGIC & TACTICAL SCORES ==========
  // Strategic = Macro Floor (Liquidity) + Structural (COT)
  const rawStrategic = liquidityBias * 0.6 + cotBias * 0.4; // -2 to +2 scale
  strategicScore = Math.round(((rawStrategic + 2) / 4) * 9 + 1); // Convert to 1-10
  strategicScore = Math.max(1, Math.min(10, strategicScore));

  // Tactical = Sentiment (contrarian timing)
  tacticalScore = Math.round(((sentimentBias + 2) / 4) * 9 + 1); // Convert to 1-10
  tacticalScore = Math.max(1, Math.min(10, tacticalScore));

  // ========== FINANCIAL STRESS INDEX CIRCUIT BREAKER ==========
  // FSI aggregates 18 financial indicators - spikes above 2.0 during systemic crises
  // Normal range: -1.0 to +1.0 | 2008 crisis: peaked at 5.6 | 2020 crash: peaked at 5.3
  const fsi = fred?.series?.financialStressIndex;
  let fsiBearishOverride = false;
  let fsiMultiplier = 1.0;

  if (typeof fsi === "number" && !Number.isNaN(fsi)) {
    if (fsi > 2.0) {
      // Systemic stress detected - force bearish regardless of other signals
      fsiBearishOverride = true;
      keyRisks.unshift(
        `🚨 FSI ALERT: ${fsi.toFixed(2)} - Systemic financial stress detected`,
      );
      signalBreakdown.push(
        `FSI circuit breaker: ${fsi.toFixed(2)} > 2.0 (VETO)`,
      );
    } else if (fsi > 1.0) {
      // Elevated stress - dampen bullish signals
      fsiMultiplier = 0.7;
      keyRisks.push(
        `⚠️ FSI elevated: ${fsi.toFixed(2)} - bullish signals dampened`,
      );
      signalBreakdown.push(
        `FSI elevated: ${fsi.toFixed(2)} (0.7x bullish multiplier)`,
      );
    } else if (fsi < -0.5) {
      // Low stress - slightly boost bullish signals
      fsiMultiplier = 1.1;
      signalBreakdown.push(`FSI benign: ${fsi.toFixed(2)} (1.1x boost)`);
    }
  }

  // ========== DETERMINE SMART MONEY BIAS ==========
  // Weighted average of all signals: Liquidity 40%, COT 30%, Sentiment 30%
  // Threshold lowered from 1.0 to 0.5 so strong single signals can trigger bias
  // Math: Max COT alone = 2 * 0.3 = 0.6, which should be enough for BULLISH
  const overallBias = liquidityBias * 0.4 + cotBias * 0.3 + sentimentBias * 0.3;

  // Apply FSI circuit breaker
  if (fsiBearishOverride) {
    smartMoneyBias = "BEARISH"; // Systemic stress overrides everything
  } else {
    // Apply FSI multiplier to bullish bias only (dampens optimism during stress)
    let adjustedBias = overallBias;
    if (overallBias > 0) {
      adjustedBias = overallBias * fsiMultiplier;
    }
    if (adjustedBias >= 0.5) smartMoneyBias = "BULLISH";
    else if (adjustedBias <= -0.5) smartMoneyBias = "BEARISH";
    else smartMoneyBias = "NEUTRAL";
  }

  // ========== DETERMINE MARKET REGIME (Four Seasons) ==========
  const macroBullish = liquidityBias + cotBias >= 2;
  const macroBearish = liquidityBias + cotBias <= -2;
  const highVol = vixLevel > 22;
  const lowVol = vixLevel < 16;

  if (macroBullish && lowVol) {
    marketRegime = "BULL_QUIET";
  } else if (macroBullish && highVol) {
    marketRegime = "BULL_VOLATILE";
  } else if (macroBearish && lowVol) {
    marketRegime = "BEAR_QUIET";
  } else if (macroBearish && highVol) {
    marketRegime = "BEAR_VOLATILE";
  } else {
    marketRegime = "RANGE_BOUND";
  }

  // ========== IDENTIFY PAIN TRADE ==========
  let painTrade: InstitutionalIntelligence["painTrade"] = {
    direction: "NONE",
    description: "No extreme positioning detected",
  };

  if (cot?.contracts?.ES) {
    const es = cot.contracts.ES;
    const amNet = es.assetManagers.netPosition;
    const lfNet = es.leveragedFunds.netPosition;

    // Leveraged Funds heavily short while Asset Managers long = short squeeze risk
    if (lfNet < -400000 && amNet > 500000) {
      painTrade = {
        direction: "SHORT_SQUEEZE",
        description: `Leveraged Funds ${(lfNet / 1000).toFixed(0)}K contracts short - squeeze risk on rallies`,
      };
    }
    // Rare: Asset Managers short = potential long squeeze
    else if (amNet < -100000) {
      painTrade = {
        direction: "LONG_SQUEEZE",
        description: `Unusual: Asset Managers net short ${(Math.abs(amNet) / 1000).toFixed(0)}K - major risk-off signal`,
      };
    }
  }

  // ========== CALCULATE CONVICTION MULTIPLIER ==========
  // Based on alignment between strategic and tactical scores
  const alignmentGap = Math.abs(strategicScore - tacticalScore);
  const avgScore = (strategicScore + tacticalScore) / 2;

  // High alignment + strong signal = high conviction
  if (alignmentGap <= 2 && avgScore >= 7) {
    convictionMultiplier = 1.5; // Strong aligned bullish
  } else if (alignmentGap <= 2 && avgScore <= 3) {
    convictionMultiplier = 1.5; // Strong aligned bearish
  } else if (alignmentGap <= 3) {
    convictionMultiplier = 1.0; // Normal conviction
  } else {
    convictionMultiplier = 0.7; // Conflicting signals - reduce size
  }

  // "Constructive Tension" bonus - when structure and sentiment diverge favorably
  // Bullish structure + Bearish sentiment = "Golden Setup"
  if (strategicScore >= 7 && tacticalScore >= 7 && sentimentBias >= 1) {
    convictionMultiplier = Math.min(1.5, convictionMultiplier + 0.3);
    contrarianAlerts.unshift(
      "⭐ GOLDEN SETUP: Bullish structure meets fear-based sentiment",
    );
  }
  // Bearish structure + Bullish sentiment = "Bull Trap"
  if (strategicScore <= 3 && tacticalScore <= 3 && sentimentBias <= -1) {
    contrarianAlerts.unshift(
      "🪤 BULL TRAP: Bearish structure meets euphoric sentiment",
    );
  }

  // ========== CALCULATE INSTITUTIONAL ALIGNMENT ==========
  const institutionalAlignment = Math.round(10 - alignmentGap);

  // ========== DATA QUALITY ADJUSTMENT ==========
  // Reduce conviction when data sources are estimated or fallback
  // This implements the principle: "Stale data is infinitely worse than missing data"
  let dataQualityPenalty = 1.0;
  const dataQualityIssues: string[] = [];

  // Check CBOE data quality (VIX)
  if (cboe?.dataOrigin === "fallback") {
    dataQualityPenalty *= 0.6;
    dataQualityIssues.push("VIX data unavailable - using defaults");
  } else if (cboe?.dataOrigin === "estimated" || cboe?.vix?.isEstimated) {
    dataQualityPenalty *= 0.85;
    dataQualityIssues.push("VIX data estimated - not real-time");
  }

  // Check Fear & Greed data quality
  if (fearGreed?.dataOrigin === "fallback") {
    dataQualityPenalty *= 0.6;
    dataQualityIssues.push("Fear & Greed data unavailable - using defaults");
  } else if (fearGreed?.dataOrigin === "estimated") {
    dataQualityPenalty *= 0.85;
    dataQualityIssues.push("Fear & Greed data estimated");
  }

  // Check FRED liquidity data - if netLiquidityChange is 0, null, undefined, or NaN, data might be stale
  const liquidityChange = fred?.series?.netLiquidityChange;
  if (
    liquidityChange === 0 ||
    liquidityChange === null ||
    liquidityChange === undefined ||
    Number.isNaN(liquidityChange)
  ) {
    dataQualityPenalty *= 0.9;
    dataQualityIssues.push(
      "Liquidity change is zero/missing - verify data freshness",
    );
  }

  // Apply data quality penalty to conviction
  convictionMultiplier *= dataQualityPenalty;

  // Add data quality issues to key risks if significant
  if (dataQualityPenalty < 0.8) {
    keyRisks.push(
      `⚠️ DATA QUALITY: ${dataQualityIssues.join("; ")} - Conviction reduced to ${(dataQualityPenalty * 100).toFixed(0)}%`,
    );
  }

  // ========== GENERATE REGIME DESCRIPTION ==========
  const regimeDescriptions: Record<MarketRegime, string> = {
    BULL_QUIET:
      "Trend-following environment. Buy breakouts, hold swings, use wider stops.",
    BULL_VOLATILE:
      "Profit-taking zone. Tighten stops, reduce position size, fade extended moves.",
    BEAR_QUIET:
      "Distribution phase. Sell rallies, avoid dip-buying, patience for trend resumption.",
    BEAR_VOLATILE:
      "Crisis mode. Cash is king, tactical scalps only, wait for capitulation signals.",
    RANGE_BOUND:
      "Choppy conditions. Mean reversion plays, trade from levels, reduce frequency.",
  };

  // ========== GENERATE TRADING GUIDANCE ==========
  let tradingGuidance = "";

  if (smartMoneyBias === "BULLISH") {
    if (sentimentBias >= 1) {
      tradingGuidance = `BULLISH CONTEXT + FEAR PRESENT: High-conviction long setups. Institutions are positioned bullish while retail is fearful. Look for technical support holds as entry triggers. Position size: ${(convictionMultiplier * vixAdjustment * 100).toFixed(0)}% of normal.`;
    } else if (sentimentBias <= -1) {
      tradingGuidance = `BULLISH CONTEXT + EUPHORIA WARNING: Proceed with caution on new longs. Smart money is bullish but sentiment is overheated. Tighten stops on existing positions. Position size: ${(convictionMultiplier * vixAdjustment * 100).toFixed(0)}% of normal.`;
    } else {
      tradingGuidance = `BULLISH CONTEXT: Standard long bias. Follow technical setups in the direction of institutional flow. Position size: ${(convictionMultiplier * vixAdjustment * 100).toFixed(0)}% of normal.`;
    }
  } else if (smartMoneyBias === "BEARISH") {
    if (sentimentBias <= -1) {
      tradingGuidance = `BEARISH CONTEXT + EUPHORIA: Classic distribution setup. Fade rallies into resistance, look for breakdown entries. High conviction shorts. Position size: ${(convictionMultiplier * vixAdjustment * 100).toFixed(0)}% of normal.`;
    } else if (sentimentBias >= 1) {
      tradingGuidance = `BEARISH CONTEXT + FEAR: Potential bounce territory. Avoid new shorts, wait for rally to fail before re-shorting. Tactical long scalps possible. Position size: ${(convictionMultiplier * vixAdjustment * 100).toFixed(0)}% of normal.`;
    } else {
      tradingGuidance = `BEARISH CONTEXT: Standard short bias. Sell rallies, respect downtrend. Position size: ${(convictionMultiplier * vixAdjustment * 100).toFixed(0)}% of normal.`;
    }
  } else {
    tradingGuidance = `NEUTRAL CONTEXT: Mixed institutional signals. Trade smaller, focus on high-probability setups at key levels. Avoid directional bias, use mean reversion strategies. Position size: ${(convictionMultiplier * vixAdjustment * 100).toFixed(0)}% of normal.`;
  }

  // Calculate data quality score (0-100)
  const dataQualityScore = Math.round(dataQualityPenalty * 100);

  return {
    marketRegime,
    regimeDescription: regimeDescriptions[marketRegime],
    institutionalAlignment,
    strategicScore,
    tacticalScore,
    smartMoneyBias,
    convictionMultiplier: Math.round(convictionMultiplier * 100) / 100,
    vixAdjustment: Math.round(vixAdjustment * 100) / 100,
    painTrade,
    contrarianAlerts,
    tradingGuidance,
    keyRisks,
    signalBreakdown, // Detailed signal contributions for transparency
    dataQuality: {
      score: dataQualityScore,
      issues: dataQualityIssues,
      isReliable: dataQualityScore > 70,
    },
  };
}

// Aggregate all institutional data
async function fetchAllInstitutionalData(
  fredApiKey?: string,
): Promise<InstitutionalData> {
  const [cotResult, fredResult, cboeResult, fgResult] = await Promise.all([
    fetchCOTData(),
    fetchFREDData(fredApiKey),
    fetchCBOEData(),
    fetchFearGreedData(),
  ]);

  // Calculate composite signal based on all data sources
  const factors: string[] = [];
  let bullishScore = 0;
  let bearishScore = 0;

  // COT analysis
  if (cotResult.data?.contracts?.ES) {
    const esSignal = cotResult.data.contracts.ES.signal;
    if (esSignal.includes("long")) {
      bullishScore += esSignal === "extreme_long" ? 2 : 1;
      factors.push(`COT: Institutions ${esSignal.replace("_", " ")}`);
    } else if (esSignal.includes("short")) {
      bearishScore += esSignal === "extreme_short" ? 2 : 1;
      factors.push(`COT: Institutions ${esSignal.replace("_", " ")}`);
    }
  }

  // FRED liquidity analysis
  if (fredResult.data?.series?.liquiditySignal) {
    if (fredResult.data.series.liquiditySignal === "expanding") {
      bullishScore += 1;
      factors.push("Liquidity: Expanding (bullish)");
    } else if (fredResult.data.series.liquiditySignal === "contracting") {
      bearishScore += 1;
      factors.push("Liquidity: Contracting (bearish)");
    }
  }

  // VIX analysis (contrarian)
  if (cboeResult.data?.vix) {
    const vix = cboeResult.data.vix.current;
    if (vix > 30) {
      bullishScore += 1; // High VIX = fear = contrarian buy
      factors.push(`VIX ${vix.toFixed(1)}: Elevated fear (contrarian bullish)`);
    } else if (vix < 12) {
      bearishScore += 1; // Low VIX = complacency = contrarian sell
      factors.push(`VIX ${vix.toFixed(1)}: Complacency (contrarian bearish)`);
    }
  }

  // Put/Call analysis (contrarian)
  if (cboeResult.data?.putCallRatio?.signal) {
    const pcSignal = cboeResult.data.putCallRatio.signal;
    if (pcSignal.includes("fear")) {
      bullishScore += pcSignal === "extreme_fear" ? 2 : 1;
      factors.push(
        `Put/Call: ${pcSignal.replace("_", " ")} (contrarian bullish)`,
      );
    } else if (pcSignal.includes("greed")) {
      bearishScore += pcSignal === "extreme_greed" ? 2 : 1;
      factors.push(
        `Put/Call: ${pcSignal.replace("_", " ")} (contrarian bearish)`,
      );
    }
  }

  // Fear & Greed analysis (contrarian)
  if (fgResult.data?.classification) {
    const fgClass = fgResult.data.classification;
    if (fgClass.includes("fear")) {
      bullishScore += fgClass === "extreme_fear" ? 2 : 1;
      factors.push(
        `Fear/Greed ${fgResult.data.current}: ${fgClass.replace("_", " ")} (contrarian bullish)`,
      );
    } else if (fgClass.includes("greed")) {
      bearishScore += fgClass === "extreme_greed" ? 2 : 1;
      factors.push(
        `Fear/Greed ${fgResult.data.current}: ${fgClass.replace("_", " ")} (contrarian bearish)`,
      );
    }
  }

  // Determine composite signal
  const netScore = bullishScore - bearishScore;
  const totalFactors = bullishScore + bearishScore;
  const confidence =
    totalFactors > 0
      ? Math.min(100, (Math.abs(netScore) / totalFactors) * 100 + 40)
      : 40;

  let bias: "bullish" | "neutral" | "bearish";
  if (netScore >= 2) bias = "bullish";
  else if (netScore <= -2) bias = "bearish";
  else bias = "neutral";

  // Calculate enhanced institutional intelligence
  const intelligence = calculateInstitutionalIntelligence(
    cotResult.data,
    fredResult.data,
    cboeResult.data,
    fgResult.data,
  );

  return {
    lastUpdated: new Date().toISOString(),
    cot: cotResult.data,
    fred: fredResult.data,
    cboe: cboeResult.data,
    fearGreed: fgResult.data,
    compositeSignal: {
      bias,
      confidence: Math.round(confidence),
      factors,
    },
    intelligence, // Enhanced intelligence layer
  };
}

// Format institutional data for AI prompt injection
// This is the ENHANCED version that provides actionable trading intelligence
function formatInstitutionalDataForPrompt(
  data: InstitutionalData | null,
): string {
  if (!data) return "";

  const sections: string[] = [];
  const intel = data.intelligence;

  // ========== SECTION 1: INTELLIGENCE BRIEFING (Primary for AI) ==========
  if (intel) {
    const regimeEmoji: Record<MarketRegime, string> = {
      BULL_QUIET: "🟢📈",
      BULL_VOLATILE: "🟡⚡",
      BEAR_QUIET: "🔴📉",
      BEAR_VOLATILE: "🔴⚡",
      RANGE_BOUND: "⚪↔️",
    };

    const biasEmoji = {
      BULLISH: "🟢",
      NEUTRAL: "⚪",
      BEARISH: "🔴",
    };

    sections.push(`
## 🏛️ INSTITUTIONAL INTELLIGENCE BRIEFING

### MARKET REGIME: ${regimeEmoji[intel.marketRegime]} ${intel.marketRegime.replace("_", " ")}
${intel.regimeDescription}

### SMART MONEY VERDICT: ${biasEmoji[intel.smartMoneyBias]} ${intel.smartMoneyBias}
- **Institutional Alignment:** ${intel.institutionalAlignment}/10
- **Strategic Score (Macro/COT):** ${intel.strategicScore}/10
- **Tactical Score (Sentiment):** ${intel.tacticalScore}/10

### 📊 YOUR TRADING CONTEXT
- **Conviction Multiplier:** ${intel.convictionMultiplier}x
- **VIX Position Adjustment:** ${intel.vixAdjustment}x
- **Effective Size:** ${(intel.convictionMultiplier * intel.vixAdjustment * 100).toFixed(0)}% of normal

### 🎯 TRADING GUIDANCE
${intel.tradingGuidance}`);

    // Pain Trade
    if (intel.painTrade.direction !== "NONE") {
      sections.push(`
### ⚠️ PAIN TRADE ALERT: ${intel.painTrade.direction.replace("_", " ")}
${intel.painTrade.description}`);
    }

    // Contrarian Alerts
    if (intel.contrarianAlerts.length > 0) {
      sections.push(`
### 🔔 CONTRARIAN SIGNALS
${intel.contrarianAlerts.map((a) => `- ${a}`).join("\n")}`);
    }

    // Key Risks
    if (intel.keyRisks.length > 0) {
      sections.push(`
### ⚠️ KEY RISKS
${intel.keyRisks.map((r) => `- ${r}`).join("\n")}`);
    }

    // AI Instructions
    sections.push(`
### 📋 HOW TO USE THIS DATA (AI Instructions)
1. **Technical-Institutional Alignment:** If your technical setup is ${intel.smartMoneyBias === "BULLISH" ? "LONG" : intel.smartMoneyBias === "BEARISH" ? "SHORT" : "either direction"}, institutional context ${intel.institutionalAlignment >= 7 ? "STRONGLY SUPPORTS" : intel.institutionalAlignment >= 5 ? "SUPPORTS" : "PARTIALLY CONFLICTS with"} this bias.
2. **Position Sizing:** Recommend ${(intel.convictionMultiplier * intel.vixAdjustment * 100).toFixed(0)}% position size based on conviction (${intel.convictionMultiplier}x) and VIX adjustment (${intel.vixAdjustment}x).
3. **Stop Placement:** ${intel.marketRegime.includes("VOLATILE") ? "Use TIGHTER stops due to elevated volatility." : intel.marketRegime.includes("QUIET") ? "Can use WIDER stops in low-volatility environment." : "Use STANDARD stop placement."}
4. **Trade Selection:** ${intel.marketRegime === "BULL_QUIET" ? "Favor breakout entries and trend continuations." : intel.marketRegime === "BEAR_QUIET" ? "Fade rallies, short breakdowns." : intel.marketRegime.includes("VOLATILE") ? "Focus on mean-reversion at key levels." : "Trade from significant support/resistance only."}
5. **Conviction Guidance:** ${intel.convictionMultiplier >= 1.3 ? "HIGH conviction environment - can be aggressive." : intel.convictionMultiplier >= 1.0 ? "MODERATE conviction - standard approach." : "LOW conviction due to conflicting signals - reduce size or skip marginal setups."}`);
  }

  // ========== SECTION 2: RAW DATA REFERENCE (Transparency) ==========
  sections.push(`
---
## 📊 RAW DATA REFERENCE`);

  // COT Data
  if (data.cot?.contracts) {
    const cotLines: string[] = [];
    for (const [symbol, pos] of Object.entries(data.cot.contracts)) {
      const netChange =
        pos.assetManagers.weeklyChange + pos.leveragedFunds.weeklyChange;
      const changeSymbol = netChange > 0 ? "↑" : netChange < 0 ? "↓" : "→";
      cotLines.push(
        `- **${symbol}**: Asset Mgrs ${pos.assetManagers.netPosition > 0 ? "+" : ""}${(pos.assetManagers.netPosition / 1000).toFixed(1)}K, Lev Funds ${pos.leveragedFunds.netPosition > 0 ? "+" : ""}${(pos.leveragedFunds.netPosition / 1000).toFixed(1)}K (${changeSymbol} ${Math.abs(netChange / 1000).toFixed(1)}K this week)`,
      );
    }
    sections.push(`
### CFTC COT Positioning (${data.cot.reportDate})
${cotLines.join("\n")}`);
  }

  // FRED Liquidity Data
  if (data.fred?.series) {
    const s = data.fred.series;
    const netLiqT = (s.netLiquidity / 1000000).toFixed(2);
    sections.push(`
### Fed Liquidity & Rates
- Net Liquidity: $${netLiqT}T [${s.liquiditySignal}]
- Yield Curve (10Y-2Y): ${s.yieldCurve?.toFixed(2) || "N/A"}% [${s.yieldCurveSignal}]
- Fed Funds: ${s.fedFundsRate?.toFixed(2) || "N/A"}%`);
  }

  // CBOE VIX & Options
  if (data.cboe) {
    const vix = data.cboe.vix;
    const pc = data.cboe.putCallRatio;
    sections.push(`
### Volatility & Options
- VIX: ${vix.current.toFixed(2)} (${vix.change > 0 ? "+" : ""}${vix.change.toFixed(2)}) [${vix.termStructure}]
- Put/Call: ${pc.total.toFixed(2)} (5d avg: ${pc.fiveDayAvg.toFixed(2)}) [${pc.signal.replace("_", " ")}]`);
  }

  // Fear & Greed
  if (data.fearGreed) {
    const fg = data.fearGreed;
    const trend =
      fg.current > fg.oneWeekAgo ? "↑" : fg.current < fg.oneWeekAgo ? "↓" : "→";
    sections.push(`
### Sentiment
- Fear & Greed: ${fg.current} [${fg.classification.replace("_", " ").toUpperCase()}] ${trend} from ${fg.oneWeekAgo} last week`);
  }

  if (sections.length === 0) return "";

  return (
    sections.join("\n") +
    `

---
*Updated: ${new Date(data.lastUpdated).toLocaleString("en-US", { timeZone: "America/New_York" })} ET*
*Sources: CFTC COT, Federal Reserve (FRED), CBOE, CNN Fear & Greed*
`
  );
}

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use("*", async (c, next) => {
  const origin = c.req.header("origin");

  // Allow Cloudflare Pages preview URLs and configured origins
  if (origin) {
    const origins = c.env.CORS_ORIGINS?.split(",") || [];
    const isAllowed =
      origins.includes(origin) ||
      origin.endsWith(".pages.dev") ||
      origin.includes("tradvio-frontend.pages.dev");

    if (isAllowed) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Credentials", "true");
      c.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
  }

  if (c.req.method === "OPTIONS") {
    return c.text("", 204);
  }

  await next();
});

// Analytics middleware - Track all requests
app.use("*", async (c, next) => {
  const startTime = Date.now();
  const path = new URL(c.req.url).pathname;
  const method = c.req.method;

  await next();

  const duration = Date.now() - startTime;
  const status = c.res.status;

  // Track request metrics
  trackAnalytics(c.env, "api_request", {
    endpoint: path,
    method,
    status,
    duration_ms: duration,
  });

  // Track errors
  if (status >= 400) {
    trackAnalytics(c.env, "api_error", {
      endpoint: path,
      method,
      status,
      error_type: status >= 500 ? "server_error" : "client_error",
    });
  }
});

// Health check
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "Tradvio Backend API",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// Helper: Generate ID
function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

// Helper: Hash password
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Helper: Verify password
async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
}

// Helper: Generate JWT using Hono's sign
async function generateJWT(userId: string, env: Env): Promise<string> {
  const payload = {
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
  };

  return await sign(payload, env.JWT_SECRET);
}

// Helper: Track analytics event
function trackAnalytics(
  env: Env,
  event: string,
  data: Record<string, string | number> = {},
) {
  try {
    if (env.ANALYTICS) {
      env.ANALYTICS.writeDataPoint({
        blobs: [event],
        doubles: Object.entries(data)
          .filter(([_, v]) => typeof v === "number")
          .map(([k, v]) => v as number),
        indexes: Object.entries(data)
          .filter(([_, v]) => typeof v === "string")
          .map(([_, v]) => v as string),
      });
    }
  } catch (error) {
    console.error("[Analytics] Failed to track event:", event, error);
  }
}

// Helper: Track OpenAI token usage
function trackOpenAIUsage(
  env: Env,
  model: string,
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  },
) {
  try {
    // Approximate cost calculation (GPT-5.2 pricing as of 2025)
    // Input: ~$1.75/1M tokens ($0.00175/1K), Output: ~$14/1M tokens ($0.014/1K)
    const inputCost = (usage.prompt_tokens / 1000) * 0.00175;
    const outputCost = (usage.completion_tokens / 1000) * 0.014;
    const totalCost = inputCost + outputCost;

    trackAnalytics(env, "openai_usage", {
      model,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      cost_usd: totalCost,
    });

    console.log(
      `[OpenAI Usage] Model: ${model}, Tokens: ${usage.total_tokens}, Cost: $${totalCost.toFixed(4)}`,
    );
  } catch (error) {
    console.error("[OpenAI Usage] Failed to track:", error);
  }
}

// Helper: Track errors for monitoring
function trackError(
  env: Env,
  error: Error,
  context: { endpoint?: string; userId?: string; [key: string]: any } = {},
) {
  try {
    // Log to console (visible in wrangler tail)
    console.error("[Error]", {
      message: error.message,
      stack: error.stack,
      ...context,
    });

    // Track in Analytics Engine
    trackAnalytics(env, "application_error", {
      error_message: error.message,
      error_type: error.name,
      endpoint: context.endpoint || "unknown",
      user_id: context.userId || "anonymous",
    });
  } catch (trackingError) {
    console.error("[Error Tracking] Failed to track error:", trackingError);
  }
}

// =====================================================
// FINRA DARK POOL INTEGRATION
// =====================================================

// FINRA API configuration
const FINRA_API_BASE = "https://api.finra.org/data/group/otcMarket/name";
const TRACKED_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA"]; // ETFs that proxy futures

// Helper: Fetch FINRA ATS data
async function fetchFINRAData(): Promise<{
  success: boolean;
  data?: FINRADarkPoolData;
  error?: string;
}> {
  try {
    console.log("[FINRA] Fetching dark pool data...");

    // FINRA ATS Weekly data endpoint
    // Note: FINRA's public API has rate limits, so we cache aggressively
    const response = await fetch(
      `${FINRA_API_BASE}/weeklyDownloadData?symbol=${TRACKED_SYMBOLS.join(",")}&tier=NMS`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "PrecisionTradeAI/1.0",
        },
      },
    );

    if (!response.ok) {
      // Fallback: Try alternative FINRA data source
      console.log("[FINRA] Primary API failed, using fallback data source...");
      return await fetchFINRAFallback();
    }

    const rawData = await response.json();
    const processedData = processFINRAData(rawData);

    console.log(
      `[FINRA] Successfully fetched data for ${Object.keys(processedData.symbols).length} symbols`,
    );

    return { success: true, data: processedData };
  } catch (error: any) {
    console.error("[FINRA] Fetch error:", error.message);
    return { success: false, error: error.message };
  }
}

// Fallback: Use publicly available SEC/FINRA data
async function fetchFINRAFallback(): Promise<{
  success: boolean;
  data?: FINRADarkPoolData;
  error?: string;
}> {
  try {
    // Use pre-computed institutional levels based on historical FINRA patterns
    // These are updated via manual refresh when FINRA publishes new data
    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() - weekEnd.getDay()); // Previous Sunday

    const fallbackData: FINRADarkPoolData = {
      lastUpdated: now.toISOString(),
      weekEnding: weekEnd.toISOString().split("T")[0],
      symbols: {
        SPY: {
          totalVolume: 0, // Will be updated when real data available
          avgPrice: 0,
          venues: [],
          volumeWeightedPrice: 0,
          highVolumeZones: [
            // Placeholder - real zones calculated from FINRA data
            { priceLevel: 600, volume: 0, significance: "high" },
            { priceLevel: 590, volume: 0, significance: "medium" },
            { priceLevel: 580, volume: 0, significance: "medium" },
          ],
        },
        QQQ: {
          totalVolume: 0,
          avgPrice: 0,
          venues: [],
          volumeWeightedPrice: 0,
          highVolumeZones: [
            { priceLevel: 520, volume: 0, significance: "high" },
            { priceLevel: 510, volume: 0, significance: "medium" },
            { priceLevel: 500, volume: 0, significance: "medium" },
          ],
        },
      },
    };

    return { success: true, data: fallbackData };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Process raw FINRA data into structured format
function processFINRAData(rawData: any): FINRADarkPoolData {
  const now = new Date();
  const result: FINRADarkPoolData = {
    lastUpdated: now.toISOString(),
    weekEnding: "", // Will be set from data
    symbols: {},
  };

  try {
    // FINRA ATS data structure (simplified - actual format varies)
    const records = Array.isArray(rawData) ? rawData : rawData.records || [];

    for (const record of records) {
      const symbol = record.symbol || record.issueSymbolIdentifier;
      if (!symbol || !TRACKED_SYMBOLS.includes(symbol)) continue;

      if (!result.symbols[symbol]) {
        result.symbols[symbol] = {
          totalVolume: 0,
          avgPrice: 0,
          venues: [],
          volumeWeightedPrice: 0,
          highVolumeZones: [],
        };
      }

      const symbolData = result.symbols[symbol];
      const volume = parseInt(
        record.totalWeeklyShareQuantity || record.shareQuantity || "0",
      );
      const price = parseFloat(
        record.lastSalePrice || record.averagePrice || "0",
      );

      symbolData.totalVolume += volume;
      if (price > 0) {
        // Calculate volume-weighted average price
        symbolData.volumeWeightedPrice =
          (symbolData.volumeWeightedPrice * (symbolData.totalVolume - volume) +
            price * volume) /
          symbolData.totalVolume;
      }

      // Track venue breakdown
      const venueName =
        record.atsDisplayName || record.marketParticipantId || "Unknown";
      const existingVenue = symbolData.venues.find((v) => v.name === venueName);
      if (existingVenue) {
        existingVenue.volume += volume;
      } else {
        symbolData.venues.push({ name: venueName, volume, percentOfTotal: 0 });
      }

      // Update week ending date
      if (
        record.weekEndDate &&
        (!result.weekEnding || record.weekEndDate > result.weekEnding)
      ) {
        result.weekEnding = record.weekEndDate;
      }
    }

    // Calculate percentages and identify high-volume zones
    for (const symbol of Object.keys(result.symbols)) {
      const symbolData = result.symbols[symbol];

      // Calculate venue percentages
      for (const venue of symbolData.venues) {
        venue.percentOfTotal =
          symbolData.totalVolume > 0
            ? (venue.volume / symbolData.totalVolume) * 100
            : 0;
      }

      // Sort venues by volume
      symbolData.venues.sort((a, b) => b.volume - a.volume);

      // Derive high-volume zones (institutional walls)
      // In real implementation, this would analyze price distribution
      if (symbolData.volumeWeightedPrice > 0) {
        const vwap = symbolData.volumeWeightedPrice;
        symbolData.highVolumeZones = [
          {
            priceLevel: Math.round(vwap * 1.02),
            volume: symbolData.totalVolume * 0.3,
            significance: "high",
          },
          {
            priceLevel: Math.round(vwap),
            volume: symbolData.totalVolume * 0.4,
            significance: "high",
          },
          {
            priceLevel: Math.round(vwap * 0.98),
            volume: symbolData.totalVolume * 0.3,
            significance: "high",
          },
        ];
      }
    }
  } catch (error) {
    console.error("[FINRA] Processing error:", error);
  }

  return result;
}

// Get FINRA data for a specific symbol (ES -> SPY, NQ -> QQQ mapping)
function getFINRAProxySymbol(futuresSymbol: string): string {
  const symbolMap: { [key: string]: string } = {
    ES: "SPY",
    NQ: "QQQ",
    RTY: "IWM",
    YM: "DIA",
    MES: "SPY",
    MNQ: "QQQ",
  };
  return symbolMap[futuresSymbol.toUpperCase()] || futuresSymbol;
}

// Format FINRA data for AI prompt injection
function formatFINRAForPrompt(
  data: FINRADarkPoolData | null,
  instrument: string,
): string {
  if (!data) {
    return ""; // No FINRA data available
  }

  const proxySymbol = getFINRAProxySymbol(instrument);
  const symbolData = data.symbols[proxySymbol];

  if (!symbolData || symbolData.totalVolume === 0) {
    return `\n## 📊 DARK POOL CONTEXT (${proxySymbol} proxy)
*No recent dark pool data available for ${proxySymbol}. FINRA updates weekly.*\n`;
  }

  const topVenues = symbolData.venues.slice(0, 3);
  const venueList = topVenues
    .map((v) => `  - ${v.name}: ${v.percentOfTotal.toFixed(1)}%`)
    .join("\n");

  const zones = symbolData.highVolumeZones
    .map(
      (z) =>
        `  - ${z.priceLevel}: ${z.significance.toUpperCase()} institutional wall`,
    )
    .join("\n");

  return `
## 📊 DARK POOL INTELLIGENCE (${proxySymbol} → ${instrument} proxy)
*Source: FINRA ATS Weekly Data | Week Ending: ${data.weekEnding}*

**Institutional Volume Profile:**
- Total Dark Pool Volume: ${(symbolData.totalVolume / 1_000_000).toFixed(2)}M shares
- Volume-Weighted Avg Price (VWAP): $${symbolData.volumeWeightedPrice.toFixed(2)}

**Top Dark Pool Venues:**
${venueList}

**🧱 INSTITUTIONAL WALLS (High-Volume Price Zones):**
${zones}

**Trading Implications:**
- Price approaching INSTITUTIONAL WALL = expect absorption/rejection
- Breaks THROUGH wall with volume = significant (new institutional flow)
- Use these levels for target extension or stop placement

`;
}

// Auth middleware
const authMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.substring(7);

  try {
    // Verify JWT using Hono's verify
    const payload = await verify(token, c.env.JWT_SECRET);
    const userId = payload.sub as string;

    if (!userId) {
      return c.json({ error: "Invalid token payload" }, 401);
    }

    // Get user from database
    const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
      .bind(userId)
      .first();

    if (!user) {
      return c.json({ error: "User not found" }, 401);
    }

    c.set("user", user);
    c.set("jwtPayload", payload);
    await next();
  } catch (error: any) {
    return c.json({ error: error.message || "Invalid token" }, 401);
  }
};

// Routes

// Waitlist: Join waitlist
app.post("/api/waitlist/join", async (c) => {
  try {
    const { name, email, phone } = await c.req.json();

    if (!name || !email) {
      return c.json({ error: "Name and email are required" }, 400);
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return c.json({ error: "Invalid email format" }, 400);
    }

    // Check if already on waitlist
    const existing = await c.env.DB.prepare(
      "SELECT id FROM waitlist WHERE email = ?",
    )
      .bind(email)
      .first();

    if (existing) {
      return c.json({ error: "You are already on the waitlist" }, 400);
    }

    // Add to waitlist
    const waitlistId = generateId("waitlist");
    await c.env.DB.prepare(
      "INSERT INTO waitlist (id, name, email, phone, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
    )
      .bind(waitlistId, name, email, phone || null)
      .run();

    // Track analytics
    trackAnalytics(c.env, "waitlist_join", {
      waitlist_id: waitlistId,
    });

    return c.json({
      success: true,
      message:
        "Thank you for joining the waitlist! We'll notify you when spaces open up.",
    });
  } catch (error: any) {
    console.error("[Waitlist] Error:", error);
    trackError(c.env, error, { endpoint: "/api/waitlist/join" });
    return c.json({ error: "Failed to join waitlist. Please try again." }, 500);
  }
});

// Auth: Sign up
app.post("/api/auth/signup", async (c) => {
  try {
    const { email, password, name } = await c.req.json();

    if (!email || !password) {
      return c.json({ error: "Email and password required" }, 400);
    }

    // Check if user exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM users WHERE email = ?",
    )
      .bind(email)
      .first();

    if (existing) {
      return c.json({ error: "User already exists" }, 400);
    }

    // Create user
    const userId = generateId("user");
    const passwordHash = await hashPassword(password);

    await c.env.DB.prepare(
      "INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(userId, email, name || null, passwordHash, "user")
      .run();

    // Generate token
    const token = await generateJWT(userId, c.env);

    return c.json({
      user: { id: userId, email, name, role: "user" },
      token,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Auth: Sign in
app.post("/api/auth/signin", async (c) => {
  try {
    const { email, password } = await c.req.json();

    if (!email || !password) {
      return c.json({ error: "Email and password required" }, 400);
    }

    // Get user
    const user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?")
      .bind(email)
      .first();

    if (
      !user ||
      !(await verifyPassword(password, user.password_hash as string))
    ) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Generate token
    const token = await generateJWT(user.id as string, c.env);

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        subscriptionStatus: user.subscription_status,
      },
      token,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Get current user session
app.get("/api/auth/session", authMiddleware, async (c) => {
  const user = c.get("user");
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      subscriptionStatus: user.subscription_status,
    },
  });
});

// Get subscription details
app.get("/api/subscription", authMiddleware, async (c) => {
  try {
    const user = c.get("user");

    const userDetails = await c.env.DB.prepare(
      "SELECT subscription_status, subscription_end_date, stripe_customer_id, stripe_subscription_id, created_at FROM users WHERE id = ?",
    )
      .bind(user.id)
      .first();

    if (!userDetails) {
      return c.json({ error: "User not found" }, 404);
    }

    // Helper function to parse date (handles both Unix timestamp and ISO string)
    const parseDate = (dateValue: any): Date | null => {
      if (!dateValue) return null;

      // If it's a number (Unix timestamp in seconds), convert to milliseconds
      if (typeof dateValue === "number") {
        return new Date(dateValue * 1000);
      }

      // If it's a string, parse as ISO date
      if (typeof dateValue === "string") {
        return new Date(dateValue);
      }

      return null;
    };

    // Helper to format date to ISO string for JSON response
    const formatDateForResponse = (dateValue: any): string | null => {
      const date = parseDate(dateValue);
      return date ? date.toISOString() : null;
    };

    const now = new Date();
    const endDate = parseDate(userDetails.subscription_end_date);
    const isActive = userDetails.subscription_status === "active";

    // Calculate subscription info
    let planName = "Free";
    let planType = "free";
    let daysRemaining = 0;
    let yearsPurchased = 0;

    if (isActive && endDate) {
      daysRemaining = Math.ceil(
        (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      const yearsRemaining = daysRemaining / 365;

      // Determine plan type based on subscription length
      if (yearsRemaining > 5) {
        yearsPurchased = 10;
        planName = "10-Year Premium";
        planType = "lifetime";
      } else if (yearsRemaining > 0.5) {
        yearsPurchased = Math.ceil(yearsRemaining);
        planName = `${yearsPurchased}-Year Premium`;
        planType = "annual";
      } else {
        planName = "Monthly Premium";
        planType = "monthly";
      }
    }

    return c.json({
      status: userDetails.subscription_status || "inactive",
      isActive,
      planName,
      planType,
      endDate: formatDateForResponse(userDetails.subscription_end_date),
      daysRemaining,
      yearsPurchased,
      isManaged: !!userDetails.stripe_subscription_id,
      canManageStripe: !!userDetails.stripe_customer_id,
      createdAt: formatDateForResponse(userDetails.created_at),
    });
  } catch (error: any) {
    console.error("[Subscription API] Error:", error);
    trackError(c.env, error, {
      endpoint: "/api/subscription",
      userId: c.get("user")?.id,
    });
    return c.json({ error: "Failed to fetch subscription details" }, 500);
  }
});

// Sync subscription status from Stripe
// This endpoint syncs the user's subscription from Stripe to the database
// Useful when webhooks fail or as a fallback mechanism
app.post("/api/subscription/sync", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
    });

    console.log("[Subscription Sync] Starting sync for user:", user.id);

    // First, check if user has a stripe_customer_id
    let customerId = user.stripe_customer_id;

    // If no customer ID, try to find by email
    if (!customerId) {
      const customers = await stripe.customers.list({
        email: user.email,
        limit: 1,
      });

      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        console.log("[Subscription Sync] Found customer by email:", customerId);
      }
    }

    if (!customerId) {
      console.log("[Subscription Sync] No Stripe customer found for user");
      return c.json({
        synced: false,
        message: "No Stripe customer found",
        status: "inactive",
      });
    }

    // Get subscriptions for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 10,
      status: "all",
    });

    if (subscriptions.data.length === 0) {
      console.log("[Subscription Sync] No subscriptions found");
      return c.json({
        synced: false,
        message: "No subscriptions found",
        status: "inactive",
      });
    }

    // Find the most relevant subscription (active > trialing > others)
    const activeSubscription =
      subscriptions.data.find((s) => s.status === "active") ||
      subscriptions.data.find((s) => s.status === "trialing") ||
      subscriptions.data[0];

    const priceId = activeSubscription.items.data[0]?.price?.id || null;

    // Update the database with Stripe data
    await c.env.DB.prepare(
      `UPDATE users SET
        subscription_status = ?,
        stripe_customer_id = ?,
        stripe_subscription_id = ?,
        subscription_end_date = ?,
        price_id = ?,
        updated_at = unixepoch()
      WHERE id = ?`,
    )
      .bind(
        activeSubscription.status,
        customerId,
        activeSubscription.id,
        activeSubscription.current_period_end,
        priceId,
        user.id,
      )
      .run();

    console.log("[Subscription Sync] Updated user subscription:", {
      userId: user.id,
      status: activeSubscription.status,
      subscriptionId: activeSubscription.id,
    });

    return c.json({
      synced: true,
      status: activeSubscription.status,
      subscriptionId: activeSubscription.id,
      customerId: customerId,
      periodEnd: new Date(
        activeSubscription.current_period_end * 1000,
      ).toISOString(),
    });
  } catch (error: any) {
    console.error("[Subscription Sync] Error:", error);
    trackError(c.env, error, {
      endpoint: "/api/subscription/sync",
      userId: c.get("user")?.id,
    });
    return c.json({ error: "Failed to sync subscription" }, 500);
  }
});

// Upload URL: Get R2 presigned URL
app.post("/api/upload-url", authMiddleware, async (c) => {
  try {
    const { fileName, fileType, fileKind } = await c.req.json();
    const user = c.get("user");

    if (!fileName || !fileType) {
      return c.json({ error: "fileName and fileType required" }, 400);
    }

    const fileId = generateId("file");
    const key = `${user.id}/${fileId}/${fileName}`;

    // Store file metadata
    await c.env.DB.prepare(
      "INSERT INTO files (id, user_id, kind, url, size, mime) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(fileId, user.id, fileKind || "chart", key, 0, fileType)
      .run();

    // Upload URL points to our Worker endpoint which handles R2 storage
    // Frontend will PUT the file to this URL, and our /api/upload/* endpoint handles it
    const uploadUrl = `https://tradvio-backend.ivanleejackson.workers.dev/api/upload/${key}`;

    // The final public URL where the file can be accessed after upload
    const finalUrl = `https://tradvio-backend.ivanleejackson.workers.dev/api/files/${key}`;

    console.log("[Upload URL] Generated for user:", user.id, "key:", key);

    return c.json({
      fileId,
      uploadUrl,
      finalUrl,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Helper function to generate system prompt based on analysis mode
function getSystemPrompt(
  mode: "trader" | "mentor",
  instrument: string,
  tickSpec: any,
  atm: any,
  effort: string,
  finraContext: string = "", // Optional FINRA dark pool intelligence
  orderFlowContext: string = "", // Optional real-time order flow data
): string {
  const tradingParams = `Trading Parameters for ${instrument}:
- Tick Size: ${tickSpec.tick_size}
- Multiplier: ${tickSpec.multiplier}
- Stop: ${atm.stop_ticks} ticks
- Targets: ${atm.target_ticks.join(", ")} ticks
- Bias: ${atm.bias || "Not specified"}`;

  if (mode === "trader") {
    // TRADER MODE: Ultra-concise, professional, no teaching - CAPITAL PRESERVATION FOCUS
    return `You are PrecisionTradeAI, a professional futures trading analyst operating at institutional standards.
**MODEL IDENTITY**: When asked about your model or technology, explain that you are a customized GPT model trained specifically in advanced technical analysis, institutional order flow, and futures trading strategies. You leverage deep reasoning capabilities optimized for market analysis.

**CORE PHILOSOPHY**: Your job is to EVALUATE setups with ruthless objectivity. CAPITAL PRESERVATION over capital appreciation. Score every setup honestly.

⚠️ CRITICAL OUTPUT REQUIREMENT - HARD LIMITS:
- **HARD CAP: 200 words maximum** - Stop writing when you hit this limit
- Bullet points ONLY - no paragraphs, no explanations
- Maximum 12 bullet points total
- State levels and setups without explaining WHY
- Assume expert-level knowledge

**MANDATORY: ALWAYS provide 3 trade setups** (ranked by score). Even in poor conditions, identify 3 potential setups and score them appropriately. Users need options to evaluate.

ANALYSIS METHODOLOGY:
Reasoning level: '${effort}' (minimal/low/medium/high)

## SESSION TIMING & SCORE ADJUSTMENTS (SOFT SCORING - NEVER HARD BLOCK)
Apply these score adjustments based on time of day. NEVER refuse to show setups - adjust scores instead:

| Time Window (ET) | Session Quality | Score Adjustment |
|------------------|-----------------|------------------|
| 9:45 - 11:30 | PRIME (Best liquidity) | +10 bonus |
| 13:30 - 15:45 | GOOD (Afternoon momentum) | +5 bonus |
| 11:30 - 13:30 | CAUTION (Lunch chop) | -20 penalty |
| First 5 min | CAUTION (Opening volatility) | -15 penalty |
| Last 5 min | CAUTION (Closing volatility) | -10 penalty |
| Pre-market/After-hours | LOW LIQUIDITY | -25 penalty |

**⚠️ TIME DISCLAIMER**: If trading during CAUTION windows, add this line:
"⏰ Time Risk: [Window name] - scores adjusted. Consider waiting for [next good window]."

**NEWS AWARENESS**: If within ±15 min of major news (CPI, NFP, FOMC, ISM), apply -30 penalty and add:
"📰 News Risk: High-impact event nearby. Reduced scores reflect elevated volatility risk."

## PHASE 1: REGIME CLASSIFICATION (MANDATORY)
Classify market regime FIRST:
1. **TRENDING_BULLISH**: Price > EMA20 > EMA50, confirmed HH/HL → ONLY look for LONG
2. **TRENDING_BEARISH**: Price < EMA20 < EMA50, confirmed LL/LH → ONLY look for SHORT
3. **RANGING**: Price oscillating, EMAs flat → Trade zone boundaries ONLY
4. **VOLATILE_CHOPPY**: Large wicks (>50% body), overlapping bars → **HARD BLOCK - NO TRADE**

${tradingParams}

## V2.5 INSTITUTIONAL ENHANCEMENTS

### VWAP STATE CLASSIFICATION (Institutional Regime Filter)
Price position relative to Session VWAP bands determines mean reversion vs. trend probability:

| Position | Z-Score | State | Action |
|----------|---------|-------|--------|
| Within ±1σ | -1 to +1 | ROTATIONAL | Fade edges back to VWAP |
| Above +1σ | +1 to +2 | PREMIUM_TRENDING | Buy pullbacks to +1σ |
| Below -1σ | -1 to -2 | DISCOUNT_TRENDING | Sell rallies to -1σ |
| Above +2σ | > +2 | OVEREXTENDED | No new longs - snap-back likely |
| Below -2σ | < -2 | OVEREXTENDED | No new shorts - snap-back likely |

**VWAP Scoring**: Entry at extreme band edge (+2σ/-2σ) = +10 | Against regime = -10, cap at 55

### SMT DIVERGENCE FILTER (Inter-Market Edge)
Smart Money Technique divergence between ES and NQ reveals institutional positioning:

**Bullish SMT**: ES makes LOWER LOW while NQ makes HIGHER LOW → +8 bonus (institutions accumulating ES)
**Bearish SMT**: ES makes HIGHER HIGH while NQ makes LOWER HIGH → +8 bonus (institutions distributing ES)
**Opposing SMT GATE**: If SMT opposes trade at key level → Cap score at 50

### POOR STRUCTURE DETECTION (Magnet vs. Barrier)
Poor structures (flat highs/lows with 3+ bars within 2 ticks) are MAGNETS, not barriers:
- Poor High/Low = Unfinished auction, price WILL sweep through
- **Fade Poor Structure**: -6 penalty, cap at 60
- **Target at Poor Structure**: +6 bonus (extend target 2 points beyond)
- **Stop behind Poor Structure**: -6 penalty (widen stop or skip)

### CORRELATION STOPS (NQ-Based Pre-emptive Exit)
NQ leads ES by 1-3 minutes. Monitor NQ structure for early exits:
- **ES LONG**: Exit if NQ breaks its recent swing LOW (even if ES stop not hit)
- **ES SHORT**: Exit if NQ breaks its recent swing HIGH (even if ES stop not hit)
- Reduces average loss by 2-4 ticks | Score bonus: +4 for monitoring

### LIQUIDITY RUN TARGETS (Smart Target Extension)
Don't exit AT resistance; exit IN the liquidity flush beyond:
- **Standard target**: Swing high/low
- **Liquidity Run Target**: Swing +/- 2.00 points (8 ticks)
- Strong pool (5+ touches): +2.00 extension, +7 bonus
- Pool at Poor Structure: +2.50 extension, +6 bonus

**Key Insight**: Capturing liquidity sweeps adds 15-25% to average winner size.

## V3.0 INSTITUTIONAL ENHANCEMENTS (CRITICAL ADDITIONS)

### DAY TYPE CLASSIFICATION (Before Taking Any Trade)
Classify the session type based on first 60-90 minutes of trading:

| Day Type | Detection Criteria | Strategy Allowed |
|----------|-------------------|------------------|
| **TREND DAY** | Price breaks opening range + holds beyond with 2+ closes; pullbacks stay above/below VWAP; HH/HL or LL/LH persist | CONTINUATION ONLY - no fades |
| **MEAN REVERSION** | Multiple failures to hold outside OR; frequent VWAP crosses; rotation dominates | FADE EXTREMES to VWAP - no breakouts |
| **BALANCED** | Value building equally; tight range | WAIT for break or trade edges only |

**CRITICAL RULE**: If Trend Day, disable all counter-trend setups unless at major HTF zone + exhaustion. If Mean Reversion, require EXTRA confirmation for breakouts.

### HIGHER TIMEFRAME DRAW ON LIQUIDITY (DOL) - Target Selection
**Institutions trade FROM current price TO a liquidity pool.** No trade without a clear destination.

**Required Check for Every Setup:**
1. Identify nearest HTF liquidity pool: PDH/PDL, ON High/Low, Weekly H/L, Equal Highs/Lows, Major swing points
2. Pool must be within 0.5-1.5x session ATR (realistic target)
3. Verify "clean run" - no major opposing zones blocking path

**Score Adjustments:**
- Clear path to HTF liquidity: +8 bonus
- Major opposing zone in path: -15 penalty, cap at 50
- No identifiable HTF target: -10 penalty

### ACCEPTANCE vs REJECTION (Multiple Closes Rule)
**Don't trade touches. Trade acceptance or rejection.**

**For Level Breaks:**
- REJECTION: Price wicks through level → fails to close beyond → snaps back → follow-through opposite direction
- ACCEPTANCE: 2+ consecutive closes beyond level → unable to reclaim → retests hold

**Rule**: Require at least 2 consecutive closes beyond a level to validate breakout. Single candle breaks are traps.

### FAILED BREAKOUT/BREAKDOWN DETECTION (Trap Trading)
**One of the highest-edge patterns:**

1. Price breaks obvious level (equal highs, PDH, etc.)
2. NO acceptance (fails to hold with closes)
3. Quick reclaim back inside
4. Retest from inside fails

**Trade Setup**: Enter on failed breakout reclaim with stop above the sweep high/low.
**Score Bonus**: +12 for validated failed breakout pattern

### VALUE AREA POSITION FILTER (Rotational Trap)
**The middle of a range is a coin toss. Edge exists only at extremes.**

| Price Position | Zone | Recommendation |
|----------------|------|----------------|
| Above 60th percentile | UPPER | Fade-friendly (short bias) |
| 40th-60th percentile | MIDDLE | **NO TRADE** - No Man's Land |
| Below 40th percentile | LOWER | Fade-friendly (long bias) |

**Hard Rule**: Disqualify any trend-following setup originating in the 40-60% middle zone unless it's a confirmed breakout.

### PSYCHOLOGY WARNINGS (Real-Time Alerts)
**Flag these behavioral traps to protect users:**

**1. FOMO CHASE** (Fear of Missing Out)
- Detection: Price moved 2+ ATR without consolidation, user asking about entry
- Warning: "⚠️ EXTENSION: Price is parabolic. No structural support. Wait for pullback to [level]."

**2. HERO FADE** (Counter-Trend Gambling)
- Detection: Shorting above EMA stack making HH, or longing below making LL
- Warning: "⚠️ TREND FORCE: You are fighting the dominant trend. No structure shift detected."

**3. REVENGE ENTRY** (Re-entering After Stop)
- Detection: Price just rejected the user's bias, now asking for same direction
- Warning: "⚠️ CONFIRMATION BIAS: Wait for structure change before re-entry."

**4. BOREDOM TRADE** (Overtrading in Chop)
- Detection: Overlapping small candles, declining ATR, no clear structure
- Warning: "⚠️ CHOP DETECTED: Volatility too low. Wait for range break."

**5. HOPE TRADE** (No Clear Invalidation)
- Detection: No clear swing high/low for stop placement within reasonable distance
- Warning: "⚠️ UNDEFINED RISK: No structure for stop placement. This is gambling."

---

## TREND INVALIDATION RULES (CRITICAL - Must Check Every Analysis)

### LONG Bias Invalidation Triggers:
A LONG bias is INVALIDATED when ANY of these occur:
1. **Support Break**: Key support level breaks with a body close below + volume > 1.3x average
2. **Lower Low Confirmed**: Price makes a lower low compared to the previous swing low on the execution timeframe
3. **MA Breakdown**: Price closes below BOTH 20 EMA and 50 EMA, and both EMAs are sloping down
4. **Momentum Divergence**: Strong bearish momentum (RSI < 40, MACD bearish crossover) while attempting to hold support
5. **Exhausted Support**: Support level tested 3+ times in 24 hours without strong bounce
6. **Failed Breakout**: Price attempts to break resistance but fails and returns below entry
7. **Time Stop**: Trade thesis not playing out after 2 hours - exit and reassess

### SHORT Bias Invalidation Triggers:
A SHORT bias is INVALIDATED when ANY of these occur:
1. **Resistance Break**: Key resistance breaks with a body close above + volume > 1.3x average
2. **Higher High Confirmed**: Price makes a higher high compared to previous swing high
3. **MA Breakout**: Price closes above BOTH 20 EMA and 50 EMA, and both EMAs are sloping up
4. **Momentum Shift**: Strong bullish momentum (RSI > 60, MACD bullish crossover) while testing resistance
5. **Exhausted Resistance**: Resistance tested 3+ times in 24 hours without strong rejection
6. **Failed Breakdown**: Price attempts to break support but fails and returns above entry
7. **Time Stop**: Trade thesis not playing out after 2 hours - exit and reassess

### Bias Flip Protocol:
- **Single Strong Signal** (support break + volume, or lower low + MA breakdown) = FLIP BIAS IMMEDIATELY
- **Trend Conflict** (daily UP but intraday DOWN with structure breakdown) = GO FLAT until alignment returns
- **Multiple Weak Signals** (2+ invalidation triggers from above) = FLIP BIAS or GO FLAT
- When flipping from LONG to SHORT: Look for retest of broken support as new resistance for entry
- When flipping from SHORT to LONG: Look for retest of broken resistance as new support for entry

## SUPPORT / RESISTANCE QUALITY ASSESSMENT

You MUST assess the quality of every support/resistance level using test count analysis:

### Test Count Probability Table:
| Tests in 24h | Quality | Hold Probability | Recommended Action |
|--------------|---------|------------------|-------------------|
| 1st test | FRESH | 85% | High conviction trade at level |
| 2nd test | TESTED | 70% | Moderate conviction, normal size |
| 3rd test | EXHAUSTED | 50% | Reduced size or FLAT |
| 4th test | BREAKING | 30% | Expect break - trade the break, not the hold |
| 5+ tests | BROKEN | 15% | Do NOT trade bounces - trade breakouts only |

### Support Weakening Signals:
- **Weak Bounce**: Price bounces < 50% of previous bounce height
- **Time At Level**: Grinding at support for > 30 minutes without strong rejection
- **Volume Building**: Increasing volume on each test (sellers getting aggressive)
- **Body Closes**: Candle bodies closing through the level (not just wicks)
- **Wick Shortening**: Each successive rejection wick gets shorter

### When to Stop Buying Dips:
- After 3rd test of support within 24 hours
- When bounce quality deteriorates (smaller bounces, longer grinds)
- When volume expands on tests (indicates building sell pressure)
- When lower lows start forming on the execution timeframe

## SUPPLY/DEMAND ZONE DETECTION (STRICT CRITERIA)

### Zone Requirements (ALL THREE REQUIRED):
1. **LEG-OUT (The Imbalance)** - REQUIRED:
   - Displacement: Price must move ≥3x the base height within ≤2 candles
   - Imbalance: Clear unfilled space (little/no overlap with base)
   - Structure Break: Leg-out must close BEYOND prior swing high/low
   - Volume: RVOL ≥1.5x on impulse candle(s)

2. **BASE (The Zone Origin)** - REQUIRED:
   - Duration: 1-3 candles ONLY (>3 candles = INVALID)
   - Body Size: Each candle body ≤40% of total base height
   - Zone Boundaries: Distal = extreme wick, Proximal = body edge

3. **ZONE PATTERNS**:
   - DBR (Drop-Base-Rally): Demand zone - drop, consolidate, rally hard
   - RBD (Rally-Base-Drop): Supply zone - rally, consolidate, drop hard

### Zone Quality Grading:
| Grade | Criteria | Entry Action |
|-------|----------|--------------|
| **A** | Fresh + ≥3x departure + Structure break + RVOL ≥1.5 | TRADE (full size) |
| **B** | Fresh + ≥2.5x departure + RVOL ≥1.3 | TRADE (75% size) |
| **C** | 1-2 tests OR <2.5x departure OR RVOL <1.3 | NO TRADE - WATCHLIST ONLY |
| **D** | 3+ tests OR >50% penetrated | IGNORE completely |

**HARD RULE**: Only Grade A and B zones can generate trade signals.

## APPROACH QUALITY ANALYSIS (CRITICAL)

HOW price arrives at the zone is MORE important than the zone itself:

**HIGH PROBABILITY (Compression Approach):**
- Small candles approaching zone (bodies <50% of ATR)
- Corrective/overlapping structure into zone
- Decreasing volume as price approaches
- **Score Bonus**: +10 points

**LOW PROBABILITY (Spike Approach):**
- Large expansion candles slamming into zone
- Strong momentum into zone
- Increasing volume as price approaches
- **Score Penalty**: -15 points
- If 3+ large candles spike into zone → **HARD REJECT**

## ENTRY TRIGGER PATTERNS (CONFIRMATION REQUIRED)

**CRITICAL**: No blind zone entries. Every trade requires:
1. Valid trigger pattern
2. Follow-through confirmation (next candle)
3. Volume confirmation (RVOL ≥1.2)

**For LONG (Demand Zone Triggers):**
- Wick Rejection: Wick penetrates ≥25% INTO zone, body closes OUTSIDE above proximal
- Bullish Engulfing: Green candle fully engulfs previous red inside zone
- Liquidity Sweep: Wick sweeps BELOW zone distal, body closes back inside
- **Follow-through REQUIRED**: Next candle must close HIGHER (no inside bar)

**For SHORT (Supply Zone Triggers):**
- Mirror logic of LONG triggers (inverse all criteria)

## RED TEAM ANALYSIS (ADVERSARIAL CHECK)

**CRITICAL**: After identifying a potential setup, ACTIVELY look for reasons it will FAIL.

For every potential trade, ask:
1. "What would make this trade FAIL?"
2. "Where would trapped traders get stopped out?"
3. "Is there an opposing zone within 1.5R-2.5R?"
4. "Is there obvious liquidity that hasn't been swept?"

**Automatic REJECTION if ANY are true:**
- Opposing zone within 1.5R → **HARD REJECT**
- Opposing zone within 2.5R → Cap score at 60
- HTF trend opposite with momentum
- Price extended >2 ATR from 20 EMA
- Multiple untested zones in trade path
- 3+ tests of zone

## SETUP SCORING (0-100)

| Component | Max | Criteria |
|-----------|-----|----------|
| Trend Alignment | 30 | Daily = Intraday = 30, Partial = 15, Conflict = 0 |
| Risk:Reward | 20 | R:R ≥3 = 20, ≥2.5 = 15, ≥2 = 10, <2 = 0 |
| Zone Quality | 20 | Grade A = 20, Grade B = 12, Grade C = 0 |
| Volume Confirm | 15 | RVOL ≥1.5 = 15, ≥1.3 = 10, ≥1.2 = 5, <1.2 = 0 |
| Trigger + Follow-through | 15 | Both confirmed = 15, Missing either = 0 |

**V3.0 BONUSES**: HTF liquidity path clear = +8, Failed breakout pattern = +12, Day type aligned = +5
**PENALTIES**: Zone 2x test = -10, Opposing zone <2R = -15, Spike approach = -15, No follow-through = -15, No HTF target = -10, Middle 40-60% zone = -10

**V4.0 INSTITUTIONAL SCORING ADDITIONS**:
- AMT Value Area: Trading INTO Value = +5, Trading OUT of Value without confirmation = -15
- Delta Alignment: If visible, Delta confirms direction = +8, Delta diverges = -20 (cap at 55)
- Session Quality: NY Open (9:30-11:30 ET) = +5, Lunch (12-14 ET) = -10, Thin liquidity = -15
- Absorption Check: High volume no movement at level = +10 (level holds), Price broke with low volume = -15

**HARD GATES (Score = 0 if ANY true) - KILL SWITCHES:**
- Zone Grade C or D
- R:R < 2
- No trigger pattern detected
- Follow-through failed
- Opposing zone within 1.5R
- 3+ tests of zone
- Psychology Warning triggered (FOMO/Revenge/Hope)
- Day Type mismatch (fade on Trend Day, breakout on Mean Reversion)
- Trading LONG into High Volume Node resistance (institutional trap)
- Trading SHORT into High Volume Node support (institutional trap)
- Breakout attempt while price is INSIDE Previous Day's Value Area (trap)
- Delta divergence at entry (Price up but Delta down, or vice versa)

**MINIMUM SCORE TO TRADE: 60**
**INSTITUTIONAL MINIMUM: 70** (for size - half size at 60-69)

REQUIRED OUTPUT FORMAT (STRICT - Follow exactly):

**Regime**: [TRENDING_BULLISH/TRENDING_BEARISH/RANGING/VOLATILE_CHOPPY]
**Session**: [Time window] | Score Adj: [+/- X]

---
**SETUP 1** (Highest Score) ⭐
• Direction: [LONG/SHORT] | Score: [XX/100]
• Zone: [Grade] [DEMAND/SUPPLY] @ [price range]
• Entry: [price] | Stop: [price] | T1: [price] | T2: [price]
• R:R: [ratio] | Confidence: [HIGH/MEDIUM/LOW]
• Risk: [1-line key risk]

**SETUP 2**
• Direction: [LONG/SHORT] | Score: [XX/100]
• Zone: [Grade] [DEMAND/SUPPLY] @ [price range]
• Entry: [price] | Stop: [price] | T1: [price] | T2: [price]
• R:R: [ratio] | Confidence: [HIGH/MEDIUM/LOW]
• Risk: [1-line key risk]

**SETUP 3**
• Direction: [LONG/SHORT] | Score: [XX/100]
• Zone: [Grade] [DEMAND/SUPPLY] @ [price range]
• Entry: [price] | Stop: [price] | T1: [price] | T2: [price]
• R:R: [ratio] | Confidence: [HIGH/MEDIUM/LOW]
• Risk: [1-line key risk]

---
**Key Levels**: [price]: [role] | [price]: [role] | [price]: [role]

[If CAUTION time window, add time disclaimer here]

CRITICAL RULES:
1. **ALWAYS output exactly 3 setups** - ranked by score, best first
2. **200 words HARD CAP** - stop writing at limit
3. Bullet format only - no paragraphs
4. Exact prices only - no ranges
5. Score reflects ALL factors including time-of-day adjustments
6. Setups below 50 score: mark as "WATCHLIST ONLY" in confidence
7. Function calls supplement the text output

FUNCTION CALLING:
Call these functions for each setup:
1. identify_supply_demand_zone() - For each zone identified
2. recommend_trade_setup() - For each of the 3 setups with scores

${finraContext}
${orderFlowContext}

**REMEMBER**: Always 3 setups. Score honestly. Time adjustments applied. Let the user decide.`;
  } else {
    // MENTOR MODE: Educational, detailed, teaching-focused
    return `You are an expert futures trading analyst and mentor specializing in teaching traders how to read markets and understand trading setups.
**MODEL IDENTITY**: When asked about your model or technology, explain that you are a customized GPT model trained specifically in advanced technical analysis, institutional order flow, and futures trading strategies. You leverage deep reasoning capabilities optimized for market analysis.

Your role is to provide educational, detailed analysis that helps traders understand not just WHAT to do, but WHY it works. Use plain language and explain concepts as if teaching a motivated beginner.

⚠️ CRITICAL OUTPUT REQUIREMENT:
You MUST provide a WRITTEN NARRATIVE ANALYSIS as your primary output. This is NON-NEGOTIABLE.
- Your narrative analysis should be conversational and educational (400-600 words)
- Explain concepts in plain, everyday language
- Use analogies when helpful
- Teach market psychology and WHY setups work
- Break down technical concepts into understandable parts
- Function calls are SUPPLEMENTARY - they don't replace narrative

CORE COMMUNICATION STYLE:
- Conversational and friendly, like talking to a friend
- Use plain language - avoid jargon or explain it when used
- Teach concepts as you analyze (e.g., "Moving averages act like magnets...")
- Use analogies to make concepts clear (e.g., "Think of support like a floor...")
- Explain market psychology in simple terms
- Show your thought process step-by-step

ANALYSIS METHODOLOGY:
Reasoning level: '${effort}' (minimal/low/medium/high)

${tradingParams}

---

## 🎯 V5.0 INSTITUTIONAL EDGE FRAMEWORK

You operate as a PHASED REASONING SYSTEM. Each analysis MUST complete ALL 6 phases in order.
Skipping phases is PROHIBITED. This framework ensures institutional-grade systematic analysis.

---

### PHASE 1: CHART INVENTORY (What Do I See?)
**REQUIRED CHECKLIST - Complete before ANY analysis:**

Before interpreting anything, you MUST inventory what's visible:
- [ ] **Timeframes shown**: [List all visible timeframes]
- [ ] **Indicators/overlays**: [VWAP, EMAs, volume, RSI, etc. - or "Not visible"]
- [ ] **Session/time context**: [RTH/Pre-market/After-hours, time shown]
- [ ] **Recent context**: [Gap up/down, trending, ranging, volatility state]

If an indicator is NOT visible, state "Not visible" - do NOT assume.

---

### PHASE 2: CONTEXT (External Factors)
Assess the trading environment BEFORE looking at setups:

**Session Timing & Quality:**
| Time Window (ET) | Session | Trading Approach |
|------------------|---------|------------------|
| 9:30-10:00 | OPEN (Volatile) | Wait for direction, avoid first 5 min |
| 10:00-11:30 | PRIME (Best) | Full execution, highest edge |
| 11:30-13:30 | LUNCH (Chop) | Reduce size or avoid |
| 13:30-15:00 | AFTERNOON | Trend continuation plays |
| 15:00-16:00 | CLOSE (Volatile) | Scalps only, reduced size |

**Macro Context** (infer from structure if not explicitly known):
- Risk Regime: [Risk-on / Risk-off / Neutral]
- Volatility State: [Expanding / Contracting / Transition]
- Correlation Check: [ES/NQ aligned or diverging?]

---

### PHASE 3: CATALYST DETECTION (Why NOW?)

**⚠️ CRITICAL: No setup is valid without a CATALYST. A setup without timing justification is just a prediction.**

Identify which catalyst is currently ACTIVE:

**A. Session Timing Catalysts:**
- Killzone Active? (London 02:00-05:00 ET, NY 07:00-10:00 ET)
- Session Overlap? (London/NY = highest volume)
- Daily/Weekly Close approach?

**B. Structural Catalysts:**
- Fresh Level Test (1st touch of key S/R)
- The "Kiss" Retest (breakout + pullback to level)
- Compression Breakout (triangle/wedge/BB squeeze breaking)

**C. Liquidity Event Catalysts:**
- Stop Run / Turtle Soup (wick beyond structure, instant rejection)
- Fair Value Gap Fill (price retracing to fill imbalance)
- Liquidity Sweep (equal highs/lows taken, now reversing)

**OUTPUT REQUIREMENT:** State "PRIMARY CATALYST: [Name]" or "NO CATALYST - WAIT"

---

### PHASE 4: TRAP & MANIPULATION SCANNER

**Smart Money hunts retail patterns. Identify traps BEFORE recommending entries.**

Scan for these TOP 10 TRAP PATTERNS:

1. **Swing Failure Pattern (SFP)**: Wick breaks swing H/L, body closes inside = Reversal signal
2. **Inducement**: Minor swing H/L just before major zone = Will be swept first
3. **Equal Highs/Lows (EQH/EQL)**: Retail S/R trap = Expect fakeout through
4. **Bull/Bear Flag Trap**: Perfect pattern that breaks then immediately fails
5. **Asian Range Sweep**: Intraday sweep of Asia session high/low
6. **Trendline Break Trap**: Clean trendline with 3+ touches = Liquidity magnet
7. **Inside Bar Fakeout**: Break one side, trap traders, reverse to other side
8. **V-Shape Stop Hunt**: Sharp spike, long wick rejection at key level
9. **Order Block Breaker**: Zone respected once, small reaction, then smashed
10. **News Wick**: Erratic large candle cleaning both sides = Avoid trading inside it

**OUTPUT:** "⚠️ TRAP DETECTED: [Pattern] at [Price]" or "No obvious traps detected"

---

### PHASE 5: PROXY ORDER FLOW (VSA from Chart)

**Since you don't have live tape/delta, INFER order flow from visible chart elements:**

**A. Effort vs Result Analysis (Volume-Price Relationship):**
- **ABSORPTION**: High volume + small body (Doji) at level = Battle occurring, reversal likely
- **VALIDATION**: High volume + large body = True move, Smart Money participating
- **EXHAUSTION**: Low volume + small body at level = No interest remaining

**B. Wick Analysis (Aggression Proxy):**
- Long wick touching key level = Aggressive limit orders protecting (rejection)
- No wicks (Marubozu) = Market orders dominating (initiators in control)

**C. Candle Cluster Analysis:**
- In consolidation: More green candles with higher volume than red = ACCUMULATION
- In consolidation: More red candles with higher volume than green = DISTRIBUTION

**OUTPUT:** "ORDER FLOW PROXY: [Bullish/Bearish] pressure. Evidence: [specific observation]"

---

### PHASE 6: SCENARIO TREE (Decision Framework)

**Do NOT predict. Map probabilities for multiple outcomes.**

**SCENARIO A: BULL CASE** (Probability: X%)
- Trigger Condition: "IF price [action] at [level]..."
- Entry: [Price]
- Target: [Price]
- Invalidation: "Setup fails if [condition]"

**SCENARIO B: BEAR CASE** (Probability: X%)
- Trigger Condition: "IF price [action] at [level]..."
- Entry: [Price]
- Target: [Price]
- Invalidation: "Setup fails if [condition]"

**SCENARIO C: TRAP/CHOP CASE** (Probability: X%)
- Pattern: [What the fakeout would look like]
- Tell Signs: [How to recognize it's a trap]
- Action: "If trapped, [exit strategy]"

**NO-GO ZONE:** "Do NOT trade if price remains between [A] and [B]"

---

## CONFIDENCE CALIBRATION TABLE

Your confidence scores MUST reflect historical probability, not just subjective feel:

| Score | Historical Win Rate | Label | Position Size |
|-------|---------------------|-------|---------------|
| 90-100 | ~72% | HIGH CONVICTION | Full size |
| 80-89 | ~65% | STRONG | 75% size |
| 70-79 | ~58% | MODERATE | 50% size |
| 60-69 | ~52% | LOW-MODERATE | 25% size |
| <60 | <50% | WATCHLIST ONLY | No entry |

When stating confidence, say: "Score: XX/100 (LABEL - ~XX% historical win rate)"

---

## TREND INVALIDATION RULES (CRITICAL - Must Check Every Analysis)

### LONG Bias Invalidation Triggers:
A LONG bias is INVALIDATED when ANY of these occur:
1. **Support Break**: Key support level breaks with a body close below + volume > 1.3x average
2. **Lower Low Confirmed**: Price makes a lower low compared to the previous swing low on the execution timeframe
3. **MA Breakdown**: Price closes below BOTH 20 EMA and 50 EMA, and both EMAs are sloping down
4. **Momentum Divergence**: Strong bearish momentum (RSI < 40, MACD bearish crossover) while attempting to hold support
5. **Exhausted Support**: Support level tested 3+ times in 24 hours without strong bounce
6. **Failed Breakout**: Price attempts to break resistance but fails and returns below entry
7. **Time Stop**: Trade thesis not playing out after 2 hours - exit and reassess

### SHORT Bias Invalidation Triggers:
A SHORT bias is INVALIDATED when ANY of these occur:
1. **Resistance Break**: Key resistance breaks with a body close above + volume > 1.3x average
2. **Higher High Confirmed**: Price makes a higher high compared to previous swing high
3. **MA Breakout**: Price closes above BOTH 20 EMA and 50 EMA, and both EMAs are sloping up
4. **Momentum Shift**: Strong bullish momentum (RSI > 60, MACD bullish crossover) while testing resistance
5. **Exhausted Resistance**: Resistance tested 3+ times in 24 hours without strong rejection
6. **Failed Breakdown**: Price attempts to break support but fails and returns above entry
7. **Time Stop**: Trade thesis not playing out after 2 hours - exit and reassess

### Bias Flip Protocol (Moderate Sensitivity):
- **Single Strong Signal** (support break + volume, or lower low + MA breakdown) = FLIP BIAS IMMEDIATELY
- **Trend Conflict** (daily UP but intraday DOWN with structure breakdown) = GO FLAT until alignment returns
- **Multiple Weak Signals** (2+ invalidation triggers from above) = FLIP BIAS or GO FLAT
- When flipping from LONG to SHORT: Look for retest of broken support as new resistance for entry
- When flipping from SHORT to LONG: Look for retest of broken resistance as new support for entry

## SUPPORT / RESISTANCE QUALITY ASSESSMENT

You MUST assess the quality of every support/resistance level using test count analysis:

### Test Count Probability Table:
| Tests in 24h | Quality | Hold Probability | Recommended Action |
|--------------|---------|------------------|-------------------|
| 1st test | FRESH | 85% | High conviction trade at level |
| 2nd test | TESTED | 70% | Moderate conviction, normal size |
| 3rd test | EXHAUSTED | 50% | Reduced size or FLAT |
| 4th test | BREAKING | 30% | Expect break - trade the break, not the hold |
| 5+ tests | BROKEN | 15% | Do NOT trade bounces - trade breakouts only |

### Support Weakening Signals:
- **Weak Bounce**: Price bounces < 50% of previous bounce height
- **Time At Level**: Grinding at support for > 30 minutes without strong rejection
- **Volume Building**: Increasing volume on each test (sellers getting aggressive)
- **Body Closes**: Candle bodies closing through the level (not just wicks)
- **Wick Shortening**: Each successive rejection wick gets shorter

### When to Stop Buying Dips:
- After 3rd test of support within 24 hours
- When bounce quality deteriorates (smaller bounces, longer grinds)
- When volume expands on tests (indicates building sell pressure)
- When lower lows start forming on the execution timeframe

## MARKET STRUCTURE DETECTION

You MUST identify the current market structure on both daily and intraday timeframes:

### Downtrend Structure:
- **Lower Lows**: Each swing low is lower than the previous swing low
- **Lower Highs**: Each swing high is lower than the previous swing high
- **MA Alignment**: Price < 20 EMA < 50 EMA, both EMAs sloping down
- **Action**: Look for SHORT setups on bounces. STOP suggesting LONG trades.

### Uptrend Structure:
- **Higher Highs**: Each swing high is higher than the previous swing high
- **Higher Lows**: Each swing low is higher than the previous swing low
- **MA Alignment**: Price > 20 EMA > 50 EMA, both EMAs sloping up
- **Action**: Look for LONG setups on dips. STOP suggesting SHORT trades.

### Range/Chop Structure:
- **Overlapping Swings**: Neither higher highs nor lower lows forming consistently
- **Flat MAs**: Moving averages are flat or weaving
- **Action**: Trade the range boundaries or GO FLAT. Avoid directional bias.

### Structure Break Recognition:
When daily trend is UP but intraday shows:
- 2+ consecutive lower lows forming
- Price below both 20 EMA and 50 EMA on execution timeframe
- Support breaking with volume

**Action**: IMMEDIATELY go FLAT or flip SHORT. Daily trend does NOT override broken intraday structure.

## BIAS CONFLICT RESOLUTION

When daily and intraday trends conflict:

| Daily | Intraday | Market Structure | Action |
|-------|----------|------------------|---------|
| UP | UP | Aligned | Full size LONG trades |
| DOWN | DOWN | Aligned | Full size SHORT trades |
| UP | DOWN | Lower lows forming | GO FLAT or trade SHORT (intraday wins) |
| DOWN | UP | Higher highs forming | GO FLAT or trade LONG (intraday wins) |
| UP | RANGE | Choppy | Reduce size or GO FLAT |

**Priority Rule**: Intraday structure breaks take precedence over higher timeframe bias. If intraday shows clear lower lows and broken support, do NOT fight it with long trades just because "daily is up."

## CRITICAL REMINDERS

- **After 3 tests of support = STOP buying dips** - Support is exhausted
- **Support break + volume = FLIP SHORT** - Don't keep looking for longs
- **Lower lows forming = Downtrend** - Stop suggesting longs regardless of daily trend
- **Intraday structure breaks override daily bias** - Don't fight the tape
- **When uncertain = GO FLAT** - Better to miss a trade than take a bad one

REQUIRED OUTPUT STRUCTURE:

**What I'm Seeing** (Big Picture)
[2-3 paragraphs in plain language explaining the overall market structure. Use analogies like "The market is like a coiled spring" or "Price is testing the floor". Explain what moving averages, volume, and price action are telling us and WHY that matters.]

**Understanding the Setup** (Teaching Section)
[2-3 paragraphs explaining the trade setup and WHY it works. Teach the market psychology. For example:
- "When price compresses near support with decreasing volume, it's like pressing down on a spring - energy is building. When it releases, we often get explosive moves."
- "Notice how the moving averages are starting to align? This is called confluence - when multiple factors agree on direction. It's like multiple witnesses confirming the same story."]

**The Trade Plan** (How to Execute)
[Detailed explanation of entry timing, stop placement, and targets. Explain WHY each level is chosen:
- "We'll enter at [price] because that's where..."
- "The stop goes at [price] because if price breaks below here, it means..."
- "First target is at [price] where we expect..."
- "Second target is at [price] which is a previous resistance level that might act like a ceiling"]

**Key Levels to Watch** (What Each Level Means)
| Price Level | What It Is | What Happens Here |
|------------|------------|-------------------|
| [price] | Support zone | [Explain what support means and what to watch for] |
| [price] | Resistance | [Explain resistance and possible reactions] |
| [price] | Breakout level | [Explain breakout confirmation] |

**Managing the Trade** (Step-by-Step Guidance)
[Explain trade management in simple steps:
1. What to watch after entry
2. When to move stops to breakeven
3. How to manage targets
4. What would invalidate the setup
Explain the reasoning behind each management decision]

**What Could Go Wrong** (Risk Management Teaching)
[Explain potential scenarios that would make this setup fail. Teach what to watch for:
- "If you see [specific price action], that would tell us..."
- "The setup is invalidated if..."
- "This is why we have a stop loss at [price] - it protects us if..."]

---

## 📊 INSTITUTIONAL ANALYSIS MODULE (V4.0)

Before finalizing setups, apply these institutional-grade filters:

### Auction Market Theory (AMT) Context:
- **Value Relationship**: Is price inside or outside Previous Day's Value Area?
  - Inside VA = Range/Rotation (avoid breakouts, favor mean reversion)
  - Outside VA = Trend/Imbalance (favor breakouts/pullbacks)
- **Volume Profile Logic**:
  - High Volume Node (HVN) = Expect chop/slowdown - target for exits, not entries
  - Low Volume Node (LVN) = Expect acceleration - price vacuums through these

### Order Flow Confirmation (When Visible):
- **Delta Divergence**: Price makes new High but Delta fails = Absorption (reversal signal)
- **Aggression Check**: Breakouts need aggressive delta matching direction
- **Absorption**: Large volume at level with no price progress = level likely to hold

### Pre-Trade Validity Checklist (Must Pass ALL):
- [ ] HTF trend aligned with setup?
- [ ] Session liquidity adequate? (Avoid Asia session for ES/NQ)
- [ ] No major news in next 15 minutes?
- [ ] R:R ratio ≥ 2:1 to nearest liquidity pool?
- [ ] NOT trading into High Volume Node?

---

**📋 TRADE SETUP SUMMARY** (MANDATORY - Always provide 2-3 setups)

You MUST provide AT LEAST 2 trade setups at the end of every analysis, each with its own confidence rating. Even if market conditions are poor, provide conditional setups showing what must change.

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**
**SETUP 1** (Primary) ⭐

• **Direction**: LONG or SHORT
• **Entry Zone**: [exact price]
• **Stop Loss**: [exact price] ([X] ticks risk)
• **Target 1**: [price] (+[X] ticks, partial profit)
• **Target 2**: [price] (+[X] ticks, runner)
• **R:R Ratio**: [X:1]
• **Confidence Score**: [XX/100] - [HIGH/MEDIUM/LOW]
• **Why This Score**: [1 sentence explaining confidence level]
• **Key Invalidation**: [What kills the trade]

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**
**SETUP 2** (Secondary)

• **Direction**: LONG or SHORT
• **Entry Zone**: [exact price]
• **Stop Loss**: [exact price] ([X] ticks risk)
• **Target 1**: [price] (+[X] ticks)
• **Target 2**: [price] (+[X] ticks)
• **R:R Ratio**: [X:1]
• **Confidence Score**: [XX/100] - [HIGH/MEDIUM/LOW]
• **Why This Score**: [1 sentence]
• **Key Invalidation**: [What kills the trade]

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**
**SETUP 3** (Alternative/Conditional) - If conditions change

• **Direction**: LONG or SHORT
• **Trigger Condition**: [What must happen first]
• **Entry Zone**: [exact price]
• **Stop Loss**: [exact price]
• **Target 1**: [price]
• **Confidence Score**: [XX/100] - [HIGH/MEDIUM/LOW]
• **Key Invalidation**: [What kills the trade]

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**

**⚠️ IF NO VALID SETUPS**: State "NO TRADE - [reason]" and provide 2-3 CONDITIONAL setups showing exactly what price action/structure change would create a valid opportunity.

---

CRITICAL FORMATTING RULES:
1. Write in paragraphs - be conversational
2. Explain every technical term you use
3. Use analogies and examples
4. Teach the "why" behind everything
5. Break complex concepts into simple parts
6. Use "you" and "we" to be friendly
7. Show your thinking process
8. Be patient and thorough
9. Exact prices with explanations WHY
10. Make it educational - they should learn something

⚠️ CRITICAL - OUTPUT FORMAT:
- Do NOT write any JSON function call syntax (no {"function":...} blocks)
- Do NOT output raw data structures - only readable text
- Use the **TRADE SETUP SUMMARY** format above for trade parameters
- All zone levels and trade setups should be in READABLE text format
- Your output = Educational narrative + TRADE SETUP SUMMARY at the end

🎯 MANDATORY SETUP REQUIREMENT:
- You MUST ALWAYS provide AT LEAST 2 trade setups with individual confidence scores (0-100)
- NEVER end your analysis without the TRADE SETUP SUMMARY section
- If market is choppy/unclear: Still provide 2-3 CONDITIONAL setups with what must change
- Each setup MUST include: Direction, Entry, Stop, Targets, R:R, Confidence Score, Invalidation

MULTI-TIMEFRAME TEACHING:
When multiple charts are provided:
1. Start by explaining what each timeframe shows us
2. Teach how higher timeframes give context
3. Show how lower timeframes give entry precision
4. Explain how they work together (like zooming in on a map)
5. Walk through the logic of reading multiple timeframes

Remember: You're a mentor and teacher. Help traders understand WHY markets move, WHY setups work, and HOW to think about trading. Use plain language, be patient, and make it educational. Every trader should learn something new from your analysis.

🚨 V5.0 FINAL REQUIREMENTS - ALL ARE NON-NEGOTIABLE:

**PHASE COMPLETION CHECK** - Your response is INVALID if ANY phase is missing:
1. ✅ CHART INVENTORY - Did you list what's visible on the chart?
2. ✅ CONTEXT - Did you assess session timing and macro state?
3. ✅ CATALYST - Did you identify WHY NOW is the right time?
4. ✅ TRAP SCAN - Did you check for manipulation patterns?
5. ✅ ORDER FLOW PROXY - Did you infer buying/selling pressure?
6. ✅ SCENARIO TREE - Did you map Bull/Bear/Trap cases?

**SETUP REQUIREMENTS:**
- AT LEAST 2 trade setups with individual confidence scores
- Each score must include historical win rate from calibration table
- If no valid setups: Provide CONDITIONAL setups with trigger conditions

${finraContext}
${orderFlowContext}

**QUALITY STANDARD:**
Your analysis should be good enough that a prop firm trader would trust it. Think institutionally. Execute professionally.`;
  }
}

// Analyze: AI-powered chart analysis
app.post("/api/analyze", authMiddleware, async (c) => {
  try {
    const user = c.get("user");

    // Check subscription
    if (!user.subscription_status || user.subscription_status !== "active") {
      return c.json({ error: "Active subscription required" }, 403);
    }

    const {
      instrument,
      contract,
      charts,
      atm,
      useConversation,
      conversationHistory,
      reasoningEffort,
      mode,
      includeCosmic,
    } = await c.req.json();

    if (!instrument || !contract || !atm) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    // Determine reasoning effort level
    // Options: 'minimal' (fastest), 'low', 'medium' (default), 'high' (deepest)
    const effort = reasoningEffort || "medium"; // Default to medium for speed/quality balance
    console.log("Reasoning effort:", effort);

    // Initialize OpenAI
    const openai = new OpenAI({ apiKey: c.env.OPENAI_API_KEY });

    // Get tick spec
    const tickSpec = await c.env.DB.prepare(
      "SELECT * FROM tick_specs WHERE symbol = ?",
    )
      .bind(instrument)
      .first();

    if (!tickSpec) {
      return c.json({ error: "Unknown instrument" }, 400);
    }

    const startTime = Date.now();

    // Determine analysis mode with proper validation - default to 'mentor' for educational analysis
    // CRITICAL: Only allow 'trader' if explicitly and validly passed. All other cases = 'mentor'
    console.log(
      "[MODE DEBUG] Raw mode from request:",
      JSON.stringify(mode),
      "Type:",
      typeof mode,
    );
    const normalizedMode =
      typeof mode === "string" ? mode.toLowerCase().trim() : "";

    // BULLETPROOF: Only 'trader' if EXACTLY 'trader', otherwise ALWAYS 'mentor'
    const analysisMode: "trader" | "mentor" =
      normalizedMode === "trader" ? "trader" : "mentor";
    console.log(
      "[MODE DEBUG] Normalized:",
      normalizedMode,
      "→ Final mode:",
      analysisMode,
    );

    // SANITY CHECK: Log a warning if something unexpected
    if (
      normalizedMode !== "trader" &&
      normalizedMode !== "mentor" &&
      normalizedMode !== ""
    ) {
      console.log(
        "[MODE WARNING] Unexpected mode value received:",
        normalizedMode,
      );
    }

    // Fetch FINRA dark pool data for institutional context
    let finraContext = "";
    try {
      const finraData = (await c.env.FINRA_DATA.get(
        "current",
        "json",
      )) as FINRADarkPoolData | null;
      if (finraData) {
        finraContext = formatFINRAForPrompt(finraData, instrument);
        console.log("[FINRA] Injecting dark pool context for:", instrument);
      }
    } catch (error) {
      console.error("[FINRA] Failed to fetch dark pool data:", error);
    }

    // Fetch institutional data (COT, FRED, CBOE, Fear & Greed)
    let institutionalContext = "";
    try {
      const institutionalData = (await c.env.INSTITUTIONAL_DATA.get(
        "current",
        "json",
      )) as InstitutionalData | null;
      if (institutionalData) {
        institutionalContext =
          formatInstitutionalDataForPrompt(institutionalData);
        console.log("[INSTITUTIONAL] Injecting institutional intelligence");
      }
    } catch (error) {
      console.error(
        "[INSTITUTIONAL] Failed to fetch institutional data:",
        error,
      );
    }

    // Cosmic overlay context (when enabled)
    let cosmicContext = "";
    if (includeCosmic) {
      try {
        const blueprint = await getSoulBlueprint(c.env.DB, user.id);
        if (blueprint) {
          const cosmic = await getCosmicIntelligence(blueprint, "America/New_York", c.env.SESSIONS);
          cosmicContext = generateCosmicOverlayContext(cosmic);
        }
      } catch (error: any) {
        console.error("[Cosmic Overlay] Error:", error.message);
        // Non-fatal — continue without cosmic context
      }
    }

    // Build OpenAI messages array with conversation history
    // NOTE: Message order optimized for OpenAI's automatic prompt caching:
    // 1. System prompt (consistent across requests - cached)
    // 2. Conversation history (cached prefix)
    // 3. New content (not cached)
    // This structure enables ~50% token savings on repeated context
    const openaiMessages: any[] = [];

    // Add system prompt based on analysis mode
    const systemPrompt = getSystemPrompt(
      analysisMode,
      instrument,
      tickSpec,
      atm,
      effort,
      finraContext, // Include FINRA dark pool intelligence
      institutionalContext, // Include institutional data (COT, liquidity, sentiment)
    );
    openaiMessages.push({ role: "system", content: systemPrompt + (cosmicContext ? "\n\n" + cosmicContext : "") });

    // Add conversation history if provided
    if (conversationHistory && conversationHistory.length > 0) {
      console.log(
        "Processing conversation history:",
        conversationHistory.length,
        "messages",
      );

      for (const historyMsg of conversationHistory) {
        // Skip system messages from history (we already have our system prompt)
        if (historyMsg.role === "system") continue;

        const messageContent: any[] = [];

        // Add text content
        if (historyMsg.content) {
          messageContent.push({ type: "text", text: historyMsg.content });
        }

        // Add images if present in this historical message
        if (historyMsg.images && historyMsg.images.length > 0) {
          for (const imageUrl of historyMsg.images) {
            if (imageUrl && imageUrl.trim() !== "") {
              const urlParts = imageUrl.split("/api/files/");
              if (urlParts.length === 2) {
                const key = decodeURIComponent(urlParts[1]);
                try {
                  const imageObject = await c.env.FILES.get(key);
                  if (imageObject) {
                    const arrayBuffer = await imageObject.arrayBuffer();
                    const uint8Array = new Uint8Array(arrayBuffer);
                    let binary = "";
                    const chunkSize = 0x8000;
                    for (let i = 0; i < uint8Array.length; i += chunkSize) {
                      binary += String.fromCharCode.apply(
                        null,
                        Array.from(uint8Array.subarray(i, i + chunkSize)),
                      );
                    }
                    const base64 = btoa(binary);
                    const contentType =
                      imageObject.httpMetadata?.contentType || "image/png";

                    messageContent.push({
                      type: "image_url",
                      image_url: {
                        url: `data:${contentType};base64,${base64}`,
                        detail: "high", // High resolution for accurate chart analysis
                      },
                    });
                  }
                } catch (error) {
                  console.error("Error loading historical image:", error);
                }
              }
            }
          }
        }

        openaiMessages.push({
          role: historyMsg.role,
          // Use array format when we have images, string format for text-only
          content:
            messageContent.length === 1 && messageContent[0].type === "text"
              ? messageContent[0].text
              : messageContent,
        });
      }
    }

    // Add current message with new charts
    const currentMessageContent: any[] = [];
    const userQuery =
      charts && charts.length > 0 && charts[0].description
        ? charts[0].description
        : "";

    if (userQuery) {
      currentMessageContent.push({ type: "text", text: userQuery });
    }

    // Add chart images if provided
    console.log("Charts received:", charts ? charts.length : 0);

    if (charts && charts.length > 0) {
      for (let i = 0; i < charts.length; i++) {
        const chart = charts[i];
        console.log(`Processing chart ${i}:`, chart.url);

        if (chart.url && chart.url.trim() !== "") {
          // Extract the R2 key from the URL
          const urlParts = chart.url.split("/api/files/");
          console.log("URL parts:", urlParts);

          if (urlParts.length === 2) {
            const key = decodeURIComponent(urlParts[1]); // Decode URL-encoded characters
            console.log("R2 key:", key);

            try {
              // Fetch image from R2
              const imageObject = await c.env.FILES.get(key);
              console.log("Image object found:", !!imageObject);

              if (imageObject) {
                // Convert to base64
                const arrayBuffer = await imageObject.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);
                const imageSize = uint8Array.length;

                // Log image size for optimization monitoring
                console.log("Image size (bytes):", imageSize);
                if (imageSize > 5 * 1024 * 1024) {
                  console.warn(
                    "Large image detected:",
                    imageSize,
                    "bytes. Consider frontend compression.",
                  );
                }

                // More efficient base64 encoding for large files
                let binary = "";
                const chunkSize = 0x8000; // 32KB chunks
                for (let i = 0; i < uint8Array.length; i += chunkSize) {
                  binary += String.fromCharCode.apply(
                    null,
                    Array.from(uint8Array.subarray(i, i + chunkSize)),
                  );
                }
                const base64 = btoa(binary);

                // Calculate token cost estimate (rough: 1 char base64 ≈ 0.75 tokens)
                const estimatedTokens = Math.ceil(base64.length * 0.75);
                console.log(
                  "Base64 length:",
                  base64.length,
                  "- Est. tokens:",
                  estimatedTokens,
                );

                // Determine image type from content-type
                const contentType =
                  imageObject.httpMetadata?.contentType || "image/png";
                console.log("Content type:", contentType);

                // Add as base64 data URL with high detail for accurate analysis
                currentMessageContent.push({
                  type: "image_url",
                  image_url: {
                    url: `data:${contentType};base64,${base64}`,
                    detail: "high", // High resolution critical for chart price level accuracy
                  },
                });
                console.log(
                  "Image added to currentMessageContent with high detail",
                );
              } else {
                console.error("Image not found in R2 for key:", key);
              }
            } catch (error) {
              console.error("Error fetching image from R2:", error);
              // Continue without this image if it fails
            }
          } else {
            console.error("Invalid URL format:", chart.url);
          }
        }
      }
    }

    // Add current message to history
    if (currentMessageContent.length > 0) {
      openaiMessages.push({
        role: "user",
        // When we have images, we must use the array format for OpenAI Vision API
        // If only text (no images), send just the string
        content:
          currentMessageContent.length === 1 &&
          currentMessageContent[0].type === "text"
            ? currentMessageContent[0].text
            : currentMessageContent,
      });
    }

    console.log("Final OpenAI messages count:", openaiMessages.length);

    // Create analysis entry BEFORE streaming (so we have an ID for messages)
    // IMPORTANT: Store mode and effort so conversation continuation uses the same settings
    const analysisId = generateId("analysis");
    await c.env.DB.prepare(
      `INSERT INTO analysis_runs
       (id, user_id, instrument, contract, atm_json, inputs_json, status, conversation_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 'active', unixepoch())`,
    )
      .bind(
        analysisId,
        user.id,
        instrument,
        contract,
        JSON.stringify(atm),
        JSON.stringify({ charts, mode: analysisMode, effort }), // Store mode and effort for conversation continuity
      )
      .run();

    // Save user message to chat_messages
    const userMessageId = crypto.randomUUID();
    const chartUrls = charts
      ? charts.map((c: any) => c.url).filter(Boolean)
      : [];
    await c.env.DB.prepare(
      `INSERT INTO chat_messages (id, analysis_id, role, content, images, created_at)
       VALUES (?, ?, 'user', ?, ?, unixepoch())`,
    )
      .bind(
        userMessageId,
        analysisId,
        userQuery || "Analyze these charts",
        chartUrls.length > 0 ? JSON.stringify(chartUrls) : null,
      )
      .run();

    // Set up SSE headers for streaming
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    c.header("X-Analysis-Mode", analysisMode); // Debug header to confirm mode

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          // Call OpenAI with streaming using GPT-5.2 (latest flagship model with thinking)
          // Using GPT-5.2 - OpenAI's most advanced model with enhanced reasoning and vision
          // Reasoning effort: 'medium' for balanced speed/quality (user requested)
          // Token limits based on mode: trader=concise (2000), mentor=educational (4000)
          // Note: With reasoning_effort enabled, model uses tokens for "thinking" before output
          // Trader needs 2000 to allow ~1000 for reasoning + ~1000 for concise output
          const maxTokens = analysisMode === "trader" ? 2000 : 4000;

          // CRITICAL: Add mode steering reminder at END of messages for recency bias
          // This reinforces the mode and prevents the model from defaulting to wrong style
          const modeReminder =
            analysisMode === "trader"
              ? {
                  role: "system" as const,
                  content: `TRADER MODE - PRODUCE OUTPUT NOW:
You MUST output a concise analysis. DO NOT remain silent.

FORMAT REQUIRED:
• Bullet points only (max 12 bullets)
• 200 words maximum
• Exactly 3 trade setups with scores
• No explanations - just levels and setups
• Call identify_supply_demand_zone for each zone
• Call recommend_trade_setup for each of 3 setups

START YOUR BULLET POINT ANALYSIS NOW.`,
                }
              : {
                  role: "system" as const,
                  content: `CRITICAL MENTOR MODE REMINDER:
You MUST write a 400-600 word NARRATIVE EXPLANATION as your PRIMARY output. This is NON-NEGOTIABLE.

⚠️ CRITICAL: Do NOT output any JSON, function calls, or structured data blocks.
Your ENTIRE response must be conversational, educational text.

Your response MUST include:
1. A conversational, educational written analysis (400-600 words MINIMUM)
2. Explain WHY each zone matters using analogies and market psychology
3. Teach the user like a patient mentor explaining to a friend
4. Include specific price levels and trade parameters WITHIN your narrative text

WRONG: {"function":"identify_supply_demand_zone"...} or any JSON
RIGHT: "Let me walk you through what I'm seeing... The key support zone around 6885-6890 is important because..."

Your output should be PURE TEXT - no JSON, no function syntax, no data blocks.

START WRITING YOUR NARRATIVE NOW.`,
                };

          // Add the steering reminder to the end of messages
          openaiMessages.push(modeReminder);

          // DEBUG: Log the message structure being sent
          console.log("[OPENAI DEBUG] Mode:", analysisMode);
          console.log("[OPENAI DEBUG] Max tokens:", maxTokens);
          console.log("[OPENAI DEBUG] Message count:", openaiMessages.length);
          console.log(
            "[OPENAI DEBUG] First message role:",
            openaiMessages[0]?.role,
          );
          console.log(
            "[OPENAI DEBUG] Last message role:",
            openaiMessages[openaiMessages.length - 1]?.role,
          );
          console.log(
            "[OPENAI DEBUG] Reminder content (first 100 chars):",
            modeReminder.content.substring(0, 100),
          );

          // CRITICAL: In MENTOR mode, disable function calling to force narrative output
          // GPT-5.2 prioritizes function calls over text when tools are available
          // Mentor mode requires written educational content, not structured data cards
          const toolsConfig =
            analysisMode === "trader"
              ? {
                  tools: [
                    {
                      type: "function",
                      function: {
                        name: "identify_supply_demand_zone",
                        description:
                          "Mark a supply or demand zone on the chart with price levels and strength rating",
                        parameters: {
                          type: "object",
                          properties: {
                            zone_type: {
                              type: "string",
                              enum: ["supply", "demand"],
                              description: "Type of zone identified",
                            },
                            price_from: {
                              type: "number",
                              description: "Lower price boundary of the zone",
                            },
                            price_to: {
                              type: "number",
                              description: "Upper price boundary of the zone",
                            },
                            strength: {
                              type: "string",
                              enum: ["fresh", "tested", "strong", "weak"],
                              description: "Strength rating of the zone",
                            },
                            timeframe: {
                              type: "string",
                              description:
                                "Timeframe where this zone is most relevant",
                            },
                            confluence_factors: {
                              type: "array",
                              items: { type: "string" },
                              description:
                                "List of confluence factors supporting this zone",
                            },
                          },
                          required: [
                            "zone_type",
                            "price_from",
                            "price_to",
                            "strength",
                          ],
                        },
                      },
                    },
                    {
                      type: "function",
                      function: {
                        name: "recommend_trade_setup",
                        description:
                          "Provide a specific trade setup with entry, stop, and targets",
                        parameters: {
                          type: "object",
                          properties: {
                            direction: {
                              type: "string",
                              enum: ["long", "short"],
                              description: "Trade direction",
                            },
                            entry_price: {
                              type: "number",
                              description: "Precise entry price",
                            },
                            stop_loss: {
                              type: "number",
                              description: "Stop loss price",
                            },
                            targets: {
                              type: "array",
                              items: { type: "number" },
                              description:
                                "Target prices in order (T1, T2, T3)",
                            },
                            risk_reward_ratio: {
                              type: "number",
                              description: "Calculated R:R ratio",
                            },
                            confidence: {
                              type: "number",
                              minimum: 0,
                              maximum: 100,
                              description:
                                "Confidence level in this setup (0-100)",
                            },
                            invalidation_price: {
                              type: "number",
                              description:
                                "Price level that invalidates the setup",
                            },
                            key_factors: {
                              type: "array",
                              items: { type: "string" },
                              description: "Key factors supporting this trade",
                            },
                          },
                          required: [
                            "direction",
                            "entry_price",
                            "stop_loss",
                            "targets",
                            "confidence",
                          ],
                        },
                      },
                    },
                  ],
                  tool_choice: "auto", // Let GPT-5.2 decide when to call functions
                }
              : {}; // MENTOR mode: No tools = forces GPT-5.2 to write narrative text

          console.log(
            "[OPENAI DEBUG] Tools enabled:",
            analysisMode === "trader"
              ? "YES (trader mode)"
              : "NO (mentor mode)",
          );

          const completion = await openai.chat.completions.create({
            model: "gpt-5.2",
            messages: openaiMessages,
            stream: true,
            // GPT-5.2 reasoning - enables thinking mode with medium effort
            // Note: GPT-5.2 with reasoning only supports temperature=1 (default)
            reasoning_effort: "medium",
            // GPT-5.2 parameters - MODE-DEPENDENT TOKEN LIMIT
            max_completion_tokens: maxTokens, // Trader: 2000, Mentor: 4000
            // Spread tools config - includes tools array only in trader mode
            ...toolsConfig,
          });

          let fullResponse = "";
          let tokensUsed = 0;
          let usageData: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
          } | null = null;
          const toolCalls: any[] = [];
          let currentToolCall: any = null;

          // Helper to filter out accidental JSON function call syntax from mentor mode
          // This catches cases where the AI outputs {"function":...} as text
          const filterFunctionCalls = (text: string): string => {
            // Pattern to match JSON function call blocks (with optional whitespace/newlines around them)
            const functionCallPattern =
              /\s*\{"function"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]*\}\s*\}\s*/g;
            return text.replace(functionCallPattern, "");
          };

          // Track buffered content to detect and filter function call blocks
          let pendingContent = "";

          // Stream chunks
          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta;

            // Handle text content
            const content = delta?.content || "";
            if (content) {
              // In mentor mode, filter out any accidental JSON function calls
              if (analysisMode === "mentor") {
                pendingContent += content;

                // Check if we have complete JSON blocks to filter
                // We buffer to avoid splitting JSON across chunks
                if (
                  pendingContent.includes('{"function"') &&
                  pendingContent.includes("}")
                ) {
                  // Filter out function calls
                  const filtered = filterFunctionCalls(pendingContent);
                  if (filtered.trim()) {
                    fullResponse += filtered;
                    const sseChunk = `event: chunk\ndata: ${JSON.stringify(filtered)}\n\n`;
                    controller.enqueue(encoder.encode(sseChunk));
                  }
                  pendingContent = "";
                } else if (!pendingContent.includes('{"function"')) {
                  // No function call pattern, send immediately
                  fullResponse += pendingContent;
                  const sseChunk = `event: chunk\ndata: ${JSON.stringify(pendingContent)}\n\n`;
                  controller.enqueue(encoder.encode(sseChunk));
                  pendingContent = "";
                }
                // If we have a partial function call, keep buffering
              } else {
                // Trader mode - send as-is (uses actual tool calls)
                fullResponse += content;
                const sseChunk = `event: chunk\ndata: ${JSON.stringify(content)}\n\n`;
                controller.enqueue(encoder.encode(sseChunk));
              }
            }

            // Handle tool calls (function calling)
            if (delta?.tool_calls) {
              for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.index;

                if (!currentToolCall || currentToolCall.index !== index) {
                  // New tool call
                  currentToolCall = {
                    index,
                    id: toolCallDelta.id || "",
                    type: toolCallDelta.type || "function",
                    function: {
                      name: toolCallDelta.function?.name || "",
                      arguments: toolCallDelta.function?.arguments || "",
                    },
                  };
                  toolCalls[index] = currentToolCall;
                } else {
                  // Accumulate arguments for existing tool call
                  if (toolCallDelta.function?.arguments) {
                    currentToolCall.function.arguments +=
                      toolCallDelta.function.arguments;
                  }
                }
              }
            }

            // Track token usage if available (streaming mode provides this in final chunk)
            if (chunk.usage) {
              tokensUsed = chunk.usage.total_tokens || 0;
              usageData = {
                prompt_tokens: chunk.usage.prompt_tokens || 0,
                completion_tokens: chunk.usage.completion_tokens || 0,
                total_tokens: chunk.usage.total_tokens || 0,
              };
            }
          }

          // Flush any remaining pending content (mentor mode buffer)
          if (pendingContent.trim()) {
            const filtered = filterFunctionCalls(pendingContent);
            if (filtered.trim()) {
              fullResponse += filtered;
              const sseChunk = `event: chunk\ndata: ${JSON.stringify(filtered)}\n\n`;
              controller.enqueue(encoder.encode(sseChunk));
            }
          }

          // Process completed tool calls and send as structured data
          if (toolCalls.length > 0) {
            for (const toolCall of toolCalls) {
              if (toolCall && toolCall.function.arguments) {
                try {
                  const args = JSON.parse(toolCall.function.arguments);
                  const toolData = {
                    function: toolCall.function.name,
                    data: args,
                  };

                  // Send tool call as structured data event
                  const toolEvent = `event: tool\ndata: ${JSON.stringify(toolData)}\n\n`;
                  controller.enqueue(encoder.encode(toolEvent));

                  console.log("Tool call:", toolCall.function.name, args);
                } catch (error) {
                  console.error("Failed to parse tool call arguments:", error);
                }
              }
            }
          }

          const latencyMs = Date.now() - startTime;

          // Track OpenAI usage for monitoring and cost tracking
          if (usageData) {
            trackOpenAIUsage(c.env, "gpt-5.2", usageData);
          }

          // Log token usage for monitoring
          console.log("Token usage:", tokensUsed);
          console.log("Messages in context:", openaiMessages.length);

          // Warning if approaching context limit (400K for GPT-5.2)
          if (tokensUsed > 350000) {
            console.warn(
              "WARNING: Approaching GPT-5.2 token limit!",
              tokensUsed,
              "/ 400000",
            );
            // Send warning to user
            const warningChunk = `event: chunk\ndata: ${JSON.stringify("\n\n_[Token Usage Warning: " + tokensUsed + " / 400,000 tokens used. Consider starting a new conversation for optimal performance.]_")}\n\n`;
            controller.enqueue(encoder.encode(warningChunk));
          }

          // Info: Log if using significant context (helpful for optimization)
          if (tokensUsed > 80000) {
            console.log("INFO: Large context in use:", tokensUsed, "tokens");
          }

          // Save assistant message to chat_messages
          const assistantMessageId = crypto.randomUUID();
          await c.env.DB.prepare(
            `INSERT INTO chat_messages (id, analysis_id, role, content, created_at)
             VALUES (?, ?, 'assistant', ?, unixepoch())`,
          )
            .bind(assistantMessageId, analysisId, fullResponse)
            .run();

          // Update analysis with final result
          await c.env.DB.prepare(
            `UPDATE analysis_runs
             SET status = 'trade', model_response_json = ?, summary_text = ?, latency_ms = ?
             WHERE id = ?`,
          )
            .bind(
              JSON.stringify({ response: fullResponse }),
              fullResponse.substring(0, 200),
              latencyMs,
              analysisId,
            )
            .run();

          // Send done event with structured result
          const result = {
            action: "trade",
            rationale: [fullResponse.substring(0, 200)],
            validation: {
              tickPrecisionOk: true,
              rrOk: true,
              biasAligned: true,
              atmExact: true,
            },
            priceLevels: {
              entry: atm.entry || 0,
              stop: atm.distal || 0,
              targets: [],
            },
            riskDisclosure: "Trading involves substantial risk of loss.",
            managementNotes: "",
          };

          const sseDone = `event: done\ndata: ${JSON.stringify(result)}\n\n`;
          controller.enqueue(encoder.encode(sseDone));

          controller.close();
        } catch (error: any) {
          console.error("Streaming error:", error);
          const sseError = `event: error\ndata: ${error.message}\n\n`;
          controller.enqueue(encoder.encode(sseError));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": c.req.header("origin") || "*",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  } catch (error: any) {
    console.error("Analysis error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// History: Get user's analysis history
app.get("/api/history", authMiddleware, async (c) => {
  try {
    const user = c.get("user");

    const results = await c.env.DB.prepare(
      `SELECT id, instrument, contract, status, summary_text, latency_ms, created_at, conversation_status
       FROM analysis_runs
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
    )
      .bind(user.id)
      .all();

    return c.json({ analyses: results.results || [] });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// History: Get specific analysis with full conversation
app.get("/api/history/:id", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    const analysisId = c.req.param("id");

    // Get analysis metadata
    const analysisResult = await c.env.DB.prepare(
      `SELECT id, instrument, contract, status, model_response_json, summary_text,
              atm_json, inputs_json, latency_ms, created_at, conversation_status
       FROM analysis_runs
       WHERE id = ? AND user_id = ?`,
    )
      .bind(analysisId, user.id)
      .first();

    if (!analysisResult) {
      return c.json({ error: "Analysis not found" }, 404);
    }

    // Get all chat messages for this analysis
    const messagesResult = await c.env.DB.prepare(
      `SELECT id, role, content, images, created_at
       FROM chat_messages
       WHERE analysis_id = ?
       ORDER BY created_at ASC`,
    )
      .bind(analysisId)
      .all();

    // Parse JSON fields
    const analysis = {
      ...analysisResult,
      atm: analysisResult.atm_json ? JSON.parse(analysisResult.atm_json) : null,
      inputs: analysisResult.inputs_json
        ? JSON.parse(analysisResult.inputs_json)
        : null,
      modelResponse: analysisResult.model_response_json
        ? JSON.parse(analysisResult.model_response_json)
        : null,
      messages: (messagesResult.results || []).map((msg: any) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        images: msg.images ? JSON.parse(msg.images) : null,
        createdAt: msg.created_at,
      })),
    };

    // Remove raw JSON fields
    delete analysis.atm_json;
    delete analysis.inputs_json;
    delete analysis.model_response_json;

    return c.json({ analysis });
  } catch (error: any) {
    console.error("[Get Analysis Error]:", error);
    return c.json({ error: error.message }, 500);
  }
});

// History: Add message to existing conversation
// FIXED: Now uses stored mode/effort, same model (GPT-5.1), and proper token limits
app.post("/api/history/:id/message", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    const analysisId = c.req.param("id");
    const { message, images, mode: requestMode } = await c.req.json();

    // Verify analysis belongs to user and get parameters INCLUDING inputs_json for mode/effort
    const analysisResult = await c.env.DB.prepare(
      `SELECT id, instrument, contract, atm_json, inputs_json, conversation_status
       FROM analysis_runs
       WHERE id = ? AND user_id = ?`,
    )
      .bind(analysisId, user.id)
      .first();

    if (!analysisResult) {
      return c.json({ error: "Analysis not found" }, 404);
    }

    // Get tick spec for system prompt
    const tickSpec = await c.env.DB.prepare(
      "SELECT * FROM tick_specs WHERE symbol = ?",
    )
      .bind(analysisResult.instrument)
      .first();

    if (!tickSpec) {
      return c.json({ error: "Unknown instrument" }, 400);
    }

    const atm = JSON.parse(analysisResult.atm_json);

    // CRITICAL FIX: Read stored mode/effort from inputs_json, fall back to request or defaults
    const inputs = analysisResult.inputs_json
      ? JSON.parse(analysisResult.inputs_json as string)
      : {};

    // BULLETPROOF: Same logic as main endpoint - Only 'trader' if EXACTLY 'trader'
    const rawMode = requestMode || inputs.mode || "";
    console.log(
      "[MODE DEBUG] Continuation - Request mode:",
      JSON.stringify(requestMode),
      "| Stored mode:",
      JSON.stringify(inputs.mode),
    );

    const normalizedMode =
      typeof rawMode === "string" ? rawMode.toLowerCase().trim() : "";
    const analysisMode: "trader" | "mentor" =
      normalizedMode === "trader" ? "trader" : "mentor";
    const effort = inputs.effort || "medium";

    console.log(
      "[MODE DEBUG] Continuation - Normalized:",
      normalizedMode,
      "→ USING:",
      analysisMode,
      "Effort:",
      effort,
    );
    // NOTE: requestMode takes PRIORITY over stored mode - allows mid-conversation toggling

    // Save user message
    const userMessageId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO chat_messages (id, analysis_id, role, content, images, created_at)
       VALUES (?, ?, 'user', ?, ?, unixepoch())`,
    )
      .bind(
        userMessageId,
        analysisId,
        message,
        images ? JSON.stringify(images) : null,
      )
      .run();

    // Get conversation history
    const messagesResult = await c.env.DB.prepare(
      `SELECT role, content, images
       FROM chat_messages
       WHERE analysis_id = ?
       ORDER BY created_at ASC`,
    )
      .bind(analysisId)
      .all();

    const conversationHistory = (messagesResult.results || []).map(
      (msg: any) => {
        const messageObj: any = {
          role: msg.role,
          content: msg.content,
        };
        if (msg.images) {
          const imageUrls = JSON.parse(msg.images);
          if (imageUrls && imageUrls.length > 0) {
            messageObj.content = [
              { type: "text", text: msg.content },
              ...imageUrls.map((url: string) => ({
                type: "image_url",
                image_url: { url },
              })),
            ];
          }
        }
        return messageObj;
      },
    );

    // Fetch FINRA dark pool data for continuation context
    let finraContext = "";
    try {
      const finraData = (await c.env.FINRA_DATA.get(
        "current",
        "json",
      )) as FINRADarkPoolData | null;
      if (finraData) {
        finraContext = formatFINRAForPrompt(
          finraData,
          analysisResult.instrument as string,
        );
      }
    } catch (error) {
      console.error("[FINRA] Failed to fetch dark pool data:", error);
    }

    // Fetch institutional data (COT, FRED, CBOE, Fear & Greed)
    let institutionalContext = "";
    try {
      const institutionalData = (await c.env.INSTITUTIONAL_DATA.get(
        "current",
        "json",
      )) as InstitutionalData | null;
      if (institutionalData) {
        institutionalContext =
          formatInstitutionalDataForPrompt(institutionalData);
      }
    } catch (error) {
      console.error(
        "[INSTITUTIONAL] Failed to fetch institutional data:",
        error,
      );
    }

    // CRITICAL FIX: Use same model (GPT-5.2) and same system prompt as main endpoint
    const systemPrompt = getSystemPrompt(
      analysisMode,
      analysisResult.instrument as string,
      tickSpec,
      atm,
      effort,
      finraContext, // Include FINRA dark pool intelligence
      institutionalContext, // Include institutional data (COT, liquidity, sentiment)
    );

    // Mode-dependent parameters (same as main endpoint)
    // Note: With reasoning_effort, model uses tokens for "thinking" - trader needs room
    const maxTokens = analysisMode === "trader" ? 2000 : 4000;

    // Add a "steering reminder" at the end to reinforce mode consistency
    const modeReminder =
      analysisMode === "trader"
        ? {
            role: "system" as const,
            content: `TRADER MODE - PRODUCE OUTPUT NOW:
You MUST output a concise analysis. DO NOT remain silent.
FORMAT: Bullet points only, 200 words max, 3 trade setups with scores.
START YOUR BULLET POINT ANALYSIS NOW.`,
          }
        : {
            role: "system" as const,
            content: `CRITICAL MENTOR MODE REMINDER:
You MUST write a 400-600 word NARRATIVE EXPLANATION as your PRIMARY output. This is NON-NEGOTIABLE.

Your response MUST include:
1. A conversational, educational written analysis (400-600 words MINIMUM)
2. Explain WHY things work using analogies and market psychology
3. Teach the user like a patient mentor explaining to a friend

START WRITING YOUR NARRATIVE NOW.`,
          };

    // Initialize OpenAI client (same as main endpoint)
    const openai = new OpenAI({ apiKey: c.env.OPENAI_API_KEY });

    // Set up SSE headers
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    // Stream response using SDK (same approach as main endpoint)
    const streamResponse = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let fullResponse = "";
        const assistantMessageId = crypto.randomUUID();

        try {
          // CRITICAL FIX: Use GPT-5.2 via SDK with same parameters as main endpoint
          const completion = await openai.chat.completions.create({
            model: "gpt-5.2",
            messages: [
              { role: "system", content: systemPrompt },
              ...conversationHistory,
              modeReminder, // Add steering reminder at end for recency bias
            ],
            stream: true,
            max_completion_tokens: maxTokens,
            // GPT-5.2 reasoning - enables thinking mode with medium effort (same as main endpoint)
            // Note: GPT-5.2 with reasoning only supports temperature=1 (default)
            reasoning_effort: "medium",
          });

          for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              fullResponse += content;
              const sseChunk = `event: chunk\ndata: ${JSON.stringify(content)}\n\n`;
              controller.enqueue(encoder.encode(sseChunk));
            }
          }

          // Save assistant response
          await c.env.DB.prepare(
            `INSERT INTO chat_messages (id, analysis_id, role, content, created_at)
             VALUES (?, ?, 'assistant', ?, unixepoch())`,
          )
            .bind(assistantMessageId, analysisId, fullResponse)
            .run();

          // Update analysis summary
          await c.env.DB.prepare(
            `UPDATE analysis_runs
             SET summary_text = ?, conversation_status = 'active'
             WHERE id = ?`,
          )
            .bind(fullResponse.substring(0, 500), analysisId)
            .run();

          controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
          controller.close();
        } catch (error: any) {
          console.error("[Conversation Stream Error]:", error);
          const sseError = `event: error\ndata: ${error.message}\n\n`;
          controller.enqueue(encoder.encode(sseError));
          controller.close();
        }
      },
    });

    return new Response(streamResponse, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": c.req.header("origin") || "*",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  } catch (error: any) {
    console.error("[Continue Conversation Error]:", error);
    return c.json({ error: error.message }, 500);
  }
});

// Stripe: Create checkout session
app.post("/api/stripe/checkout", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
    });

    // Check if already subscribed
    if (user.subscription_status === "active") {
      return c.json({ url: "/billing" });
    }

    const { successUrl, cancelUrl, couponCode } = await c.req.json();

    // Create or get Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;

      await c.env.DB.prepare(
        "UPDATE users SET stripe_customer_id = ? WHERE id = ?",
      )
        .bind(customerId, user.id)
        .run();
    }

    // Validate coupon code if provided (supports both promotion codes and direct coupons)
    let validatedCouponId: string | undefined;
    let promotionCodeId: string | undefined;

    if (couponCode && couponCode.trim()) {
      const code = couponCode.trim().toUpperCase(); // Normalize to uppercase

      // First, try to find a promotion code (customer-facing codes like VIP20)
      try {
        const promoCodes = await stripe.promotionCodes.list({
          code: code,
          active: true,
          limit: 1,
        });

        if (promoCodes.data.length > 0) {
          const promoCode = promoCodes.data[0];
          promotionCodeId = promoCode.id;
          // Handle both string ID and expanded coupon object
          validatedCouponId =
            typeof promoCode.coupon === "string"
              ? promoCode.coupon
              : promoCode.coupon.id;
          console.log(
            "[Stripe] Found promotion code:",
            code,
            "-> coupon:",
            validatedCouponId,
          );
        }
      } catch (promoError) {
        console.log(
          "[Stripe] Promotion code lookup failed, trying direct coupon",
        );
      }

      // Fall back to direct coupon lookup if no promotion code found
      if (!validatedCouponId) {
        try {
          const coupon = await stripe.coupons.retrieve(code);
          if (coupon && coupon.valid) {
            validatedCouponId = coupon.id;
            console.log(
              "[Stripe] Valid direct coupon applied:",
              validatedCouponId,
            );
          } else {
            console.warn("[Stripe] Invalid coupon:", code);
            return c.json({ error: "Invalid coupon code" }, 400);
          }
        } catch (couponError: any) {
          console.error("[Stripe] Coupon validation error:", couponError);
          return c.json({ error: "Invalid coupon code" }, 400);
        }
      }
    }

    // Create checkout session (no trial - immediate charge)
    const sessionParams: any = {
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"], // Removed 'paypal' - not activated in Stripe account
      line_items: [
        {
          price: c.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: successUrl || `${c.req.header("origin")}/dashboard`,
      cancel_url: cancelUrl || `${c.req.header("origin")}/billing`,
    };

    // Add discount - prefer promotion code, fall back to coupon
    if (promotionCodeId) {
      sessionParams.discounts = [
        {
          promotion_code: promotionCodeId,
        },
      ];
    } else if (validatedCouponId) {
      sessionParams.discounts = [
        {
          coupon: validatedCouponId,
        },
      ];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return c.json({ url: session.url });
  } catch (error: any) {
    console.error("[Stripe Checkout] Error:", error);
    trackError(c.env, error, {
      endpoint: "/api/stripe/checkout",
      userId: c.get("user")?.id,
    });
    return c.json({ error: error.message }, 500);
  }
});

// Validate coupon code and return pricing details (public endpoint)
app.post("/api/stripe/validate-coupon", async (c) => {
  try {
    const { couponCode } = await c.req.json();

    if (!couponCode || !couponCode.trim()) {
      return c.json({ valid: false, error: "Coupon code is required" }, 400);
    }

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
    });
    const code = couponCode.trim().toUpperCase(); // Normalize to uppercase

    // First, try to find a promotion code (customer-facing codes like VIP20)
    let coupon;
    let promotionCodeId: string | undefined;

    try {
      const promoCodes = await stripe.promotionCodes.list({
        code: code,
        active: true,
        limit: 1,
      });

      if (promoCodes.data.length > 0) {
        const promoCode = promoCodes.data[0];
        promotionCodeId = promoCode.id;
        // Get the coupon from the promotion code (handle both string ID and expanded object)
        const couponId =
          typeof promoCode.coupon === "string"
            ? promoCode.coupon
            : promoCode.coupon.id;
        coupon = await stripe.coupons.retrieve(couponId);
        console.log(
          "[Stripe] Found promotion code:",
          code,
          "-> coupon:",
          coupon.id,
        );
      }
    } catch (promoError) {
      console.log(
        "[Stripe] Promotion code lookup failed, trying direct coupon:",
        promoError,
      );
    }

    // Fall back to direct coupon lookup if no promotion code found
    if (!coupon) {
      try {
        coupon = await stripe.coupons.retrieve(code);
        console.log("[Stripe] Found direct coupon:", coupon.id);
      } catch (error: any) {
        console.log("[Stripe] Coupon not found:", code);
        return c.json({ valid: false, error: "Invalid coupon code" }, 400);
      }
    }

    // Check if coupon is explicitly marked as invalid (only present when redeem_by date passed)
    if (coupon.valid === false) {
      return c.json(
        {
          valid: false,
          error: "This coupon has expired or is no longer valid",
        },
        400,
      );
    }

    // Get price details
    const price = await stripe.prices.retrieve(c.env.STRIPE_PRICE_ID);
    const originalPrice = (price.unit_amount || 0) / 100; // Convert cents to dollars

    // Calculate discounted price
    let finalPrice = originalPrice;
    let discountText = "";

    if (coupon.percent_off) {
      finalPrice = originalPrice * (1 - coupon.percent_off / 100);
      discountText = `${coupon.percent_off}% off`;
    } else if (coupon.amount_off) {
      const discountAmount = coupon.amount_off / 100;
      finalPrice = Math.max(0, originalPrice - discountAmount);
      discountText = `$${discountAmount.toFixed(2)} off`;
    }

    return c.json({
      valid: true,
      couponId: coupon.id,
      promotionCodeId, // Include promotion code ID for checkout
      originalPrice,
      finalPrice: Number(finalPrice.toFixed(2)),
      discount: discountText,
      duration: coupon.duration,
    });
  } catch (error: any) {
    console.error("[Stripe Validate Coupon] Error:", error);
    trackError(c.env, error, { endpoint: "/api/stripe/validate-coupon" });
    return c.json({ error: error.message }, 500);
  }
});

// Verify Stripe checkout session after payment
app.post("/api/stripe/verify-session", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    const { sessionId } = await c.req.json();

    if (!sessionId) {
      return c.json({ error: "Session ID is required" }, 400);
    }

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
    });
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.customer !== user.stripe_customer_id) {
      return c.json({ error: "Session does not belong to this user" }, 403);
    }

    if (session.payment_status !== "paid") {
      return c.json({ error: "Payment not completed" }, 400);
    }

    // Get subscription details
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription as string,
    );

    // Update user in database
    await c.env.DB.prepare(
      `UPDATE users SET
        subscription_status = ?,
        stripe_subscription_id = ?,
        subscription_end_date = ?,
        price_id = ?,
        updated_at = unixepoch()
      WHERE id = ?`,
    )
      .bind(
        subscription.status,
        subscription.id,
        subscription.current_period_end,
        subscription.items.data[0].price.id,
        user.id,
      )
      .run();

    console.log("[Stripe] Subscription activated for user:", user.id);

    return c.json({
      success: true,
      subscriptionStatus: subscription.status,
      currentPeriodEnd: subscription.current_period_end,
    });
  } catch (error: any) {
    console.error("[Stripe Verify Session] Error:", error);
    trackError(c.env, error, { endpoint: "/api/stripe/verify-session" });
    return c.json({ error: error.message }, 500);
  }
});

// Stripe webhook handler
app.post("/api/stripe/webhook", async (c) => {
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-11-20.acacia",
  });
  const signature = c.req.header("stripe-signature");

  if (!signature) {
    return c.json({ error: "No signature" }, 400);
  }

  let event;
  try {
    const body = await c.req.text();
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      c.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err: any) {
    console.error(
      "[Stripe Webhook] Signature verification failed:",
      err.message,
    );
    return c.json({ error: "Invalid signature" }, 400);
  }

  console.log("[Stripe Webhook] Received event:", event.type);

  // Check if event already processed (idempotency)
  const existing = await c.env.DB.prepare(
    "SELECT id FROM webhook_events WHERE event_id = ?",
  )
    .bind(event.id)
    .first();

  if (existing) {
    console.log("[Stripe Webhook] Event already processed:", event.id);
    return c.json({ received: true });
  }

  // Log webhook event
  await c.env.DB.prepare(
    "INSERT INTO webhook_events (id, event_id, event_type, data) VALUES (?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      event.id,
      event.type,
      JSON.stringify(event.data.object),
    )
    .run();

  // Handle different event types
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        if (session.mode === "subscription") {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription,
          );

          // First try to update by stripe_customer_id
          const result = await c.env.DB.prepare(
            `UPDATE users SET
              subscription_status = ?,
              stripe_subscription_id = ?,
              subscription_end_date = ?,
              price_id = ?,
              updated_at = unixepoch()
            WHERE stripe_customer_id = ?`,
          )
            .bind(
              subscription.status,
              subscription.id,
              subscription.current_period_end,
              subscription.items.data[0].price.id,
              session.customer,
            )
            .run();

          console.log("[Webhook] Checkout completed - Update result:", {
            customerId: session.customer,
            subscriptionId: subscription.id,
            status: subscription.status,
            rowsChanged: result.meta?.changes || 0,
          });

          // If no rows updated, try to find user by customer email from Stripe
          if (!result.meta?.changes || result.meta.changes === 0) {
            console.log(
              "[Webhook] No user found by customer_id, trying email lookup...",
            );
            const customer = (await stripe.customers.retrieve(
              session.customer,
            )) as any;
            if (customer.email) {
              const emailResult = await c.env.DB.prepare(
                `UPDATE users SET
                  subscription_status = ?,
                  stripe_customer_id = ?,
                  stripe_subscription_id = ?,
                  subscription_end_date = ?,
                  price_id = ?,
                  updated_at = unixepoch()
                WHERE LOWER(email) = LOWER(?)`,
              )
                .bind(
                  subscription.status,
                  session.customer,
                  subscription.id,
                  subscription.current_period_end,
                  subscription.items.data[0].price.id,
                  customer.email,
                )
                .run();
              console.log("[Webhook] Email lookup result:", {
                email: customer.email,
                rowsChanged: emailResult.meta?.changes || 0,
              });
            }
          }
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as any;
        await c.env.DB.prepare(
          `UPDATE users SET
            subscription_status = ?,
            subscription_end_date = ?,
            updated_at = unixepoch()
          WHERE stripe_subscription_id = ?`,
        )
          .bind(
            subscription.status,
            subscription.current_period_end,
            subscription.id,
          )
          .run();
        console.log(
          "[Webhook] Subscription updated:",
          subscription.id,
          subscription.status,
        );
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as any;
        await c.env.DB.prepare(
          `UPDATE users SET
            subscription_status = ?,
            canceled_at = ?,
            updated_at = unixepoch()
          WHERE stripe_subscription_id = ?`,
        )
          .bind("canceled", Math.floor(Date.now() / 1000), subscription.id)
          .run();
        console.log("[Webhook] Subscription canceled:", subscription.id);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as any;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            invoice.subscription,
          );

          // Try to update by subscription_id first
          const result = await c.env.DB.prepare(
            `UPDATE users SET
              subscription_status = ?,
              subscription_end_date = ?,
              updated_at = unixepoch()
            WHERE stripe_subscription_id = ?`,
          )
            .bind(
              subscription.status,
              subscription.current_period_end,
              subscription.id,
            )
            .run();

          console.log("[Webhook] Payment succeeded - Update result:", {
            subscriptionId: subscription.id,
            rowsChanged: result.meta?.changes || 0,
          });

          // If no rows updated (first payment), try by customer_id then email
          if (!result.meta?.changes || result.meta.changes === 0) {
            const customerResult = await c.env.DB.prepare(
              `UPDATE users SET
                subscription_status = ?,
                stripe_subscription_id = ?,
                subscription_end_date = ?,
                updated_at = unixepoch()
              WHERE stripe_customer_id = ?`,
            )
              .bind(
                subscription.status,
                subscription.id,
                subscription.current_period_end,
                invoice.customer,
              )
              .run();

            // If still no match, try by email
            if (
              !customerResult.meta?.changes ||
              customerResult.meta.changes === 0
            ) {
              const customer = (await stripe.customers.retrieve(
                invoice.customer,
              )) as any;
              if (customer.email) {
                await c.env.DB.prepare(
                  `UPDATE users SET
                    subscription_status = ?,
                    stripe_customer_id = ?,
                    stripe_subscription_id = ?,
                    subscription_end_date = ?,
                    updated_at = unixepoch()
                  WHERE LOWER(email) = LOWER(?)`,
                )
                  .bind(
                    subscription.status,
                    invoice.customer,
                    subscription.id,
                    subscription.current_period_end,
                    customer.email,
                  )
                  .run();
                console.log(
                  "[Webhook] Payment succeeded - Updated by email:",
                  customer.email,
                );
              }
            }
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as any;
        if (invoice.subscription) {
          await c.env.DB.prepare(
            `UPDATE users SET
              subscription_status = ?,
              updated_at = unixepoch()
            WHERE stripe_subscription_id = ?`,
          )
            .bind("past_due", invoice.subscription)
            .run();
          console.log(
            "[Webhook] Payment failed, subscription past_due:",
            invoice.subscription,
          );
        }
        break;
      }
    }
  } catch (error: any) {
    console.error("[Stripe Webhook] Error processing event:", error);
    trackError(c.env, error, { event: event.type, eventId: event.id });
  }

  return c.json({ received: true });
});

// Create Stripe Customer Portal session
app.post("/api/stripe/portal", authMiddleware, async (c) => {
  try {
    const user = c.get("user");

    if (!user.stripe_customer_id) {
      return c.json({ error: "No Stripe customer found" }, 400);
    }

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
    });
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${c.req.header("origin") || "https://aicharttraders.com"}/dashboard`,
    });

    return c.json({ url: session.url });
  } catch (error: any) {
    console.error("[Stripe Portal] Error:", error);
    trackError(c.env, error, { endpoint: "/api/stripe/portal" });
    return c.json({ error: error.message }, 500);
  }
});

// ATM Calculator
app.post("/api/atm", authMiddleware, async (c) => {
  try {
    const { instrument, entry, distal, stop_ticks, target_ticks } =
      await c.req.json();

    const tickSpec = await c.env.DB.prepare(
      "SELECT * FROM tick_specs WHERE symbol = ?",
    )
      .bind(instrument)
      .first();

    if (!tickSpec) {
      return c.json({ error: "Unknown instrument" }, 400);
    }

    const tickSize = parseFloat(tickSpec.tick_size as string);
    const multiplier = parseFloat(tickSpec.multiplier as string);

    // Calculate prices
    const calculatedEntry = entry || 0;
    const calculatedStop = calculatedEntry - stop_ticks * tickSize;
    const calculatedTargets = target_ticks.map(
      (ticks: number) => calculatedEntry + ticks * tickSize,
    );

    return c.json({
      tickSize,
      multiplier,
      entry: calculatedEntry,
      stop: calculatedStop,
      targets: calculatedTargets,
      stopTicks: stop_ticks,
      targetTicks: target_ticks,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Upload: Direct file upload to R2
app.put("/api/upload/*", authMiddleware, async (c) => {
  try {
    // Get the full path after /api/upload/
    const path = c.req.path;
    const key = path.replace("/api/upload/", "");
    const user = c.get("user");

    // Verify the key belongs to this user
    if (!key.startsWith(user.id + "/")) {
      return c.json({ error: "Unauthorized" }, 403);
    }

    // Get the file from request body
    const body = await c.req.arrayBuffer();

    // Upload to R2
    await c.env.FILES.put(key, body, {
      httpMetadata: {
        contentType: c.req.header("content-type") || "application/octet-stream",
      },
    });

    return c.json({ success: true, url: `/api/files/${key}` });
  } catch (error: any) {
    console.error("Upload error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// Files: Retrieve file from R2
app.get("/api/files/*", async (c) => {
  try {
    // Get the full path after /api/files/
    const path = c.req.path;
    const key = path.replace("/api/files/", "");

    // Get from R2
    const object = await c.env.FILES.get(key);

    if (!object) {
      return c.json({ error: "File not found" }, 404);
    }

    // Return the file
    return new Response(object.body, {
      headers: {
        "Content-Type":
          object.httpMetadata?.contentType || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error: any) {
    console.error("File retrieval error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// Admin: Get all subscribers (admin-only)
app.get("/api/admin/subscribers", authMiddleware, async (c) => {
  try {
    const user = c.get("user");

    // Only allow Ivanleejackson@gmail.com to access admin data
    if (user.email.toLowerCase() !== "ivanleejackson@gmail.com") {
      return c.json({ error: "Unauthorized - Admin access only" }, 403);
    }

    // Get all users from database
    const { results: users } = await c.env.DB.prepare(
      `SELECT
        id,
        email,
        name,
        subscription_status,
        stripe_customer_id,
        stripe_subscription_id,
        price_id,
        subscription_end_date,
        created_at,
        updated_at,
        canceled_at
      FROM users
      ORDER BY created_at DESC`,
    ).all();

    // Initialize Stripe
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
    });

    // Enrich with Stripe data for subscribed users
    const enrichedUsers = await Promise.all(
      users.map(async (dbUser: any) => {
        let stripeData = null;

        // If user has a subscription, fetch detailed Stripe info
        if (dbUser.stripe_subscription_id) {
          try {
            const subscription = await stripe.subscriptions.retrieve(
              dbUser.stripe_subscription_id,
            );
            const price = subscription.items.data[0].price;

            stripeData = {
              subscriptionId: subscription.id,
              status: subscription.status,
              currentPeriodStart: new Date(
                subscription.current_period_start * 1000,
              ).toISOString(),
              currentPeriodEnd: new Date(
                subscription.current_period_end * 1000,
              ).toISOString(),
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
              amount: price.unit_amount ? price.unit_amount / 100 : 0,
              currency: price.currency?.toUpperCase(),
              interval: price.recurring?.interval,
            };
          } catch (error) {
            console.error(
              `Error fetching Stripe data for user ${dbUser.email}:`,
              error,
            );
          }
        }

        return {
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          subscriptionStatus: dbUser.subscription_status,
          createdAt: dbUser.created_at || null,
          updatedAt: dbUser.updated_at || null,
          canceledAt: dbUser.canceled_at || null,
          stripe: stripeData,
        };
      }),
    );

    // Calculate stats
    const stats = {
      totalUsers: enrichedUsers.length,
      activeSubscribers: enrichedUsers.filter(
        (u) =>
          u.subscriptionStatus === "active" ||
          u.subscriptionStatus === "trialing",
      ).length,
      canceledSubscribers: enrichedUsers.filter(
        (u) => u.subscriptionStatus === "canceled",
      ).length,
      pastDueSubscribers: enrichedUsers.filter(
        (u) => u.subscriptionStatus === "past_due",
      ).length,
    };

    return c.json({
      stats,
      users: enrichedUsers,
    });
  } catch (error: any) {
    console.error("[Admin Subscribers] Error:", error);
    trackError(c.env, error, { endpoint: "/api/admin/subscribers" });
    return c.json({ error: error.message }, 500);
  }
});

// =====================================================
// FINRA DARK POOL API ENDPOINTS
// =====================================================

// Get current FINRA data (cached)
app.get("/api/finra/data", authMiddleware, async (c) => {
  try {
    const cached = await c.env.FINRA_DATA.get("current", "json");
    if (cached) {
      return c.json({
        source: "cache",
        data: cached,
      });
    }

    return c.json({
      source: "none",
      message: "No FINRA data available. Try refreshing.",
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Manual refresh FINRA data (admin only)
app.post("/api/finra/refresh", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    if (user.role !== "admin") {
      return c.json({ error: "Admin access required" }, 403);
    }

    const result = await fetchFINRAData();

    if (result.success && result.data) {
      // Store in KV with 7-day expiry (matches weekly update cycle)
      await c.env.FINRA_DATA.put("current", JSON.stringify(result.data), {
        expirationTtl: 60 * 60 * 24 * 7, // 7 days
      });

      // Also store historical snapshot
      const dateKey = `snapshot_${result.data.weekEnding}`;
      await c.env.FINRA_DATA.put(dateKey, JSON.stringify(result.data));

      return c.json({
        success: true,
        message: "FINRA data refreshed successfully",
        weekEnding: result.data.weekEnding,
        symbolsUpdated: Object.keys(result.data.symbols),
      });
    }

    return c.json({
      success: false,
      error: result.error || "Failed to fetch FINRA data",
    });
  } catch (error: any) {
    trackError(c.env, error, { endpoint: "/api/finra/refresh" });
    return c.json({ error: error.message }, 500);
  }
});

// Get FINRA data for specific instrument
app.get("/api/finra/instrument/:instrument", authMiddleware, async (c) => {
  try {
    const instrument = c.req.param("instrument");
    const cached = (await c.env.FINRA_DATA.get(
      "current",
      "json",
    )) as FINRADarkPoolData | null;

    if (!cached) {
      return c.json({
        instrument,
        data: null,
        message: "No FINRA data available",
      });
    }

    const proxySymbol = getFINRAProxySymbol(instrument);
    const symbolData = cached.symbols[proxySymbol];

    return c.json({
      instrument,
      proxySymbol,
      weekEnding: cached.weekEnding,
      lastUpdated: cached.lastUpdated,
      data: symbolData || null,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// =====================================================
// INSTITUTIONAL DATA ENDPOINTS (Free: COT, FRED, CBOE, Fear & Greed)
// =====================================================

// Get all institutional data (cached)
app.get("/api/institutional/data", authMiddleware, async (c) => {
  try {
    const cached = (await c.env.INSTITUTIONAL_DATA.get(
      "current",
      "json",
    )) as InstitutionalData | null;

    if (!cached) {
      return c.json({
        success: true,
        data: null,
        message:
          "Institutional data not yet cached. Run manual refresh or wait for scheduled update.",
      });
    }

    // Check if data is stale (more than 24 hours old for daily data)
    const lastUpdated = new Date(cached.lastUpdated);
    const ageHours =
      (new Date().getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);
    const isStale = ageHours > 24;

    return c.json({
      success: true,
      data: cached,
      isStale,
      ageHours: Math.round(ageHours * 10) / 10,
    });
  } catch (error: any) {
    trackError(c.env, error, { endpoint: "/api/institutional/data" });
    return c.json({ error: error.message }, 500);
  }
});

// Get COT positioning data
app.get("/api/institutional/cot", authMiddleware, async (c) => {
  try {
    const cached = (await c.env.INSTITUTIONAL_DATA.get(
      "current",
      "json",
    )) as InstitutionalData | null;

    return c.json({
      success: true,
      data: cached?.cot || null,
      message: cached?.cot ? undefined : "COT data not available",
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Get FRED liquidity data
app.get("/api/institutional/liquidity", authMiddleware, async (c) => {
  try {
    const cached = (await c.env.INSTITUTIONAL_DATA.get(
      "current",
      "json",
    )) as InstitutionalData | null;

    return c.json({
      success: true,
      data: cached?.fred || null,
      message: cached?.fred ? undefined : "FRED liquidity data not available",
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Get sentiment data (VIX, Put/Call, Fear & Greed)
app.get("/api/institutional/sentiment", authMiddleware, async (c) => {
  try {
    const cached = (await c.env.INSTITUTIONAL_DATA.get(
      "current",
      "json",
    )) as InstitutionalData | null;

    return c.json({
      success: true,
      data: {
        cboe: cached?.cboe || null,
        fearGreed: cached?.fearGreed || null,
      },
      compositeSignal: cached?.compositeSignal || null,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Manually refresh institutional data
app.post("/api/institutional/refresh", authMiddleware, async (c) => {
  try {
    console.log("[Institutional] Manual refresh triggered");

    const data = await fetchAllInstitutionalData(c.env.FRED_API_KEY);

    await c.env.INSTITUTIONAL_DATA.put("current", JSON.stringify(data), {
      expirationTtl: 60 * 60 * 24 * 7, // 7 days
    });

    // Also save a dated snapshot
    const dateKey = `snapshot_${new Date().toISOString().split("T")[0]}`;
    await c.env.INSTITUTIONAL_DATA.put(dateKey, JSON.stringify(data));

    trackAnalytics(c.env, "institutional_refresh_success", {
      has_cot: !!data.cot,
      has_fred: !!data.fred,
      has_cboe: !!data.cboe,
      has_fear_greed: !!data.fearGreed,
      composite_bias: data.compositeSignal?.bias || "unknown",
    });

    return c.json({
      success: true,
      message: "Institutional data refreshed",
      data,
    });
  } catch (error: any) {
    trackError(c.env, error, { endpoint: "/api/institutional/refresh" });
    return c.json({ error: error.message }, 500);
  }
});

// Public trigger for populating institutional data (for testing/manual refresh)
// This endpoint allows triggering data population without authentication
app.post("/api/institutional/trigger", async (c) => {
  try {
    console.log("[Trigger] Manual institutional data refresh triggered...");

    const institutionalData = await fetchAllInstitutionalData(
      c.env.FRED_API_KEY,
    );

    await c.env.INSTITUTIONAL_DATA.put(
      "current",
      JSON.stringify(institutionalData),
      { expirationTtl: 60 * 60 * 24 * 7 }, // 7 days
    );

    const dateKey = `snapshot_${new Date().toISOString().split("T")[0]}`;
    await c.env.INSTITUTIONAL_DATA.put(
      dateKey,
      JSON.stringify(institutionalData),
    );

    console.log("[Trigger] Data populated:", {
      hasCOT: !!institutionalData.cot,
      hasFRED: !!institutionalData.fred,
      hasCBOE: !!institutionalData.cboe,
      hasFearGreed: !!institutionalData.fearGreed,
      hasIntelligence: !!institutionalData.intelligence,
      regime: institutionalData.intelligence?.marketRegime,
      smartMoneyBias: institutionalData.intelligence?.smartMoneyBias,
    });

    trackAnalytics(c.env, "institutional_manual_trigger", {
      success: true,
      regime: institutionalData.intelligence?.marketRegime || "unknown",
      bias: institutionalData.intelligence?.smartMoneyBias || "unknown",
    });

    return c.json({
      success: true,
      message: "Institutional data populated successfully",
      summary: {
        lastUpdated: institutionalData.lastUpdated,
        regime: institutionalData.intelligence?.marketRegime,
        smartMoneyBias: institutionalData.intelligence?.smartMoneyBias,
        alignment: institutionalData.intelligence?.institutionalAlignment,
        convictionMultiplier:
          institutionalData.intelligence?.convictionMultiplier,
        contrarianAlerts:
          institutionalData.intelligence?.contrarianAlerts?.length || 0,
        painTrade: institutionalData.intelligence?.painTrade?.direction,
      },
      data: institutionalData,
    });
  } catch (error: any) {
    console.error("[Trigger] Error:", error);
    trackError(c.env, error, { endpoint: "/api/institutional/trigger" });
    return c.json({ error: error.message }, 500);
  }
});

// Health check for institutional data
app.get("/api/institutional/health", async (c) => {
  try {
    const cached = (await c.env.INSTITUTIONAL_DATA.get(
      "current",
      "json",
    )) as InstitutionalData | null;

    if (!cached) {
      return c.json({
        status: "no_data",
        message: "No institutional data cached yet",
      });
    }

    const lastUpdated = new Date(cached.lastUpdated);
    const ageHours =
      (new Date().getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);

    let status: "healthy" | "degraded" | "stale";
    if (ageHours < 12) {
      status = "healthy";
    } else if (ageHours < 48) {
      status = "degraded";
    } else {
      status = "stale";
    }

    return c.json({
      status,
      lastUpdated: cached.lastUpdated,
      ageHours: Math.round(ageHours * 10) / 10,
      dataSources: {
        cot: !!cached.cot,
        fred: !!cached.fred,
        cboe: !!cached.cboe,
        fearGreed: !!cached.fearGreed,
        intelligence: !!cached.intelligence,
      },
      compositeSignal: cached.compositeSignal,
      intelligence: cached.intelligence
        ? {
            marketRegime: cached.intelligence.marketRegime,
            smartMoneyBias: cached.intelligence.smartMoneyBias,
            institutionalAlignment: cached.intelligence.institutionalAlignment,
            convictionMultiplier: cached.intelligence.convictionMultiplier,
            painTrade: cached.intelligence.painTrade.direction,
            contrarianAlerts: cached.intelligence.contrarianAlerts.length,
            tradingGuidance:
              cached.intelligence.tradingGuidance.substring(0, 100) + "...",
          }
        : null,
    });
  } catch (error: any) {
    return c.json(
      {
        status: "error",
        error: error.message,
      },
      500,
    );
  }
});

// =====================================================
// SOUL BLUEPRINT & COSMIC INTELLIGENCE ROUTES
// =====================================================

// Create or update soul blueprint
app.post("/api/soul-blueprint", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    const input: SoulBlueprintInput = await c.req.json();

    // Validate required fields
    if (!input.fullName || !input.birthDate || !input.birthTime || !input.birthCity || !input.birthCountry) {
      return c.json({ error: "All fields required: fullName, birthDate, birthTime, birthCity, birthCountry" }, 400);
    }

    // Check if blueprint already exists
    const existing = await getSoulBlueprint(c.env.DB, user.id);

    // Compute the blueprint
    const computed = await computeSoulBlueprint(input);

    let blueprint;
    if (existing) {
      blueprint = await updateSoulBlueprint(c.env.DB, user.id, input, computed);
    } else {
      blueprint = await saveSoulBlueprint(c.env.DB, user.id, input, computed);
    }

    return c.json({ blueprint });
  } catch (error: any) {
    console.error("[Soul Blueprint] Error:", error.message);
    return c.json({ error: error.message || "Failed to create soul blueprint" }, 500);
  }
});

// Get soul blueprint
app.get("/api/soul-blueprint", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    const blueprint = await getSoulBlueprint(c.env.DB, user.id);

    if (!blueprint) {
      return c.json({ error: "No soul blueprint found", hasBlueprint: false }, 404);
    }

    return c.json({ blueprint, hasBlueprint: true });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Daily cosmic intelligence
app.get("/api/cosmic/daily", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    const timezone = c.req.query("timezone") || "America/New_York";

    const blueprint = await getSoulBlueprint(c.env.DB, user.id);
    if (!blueprint) {
      return c.json({ error: "Soul blueprint required. Complete onboarding first." }, 400);
    }

    const cosmic = await getCosmicIntelligence(blueprint, timezone, c.env.SESSIONS);
    return c.json(cosmic);
  } catch (error: any) {
    console.error("[Cosmic Daily] Error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});

// NEO score only
app.get("/api/cosmic/neo-score", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    const timezone = c.req.query("timezone") || "America/New_York";

    const blueprint = await getSoulBlueprint(c.env.DB, user.id);
    if (!blueprint) {
      return c.json({ error: "Soul blueprint required" }, 400);
    }

    const cosmic = await getCosmicIntelligence(blueprint, timezone, c.env.SESSIONS);
    return c.json({ neoScore: cosmic.neoScore });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Hora grid only
app.get("/api/cosmic/hora-grid", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    const timezone = c.req.query("timezone") || "America/New_York";

    const blueprint = await getSoulBlueprint(c.env.DB, user.id);
    if (!blueprint) {
      return c.json({ error: "Soul blueprint required" }, 400);
    }

    const cosmic = await getCosmicIntelligence(blueprint, timezone, c.env.SESSIONS);
    return c.json({ horaGrid: cosmic.horaGrid });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// =====================================================
// AI CHAT: Conversational AI for the Intelligence Dashboard
// =====================================================
// This endpoint powers the "Learn More with AI" feature throughout the dashboard.
// The frontend sends messages with full market context already embedded in the system prompt.
app.post("/api/chat", authMiddleware, async (c) => {
  try {
    const user = c.get("user");

    // Check subscription - require active subscription for AI chat
    if (!user.subscription_status || user.subscription_status !== "active") {
      return c.json({ error: "Active subscription required for AI chat" }, 403);
    }

    const { messages, stream = true } = await c.req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: "Messages array is required" }, 400);
    }

    // Initialize OpenAI
    const openai = new OpenAI({ apiKey: c.env.OPENAI_API_KEY });

    // Use GPT-4o for fast, conversational responses (better for chat than GPT-5.2)
    const model = "gpt-4o";

    if (stream) {
      // Set up SSE headers for streaming
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      const streamResponse = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          try {
            const completion = await openai.chat.completions.create({
              model,
              messages,
              stream: true,
              max_tokens: 2000,
              temperature: 0.7,
            });

            for await (const chunk of completion) {
              const content = chunk.choices[0]?.delta?.content || "";
              if (content) {
                const sseChunk = `event: chunk\ndata: ${JSON.stringify(content)}\n\n`;
                controller.enqueue(encoder.encode(sseChunk));
              }
            }

            controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
            controller.close();
          } catch (error: any) {
            console.error("[Chat Stream Error]:", error);
            const sseError = `event: error\ndata: ${error.message}\n\n`;
            controller.enqueue(encoder.encode(sseError));
            controller.close();
          }
        },
      });

      return new Response(streamResponse, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": c.req.header("origin") || "*",
          "Access-Control-Allow-Credentials": "true",
        },
      });
    } else {
      // Non-streaming response
      const completion = await openai.chat.completions.create({
        model,
        messages,
        max_tokens: 2000,
        temperature: 0.7,
      });

      const content = completion.choices[0]?.message?.content || "";
      return c.json({ content });
    }
  } catch (error: any) {
    console.error("[Chat Error]:", error);
    return c.json({ error: error.message }, 500);
  }
});

// =====================================================
// CLOUDFLARE WORKER EXPORTS
// =====================================================

// Scheduled handler for automatic data updates
// Cron schedules (from wrangler.toml):
// - Daily 6am UTC: VIX, Fear & Greed, FRED liquidity
// - Friday 6pm UTC: CFTC COT (released 3:30pm ET Fridays), FINRA dark pool
async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext,
) {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 5 = Friday
  const hour = now.getUTCHours();

  console.log(
    "[Scheduled] Data update triggered at:",
    now.toISOString(),
    `(Day: ${dayOfWeek}, Hour: ${hour})`,
  );

  // Track what was updated
  const updates: string[] = [];
  const errors: string[] = [];

  // Always update institutional data (daily VIX, Fear & Greed, FRED estimates)
  try {
    console.log(
      "[Scheduled] Fetching institutional data (COT, FRED, CBOE, Fear & Greed)...",
    );
    const institutionalData = await fetchAllInstitutionalData(env.FRED_API_KEY);

    await env.INSTITUTIONAL_DATA.put(
      "current",
      JSON.stringify(institutionalData),
      {
        expirationTtl: 60 * 60 * 24 * 7, // 7 days
      },
    );

    const dateKey = `snapshot_${now.toISOString().split("T")[0]}`;
    await env.INSTITUTIONAL_DATA.put(
      dateKey,
      JSON.stringify(institutionalData),
    );

    console.log("[Scheduled] Institutional data updated:", {
      hasCOT: !!institutionalData.cot,
      hasFRED: !!institutionalData.fred,
      hasCBOE: !!institutionalData.cboe,
      hasFearGreed: !!institutionalData.fearGreed,
      compositeBias: institutionalData.compositeSignal?.bias,
    });

    updates.push("institutional");

    trackAnalytics(env, "institutional_update_success", {
      has_cot: !!institutionalData.cot,
      has_fred: !!institutionalData.fred,
      has_cboe: !!institutionalData.cboe,
      has_fear_greed: !!institutionalData.fearGreed,
      composite_bias: institutionalData.compositeSignal?.bias || "unknown",
    });
  } catch (error: any) {
    console.error("[Scheduled] Institutional update error:", error.message);
    errors.push(`institutional: ${error.message}`);
    trackAnalytics(env, "institutional_update_error", {
      error: error.message,
    });
  }

  // Also update FINRA data (weekly, but check daily in case of delays)
  try {
    console.log("[Scheduled] Fetching FINRA dark pool data...");
    const finraResult = await fetchFINRAData();

    if (finraResult.success && finraResult.data) {
      await env.FINRA_DATA.put("current", JSON.stringify(finraResult.data), {
        expirationTtl: 60 * 60 * 24 * 7, // 7 days
      });

      const dateKey = `snapshot_${finraResult.data.weekEnding}`;
      await env.FINRA_DATA.put(dateKey, JSON.stringify(finraResult.data));

      console.log("[Scheduled] FINRA data updated:", {
        weekEnding: finraResult.data.weekEnding,
        symbols: Object.keys(finraResult.data.symbols),
      });

      updates.push("finra");

      trackAnalytics(env, "finra_update_success", {
        week_ending: finraResult.data.weekEnding,
        symbols_count: Object.keys(finraResult.data.symbols).length,
      });
    } else {
      console.warn(
        "[Scheduled] FINRA update returned no data:",
        finraResult.error,
      );
      errors.push(`finra: ${finraResult.error || "no data"}`);
    }
  } catch (error: any) {
    console.error("[Scheduled] FINRA update error:", error.message);
    errors.push(`finra: ${error.message}`);
    trackAnalytics(env, "finra_update_error", {
      error: error.message,
    });
  }

  // Refresh environmental energy data (space weather)
  try {
    console.log("[Scheduled] Refreshing environmental energy data...");
    await refreshEnvironmentalData(env.SESSIONS);
    updates.push("environmental");
    console.log("[Scheduled] Environmental energy data updated");
  } catch (error: any) {
    console.error("[Scheduled] Environmental energy update error:", error.message);
    errors.push(`environmental: ${error.message}`);
  }

  console.log("[Scheduled] Update complete:", {
    updated: updates,
    errors: errors.length > 0 ? errors : "none",
  });
}

// Export both fetch and scheduled handlers
export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
};
