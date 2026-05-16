import { Injectable } from '@nestjs/common';
import type { IndicatorType } from '@shared/event/indicator-updated.event';

// Rolling-window state per (symbol, indicator-type, window-size). SMA
// keeps the raw close array; EMA keeps just the previous EMA value and
// the sample count (until window-size samples are seen — then EMA is
// considered "warm" and emits values).
//
// Persistence is the caller's job — the service is pure compute. State
// lives in memory; Phase 7 doesn't restore on boot (cold start), 7.5+
// will load the last N closes from DB at warmup time.

interface SmaState {
  closes: number[];
}

interface EmaState {
  count: number;
  ema: number | null;
}

export interface IndicatorUpdate {
  readonly indicatorType: IndicatorType;
  readonly windowSize: number;
  readonly value: number | null;
}

const SMA_WINDOW = 20;
const EMA_WINDOW = 20;
// EMA smoothing factor α = 2 / (N+1). Matches the canonical "modern" EMA
// definition used by most charting libraries (TradingView, etc).
const EMA_ALPHA = 2 / (EMA_WINDOW + 1);

@Injectable()
export class IndicatorService {
  private readonly sma = new Map<string, SmaState>();

  private readonly ema = new Map<string, EmaState>();

  // Returns the indicators that were updated for this close. Empty array
  // is impossible — every call emits an SMA20 + EMA20 row (value may be
  // null while warming).
  update(symbol: string, marketEnv: string, close: number): IndicatorUpdate[] {
    const key = `${marketEnv}:${symbol}`;

    return [this.computeSma(key, close), this.computeEma(key, close)];
  }

  private computeSma(key: string, close: number): IndicatorUpdate {
    const state = this.sma.get(key) ?? { closes: [] };

    state.closes.push(close);

    if (state.closes.length > SMA_WINDOW) state.closes.shift();

    this.sma.set(key, state);

    const value =
      state.closes.length === SMA_WINDOW
        ? state.closes.reduce((s, v) => s + v, 0) / SMA_WINDOW
        : null;

    return { indicatorType: 'sma', windowSize: SMA_WINDOW, value };
  }

  private computeEma(key: string, close: number): IndicatorUpdate {
    const state = this.ema.get(key) ?? { count: 0, ema: null };

    state.count += 1;

    if (state.count < EMA_WINDOW) {
      // Seed with the running mean during warmup so the first emitted
      // EMA value is well-conditioned. Implementation: track partial sum
      // through the same `ema` field, then convert.
      state.ema = state.ema === null ? close : (state.ema + close) / 2;

      this.ema.set(key, state);

      return { indicatorType: 'ema', windowSize: EMA_WINDOW, value: null };
    }

    if (state.count === EMA_WINDOW) {
      // Convert SMA-like seed → first proper EMA value: take running mean
      // as initial EMA, then apply normal step on this close.
      const seed = state.ema ?? close;

      state.ema = EMA_ALPHA * close + (1 - EMA_ALPHA) * seed;
    } else {
      const prev = state.ema as number;

      state.ema = EMA_ALPHA * close + (1 - EMA_ALPHA) * prev;
    }

    this.ema.set(key, state);

    return { indicatorType: 'ema', windowSize: EMA_WINDOW, value: state.ema };
  }
}
