import { describe, expect, it } from 'vitest';
import { ApiCode } from '@stock-quant/api/contracts';
import { isMarketKlineData } from '../../src/features/market/types';

const validChartData = {
  symbol: 'sh.600519',
  name: '贵州茅台',
  bars: [{ time: '2026-08-27', open: 1, high: 2, low: 1, close: 1.5 }],
  volume: [{ time: '2026-08-27', value: 100 }],
  latest: {
    time: '2026-08-27', open: 1, high: 2, low: 1, close: 1.5, volume: 100, changePercent: 1.2,
  },
  range: { start: '2026-08-27', end: '2026-08-27' },
};

describe('market chart payload guard', () => {
  it('accepts the normalized API response shape', () => {
    expect(isMarketKlineData(validChartData)).toBe(true);
  });

  it('rejects non-finite numbers before they reach lightweight-charts', () => {
    expect(isMarketKlineData({
      ...validChartData,
      bars: [{ ...validChartData.bars[0], close: Number.NaN }],
    })).toBe(false);
    expect(isMarketKlineData({ success: false, code: ApiCode.KLINE_NOT_FOUND, message: 'missing', data: null })).toBe(false);
  });
});
