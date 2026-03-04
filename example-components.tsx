/**
 * Premium Trading Dashboard - Example Components
 * Version 1.0 | December 2025
 *
 * These components demonstrate the implementation of the design system
 * Import dashboard-styles.css globally before using these components
 */

import React, { useState, useEffect, useRef } from "react";

/* ============================================================================
   TYPE DEFINITIONS
   ========================================================================= */

type MarketRegime =
  | "BULL_QUIET"
  | "BULL_VOLATILE"
  | "BEAR_QUIET"
  | "BEAR_VOLATILE"
  | "RANGE_BOUND";
type SmartMoneyBias = "BULLISH" | "BEARISH" | "NEUTRAL";

interface DashboardData {
  marketRegime: MarketRegime;
  smartMoneyBias: SmartMoneyBias;
  convictionMultiplier: number;
  fearGreedIndex: number;
  vixLevel: number;
  netLiquidity: number;
  signals: Signal[];
  alerts: Alert[];
}

interface Signal {
  name: string;
  value: number;
  strength: number; // 0-100
  bullish: boolean;
}

interface Alert {
  id: string;
  type: "warning" | "danger" | "info";
  title: string;
  message: string;
  active: boolean;
}

/* ============================================================================
   1. MARKET REGIME PILL
   ========================================================================= */

interface MarketRegimePillProps {
  regime: MarketRegime;
  trend?: number[]; // Optional sparkline data
}

export function MarketRegimePill({ regime, trend }: MarketRegimePillProps) {
  const isBullish = regime.startsWith("BULL");
  const isNeutral = regime === "RANGE_BOUND";

  return (
    <div
      className={`regime-pill ${
        isNeutral
          ? "regime-pill--neutral"
          : isBullish
            ? ""
            : "regime-pill--bearish"
      }`}
    >
      <span className="regime-label">{regime.replace("_", " ")}</span>

      {/* Sparkline */}
      {trend && trend.length > 0 && (
        <svg className="w-12 h-6" viewBox="0 0 48 24">
          <polyline
            points={trend
              .map((value, index) => {
                const x = (index / (trend.length - 1)) * 48;
                const y = 24 - (value / Math.max(...trend)) * 20;
                return `${x},${y}`;
              })
              .join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity="0.6"
          />
        </svg>
      )}

      {/* Pulse indicator */}
      <div
        className={`regime-pulse ${!isBullish && !isNeutral ? "regime-pulse--bearish" : ""}`}
      />
    </div>
  );
}

/* ============================================================================
   2. CONVICTION MULTIPLIER GAUGE
   ========================================================================= */

interface ConvictionGaugeProps {
  value: number; // 0.5 to 1.5
  trend?: "up" | "down" | "neutral";
  onChange?: (value: number) => void;
}

export function ConvictionGauge({
  value,
  trend = "neutral",
}: ConvictionGaugeProps) {
  const clampedValue = Math.max(0.5, Math.min(1.5, value));
  const percentage = ((clampedValue - 0.5) / 1.0) * 100;
  const rotation = -120 + (percentage / 100) * 240; // -120° to +120°

  return (
    <div className="glass-card glass-card--accent flex flex-col items-center justify-center py-8 relative overflow-hidden">
      {/* Top accent line */}
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-purple-500 to-transparent opacity-50" />

      {/* Label */}
      <h3 className="text-label mb-4">Conviction Multiplier</h3>

      {/* Radial Gauge */}
      <div className="gauge-container mb-4">
        <svg width="200" height="130" viewBox="0 0 200 130">
          <defs>
            <linearGradient
              id="conviction-gradient"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="0%"
            >
              <stop offset="0%" stopColor="#FF4D4D" />
              <stop offset="50%" stopColor="#FFB347" />
              <stop offset="100%" stopColor="#7C3AED" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Track (background arc) */}
          <path
            d="M 30 100 A 70 70 0 0 1 170 100"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="12"
            strokeLinecap="round"
          />

          {/* Fill arc (colored gradient) */}
          <path
            d="M 30 100 A 70 70 0 0 1 170 100"
            fill="none"
            stroke="url(#conviction-gradient)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray="220"
            strokeDashoffset={220 - (percentage / 100) * 220}
            style={{ transition: "stroke-dashoffset 1s ease-out" }}
            filter="url(#glow)"
          />

          {/* Needle */}
          <g
            transform={`rotate(${rotation} 100 100)`}
            style={{ transition: "transform 1s ease-out" }}
          >
            <line
              x1="100"
              y1="100"
              x2="100"
              y2="45"
              stroke="#fff"
              strokeWidth="3"
              strokeLinecap="round"
              filter="url(#glow)"
            />
            <circle cx="100" cy="100" r="6" fill="#fff" />
          </g>

          {/* Min/Max labels */}
          <text
            x="25"
            y="115"
            fill="var(--text-secondary)"
            fontSize="11"
            textAnchor="middle"
          >
            0.5×
          </text>
          <text
            x="175"
            y="115"
            fill="var(--text-secondary)"
            fontSize="11"
            textAnchor="middle"
          >
            1.5×
          </text>
        </svg>

        {/* Center value */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 mt-4">
          <div className="text-5xl font-mono font-bold text-gradient-gold">
            {clampedValue.toFixed(1)}×
          </div>
        </div>
      </div>

      {/* Trend indicator */}
      {trend !== "neutral" && (
        <div
          className={`flex items-center gap-1 text-xs ${
            trend === "up" ? "text-cyber-mint" : "text-coral-red"
          }`}
        >
          <span>{trend === "up" ? "↑" : "↓"}</span>
          <span>{trend === "up" ? "Strengthening" : "Weakening"}</span>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   3. SMART MONEY BIAS METER
   ========================================================================= */

interface BiasMeterpProps {
  bias: SmartMoneyBias;
  strength?: number; // 0-100, how strong the bias is
}

export function BiasMeterpanel({ bias, strength = 50 }: BiasMeterpProps) {
  const position =
    bias === "BULLISH"
      ? 50 + strength / 2
      : bias === "BEARISH"
        ? 50 - strength / 2
        : 50;

  return (
    <div className="glass-card">
      <h3 className="text-h2 mb-4">Smart Money Bias</h3>

      <div className="relative">
        {/* Bar container */}
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden relative">
          {/* Bearish fill (left) */}
          <div
            className="absolute left-0 top-0 h-full bg-gradient-to-r from-bearish to-bearish-dark"
            style={{ width: position < 50 ? `${50 - position}%` : "0%" }}
          />

          {/* Bullish fill (right) */}
          <div
            className="absolute right-0 top-0 h-full bg-gradient-to-l from-bullish to-bullish-dark"
            style={{ width: position > 50 ? `${position - 50}%` : "0%" }}
          />

          {/* Center line */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-600" />
        </div>

        {/* Arrow indicator */}
        <div
          className="absolute -top-2 transform -translate-x-1/2 transition-all duration-500"
          style={{ left: `${position}%` }}
        >
          <div
            className={`w-0 h-0 border-l-4 border-r-4 border-t-8 ${
              bias === "BULLISH"
                ? "border-l-transparent border-r-transparent border-t-bullish"
                : bias === "BEARISH"
                  ? "border-l-transparent border-r-transparent border-t-bearish"
                  : "border-l-transparent border-r-transparent border-t-neutral"
            }`}
            style={{
              filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))",
            }}
          />
        </div>

        {/* Labels */}
        <div className="flex justify-between mt-6 text-xs">
          <span className="text-bearish font-mono">BEARISH</span>
          <span className="text-gray-500">NEUTRAL</span>
          <span className="text-bullish font-mono">BULLISH</span>
        </div>

        {/* Current bias label */}
        <div className="text-center mt-3">
          <span
            className={`text-sm font-semibold ${
              bias === "BULLISH"
                ? "text-bullish"
                : bias === "BEARISH"
                  ? "text-bearish"
                  : "text-neutral"
            }`}
          >
            {bias}
          </span>
          <span className="text-xs text-gray-500 ml-2">
            ({strength}% confidence)
          </span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   4. FEAR & GREED GAUGE
   ========================================================================= */

interface FearGreedGaugeProps {
  score: number; // 0-100
}

export function FearGreedGauge({ score }: FearGreedGaugeProps) {
  const clampedScore = Math.max(0, Math.min(100, score));
  const rotation = -90 + (clampedScore / 100) * 180; // -90° (left) to +90° (right)

  const getLabel = (score: number) => {
    if (score < 25) return "Extreme Fear";
    if (score < 45) return "Fear";
    if (score < 55) return "Neutral";
    if (score < 75) return "Greed";
    return "Extreme Greed";
  };

  return (
    <div className="glass-card">
      <h3 className="text-h2 mb-4">Fear & Greed Index</h3>

      <div className="relative w-full max-w-[240px] mx-auto">
        <svg width="240" height="140" viewBox="0 0 240 140">
          <defs>
            <linearGradient
              id="fear-greed-gradient"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="0%"
            >
              <stop offset="0%" stopColor="#FF4D4D" />
              <stop offset="25%" stopColor="#FF8C42" />
              <stop offset="50%" stopColor="#FFB347" />
              <stop offset="75%" stopColor="#B8E986" />
              <stop offset="100%" stopColor="#00E096" />
            </linearGradient>
          </defs>

          {/* Arc background */}
          <path
            d="M 40 120 A 80 80 0 0 1 200 120"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="16"
            strokeLinecap="round"
          />

          {/* Colored arc */}
          <path
            d="M 40 120 A 80 80 0 0 1 200 120"
            fill="none"
            stroke="url(#fear-greed-gradient)"
            strokeWidth="16"
            strokeLinecap="round"
          />

          {/* Needle */}
          <g
            transform={`rotate(${rotation} 120 120)`}
            style={{ transition: "transform 1s cubic-bezier(0.4, 0, 0.2, 1)" }}
          >
            <line
              x1="120"
              y1="120"
              x2="120"
              y2="55"
              stroke="#fff"
              strokeWidth="2.5"
              strokeLinecap="round"
              filter="drop-shadow(0 2px 4px rgba(0,0,0,0.4))"
            />
            <circle cx="120" cy="120" r="5" fill="#fff" />
          </g>
        </svg>

        {/* Score display */}
        <div className="text-center mt-2">
          <div className="text-4xl font-mono font-bold text-white">
            {clampedScore}
          </div>
          <div className="text-sm text-gray-400 mt-1">
            {getLabel(clampedScore)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   5. SIGNAL BREAKDOWN LIST
   ========================================================================= */

interface SignalListProps {
  signals: Signal[];
}

export function SignalList({ signals }: SignalListProps) {
  return (
    <div className="glass-card">
      <h3 className="text-h1 mb-4">AI Signal Breakdown</h3>

      <div className="signal-list">
        {signals.map((signal, index) => (
          <div key={index} className="signal-row">
            <span className="signal-name">{signal.name}</span>

            <div className="signal-strength-bar">
              <div
                className="signal-fill"
                style={{
                  width: `${signal.strength}%`,
                  background: signal.bullish
                    ? "var(--bullish)"
                    : "var(--bearish)",
                  opacity: 0.4 + (signal.strength / 100) * 0.6,
                }}
              />
            </div>

            <span
              className={`signal-value ${signal.bullish ? "bullish-text" : "bearish-text"}`}
            >
              {signal.value > 0 ? "+" : ""}
              {signal.value.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================================
   6. CONTRARIAN ALERT CARD
   ========================================================================= */

interface AlertCardProps {
  alert: Alert;
  onDismiss?: (id: string) => void;
}

export function AlertCard({ alert, onDismiss }: AlertCardProps) {
  return (
    <div
      className={`alert-card alert-${alert.type} ${alert.active ? "alert-active" : ""}`}
    >
      <div className="alert-icon">
        {alert.type === "warning" && "⚠️"}
        {alert.type === "danger" && "🚨"}
        {alert.type === "info" && "ℹ️"}
      </div>

      <div className="alert-content flex-1">
        <h4>{alert.title}</h4>
        <p>{alert.message}</p>
      </div>

      {onDismiss && (
        <button
          onClick={() => onDismiss(alert.id)}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label="Dismiss alert"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/* ============================================================================
   7. DATA VALUE WITH FLASH ANIMATION
   ========================================================================= */

interface AnimatedValueProps {
  value: number;
  previousValue?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export function AnimatedValue({
  value,
  previousValue,
  decimals = 2,
  prefix = "",
  suffix = "",
  className = "",
}: AnimatedValueProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const [animationClass, setAnimationClass] = useState("");

  useEffect(() => {
    if (previousValue !== undefined && previousValue !== value) {
      // Trigger flash animation
      const flashClass =
        value > previousValue ? "value-increased" : "value-decreased";
      setAnimationClass(flashClass);

      // Animate number change
      const duration = 800;
      const steps = 30;
      const stepDuration = duration / steps;
      const increment = (value - previousValue) / steps;

      let currentStep = 0;
      const interval = setInterval(() => {
        currentStep++;
        if (currentStep >= steps) {
          setDisplayValue(value);
          clearInterval(interval);
          // Remove animation class after completion
          setTimeout(() => setAnimationClass(""), 1000);
        } else {
          setDisplayValue(previousValue + increment * currentStep);
        }
      }, stepDuration);

      return () => clearInterval(interval);
    } else {
      setDisplayValue(value);
    }
  }, [value, previousValue]);

  return (
    <span className={`${className} ${animationClass}`}>
      {prefix}
      {displayValue.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/* ============================================================================
   8. LIQUIDITY CHART PLACEHOLDER
   ========================================================================= */

interface LiquidityChartProps {
  data: Array<{ date: string; netLiquidity: number; price: number }>;
}

export function LiquidityChart({ data }: LiquidityChartProps) {
  // This is a placeholder - in production, use Recharts or Lightweight Charts
  return (
    <div className="glass-card span-8">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-h1">Net Liquidity vs Price</h3>
        <div className="text-xs text-gray-500">Last 90 days</div>
      </div>

      <div className="h-80 flex items-center justify-center bg-gray-900/30 rounded-lg border border-gray-800">
        <div className="text-center">
          <div className="text-gray-500 mb-2">Chart Component</div>
          <div className="text-xs text-gray-600">
            Integrate Recharts, Chart.js, or Lightweight Charts here
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   9. COMPLETE DASHBOARD LAYOUT EXAMPLE
   ========================================================================= */

export function TradingDashboard() {
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    marketRegime: "BULL_VOLATILE",
    smartMoneyBias: "BULLISH",
    convictionMultiplier: 1.4,
    fearGreedIndex: 68,
    vixLevel: 18.5,
    netLiquidity: 2450000000000,
    signals: [
      { name: "RSI Divergence", value: 0.75, strength: 85, bullish: true },
      { name: "Volume Delta", value: -0.32, strength: 45, bullish: false },
      {
        name: "Order Flow Imbalance",
        value: 0.68,
        strength: 72,
        bullish: true,
      },
      { name: "Dark Pool Activity", value: 0.91, strength: 95, bullish: true },
      { name: "Put/Call Ratio", value: -0.15, strength: 28, bullish: false },
    ],
    alerts: [
      {
        id: "1",
        type: "warning",
        title: "Contrarian Signal",
        message:
          "Extreme Fear detected - potential reversal zone near key support",
        active: true,
      },
    ],
  });

  return (
    <div className="dashboard-container">
      {/* Top Status Bar */}
      <div
        className="span-full glass-card flex justify-between items-center"
        style={{ height: "80px" }}
      >
        <div>
          <div className="text-label mb-1">Market Regime</div>
          <MarketRegimePill regime={dashboardData.marketRegime} />
        </div>

        <div className="text-center">
          <div className="text-label mb-1">VIX Level</div>
          <div className="text-metric">
            <AnimatedValue value={dashboardData.vixLevel} decimals={2} />
          </div>
        </div>

        <div className="text-right">
          <div className="text-label mb-1">Net Liquidity</div>
          <div className="text-metric">
            <AnimatedValue
              value={dashboardData.netLiquidity / 1e12}
              decimals={2}
              prefix="$"
              suffix="T"
            />
          </div>
        </div>
      </div>

      {/* Main Chart */}
      <LiquidityChart data={[]} />

      {/* Right Sidebar - Gauges */}
      <div className="span-4 flex flex-col gap-4">
        <ConvictionGauge
          value={dashboardData.convictionMultiplier}
          trend="up"
        />
        <FearGreedGauge score={dashboardData.fearGreedIndex} />
      </div>

      {/* Bias Meter */}
      <div className="span-6">
        <BiasMeterpanel bias={dashboardData.smartMoneyBias} strength={75} />
      </div>

      {/* Signals */}
      <div className="span-6">
        <SignalList signals={dashboardData.signals} />
      </div>

      {/* Alerts */}
      {dashboardData.alerts.map((alert) => (
        <div key={alert.id} className="span-full">
          <AlertCard alert={alert} />
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
   10. EXPORT ALL COMPONENTS
   ========================================================================= */

export default TradingDashboard;
