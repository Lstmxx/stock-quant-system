export interface StockSearchItem {
  code: string;
  name: string;
}

export interface MarketKlineBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MarketVolumeBar {
  time: string;
  value: number;
}

export interface MarketLatestBar extends MarketKlineBar {
  volume: number;
  changePercent: number | null;
}

export interface MarketKlineData {
  symbol: string;
  name: string;
  bars: MarketKlineBar[];
  volume: MarketVolumeBar[];
  latest: MarketLatestBar;
  range: { start: string; end: string };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBar(value: unknown): value is MarketKlineBar {
  if (!value || typeof value !== 'object') return false;
  const bar = value as Record<string, unknown>;
  return typeof bar.time === 'string'
    && isFiniteNumber(bar.open)
    && isFiniteNumber(bar.high)
    && isFiniteNumber(bar.low)
    && isFiniteNumber(bar.close);
}

export function isStockSearchItem(value: unknown): value is StockSearchItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.code === 'string' && typeof item.name === 'string';
}

export function isMarketKlineData(value: unknown): value is MarketKlineData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const latest = data.latest;
  const range = data.range;
  if (typeof data.symbol !== 'string' || typeof data.name !== 'string') return false;
  if (!Array.isArray(data.bars) || !data.bars.every(isBar)) return false;
  if (!Array.isArray(data.volume) || !data.volume.every((bar) => {
    if (!bar || typeof bar !== 'object') return false;
    const point = bar as Record<string, unknown>;
    return typeof point.time === 'string' && isFiniteNumber(point.value);
  })) return false;
  if (!isBar(latest) || typeof latest !== 'object') return false;
  const latestRecord = latest as unknown as Record<string, unknown>;
  if (!isFiniteNumber(latestRecord.volume)) return false;
  if (latestRecord.changePercent !== null && !isFiniteNumber(latestRecord.changePercent)) return false;
  return Boolean(
    range
    && typeof range === 'object'
    && typeof (range as Record<string, unknown>).start === 'string'
    && typeof (range as Record<string, unknown>).end === 'string',
  );
}
