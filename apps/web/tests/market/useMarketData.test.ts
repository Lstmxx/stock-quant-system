import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMarketData } from '../../src/features/market/hooks/use-market-data';
import { successResponse } from '../helpers/api-response';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  kline: vi.fn(),
}));

vi.mock('../../src/api/api', () => {
  const marketData = Object.assign(
    vi.fn(() => ({ kline: { get: mocks.kline } })),
    { search: { get: mocks.search } },
  );
  return { api: { 'market-data': marketData } };
});

const stocks = [
  { code: 'sh.600519', name: '贵州茅台' },
  { code: 'sz.000001', name: '平安银行' },
];

const chart = (symbol: string) => ({
  symbol,
  name: symbol === 'sh.600519' ? '贵州茅台' : '平安银行',
  bars: [{ time: '2026-08-27', open: 1, high: 2, low: 1, close: 1.5 }],
  volume: [{ time: '2026-08-27', value: 100 }],
  latest: {
    time: '2026-08-27', open: 1, high: 2, low: 1, close: 1.5, volume: 100, changePercent: null,
  },
  range: { start: '2026-08-27', end: '2026-08-27' },
});

describe('useMarketData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search.mockResolvedValue(successResponse(stocks));
    mocks.kline.mockResolvedValue(successResponse(chart('sh.600519')));
  });

  it('debounces a query and exposes stock suggestions', async () => {
    const { result } = renderHook(() => useMarketData());

    act(() => result.current.updateQuery('600519'));
    await waitFor(() => expect(result.current.suggestions).toEqual(stocks));

    expect(mocks.search).toHaveBeenCalledWith({ query: { q: '600519' } });
  });

  it('keeps the latest selected stock when an earlier chart response arrives late', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    mocks.kline
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(successResponse(chart('sz.000001')));

    const { result } = renderHook(() => useMarketData());
    await waitFor(() => expect(result.current.searchLoading).toBe(false));

    act(() => result.current.selectStock(stocks[0]));
    act(() => result.current.selectStock(stocks[1]));
    await waitFor(() => expect(result.current.chartData?.symbol).toBe('sz.000001'));

    await act(async () => {
      resolveFirst?.(successResponse(chart('sh.600519')));
    });
    expect(result.current.chartData?.symbol).toBe('sz.000001');
  });
});
