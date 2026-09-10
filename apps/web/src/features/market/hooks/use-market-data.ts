import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../api/api';
import { getApiErrorMessage, request } from '../../../api/request';
import {
  isMarketKlineData,
  isStockSearchData,
  type MarketKlineData,
  type StockSearchItem,
} from '../types';

const SEARCH_DEBOUNCE_MS = 250;

interface MarketDataState {
  query: string;
  suggestions: StockSearchItem[];
  searchLoading: boolean;
  searchError: string | null;
  selected: StockSearchItem | null;
  chartData: MarketKlineData | null;
  chartLoading: boolean;
  chartError: string | null;
}

export function useMarketData() {
  const [state, setState] = useState<MarketDataState>({
    query: '',
    suggestions: [],
    searchLoading: false,
    searchError: null,
    selected: null,
    chartData: null,
    chartLoading: false,
    chartError: null,
  });
  const generationRef = useRef(0);

  const loadChart = useCallback(async (stock: StockSearchItem) => {
    const generation = ++generationRef.current;
    setState((previous) => ({
      ...previous,
      selected: stock,
      chartData: null,
      chartLoading: true,
      chartError: null,
    }));

    try {
      const data = await request(api['market-data']({ symbol: stock.code }).kline.get(), isMarketKlineData);
      if (generation !== generationRef.current) return;
      setState((previous) => ({ ...previous, chartData: data, chartLoading: false }));
    } catch (error) {
      if (generation !== generationRef.current) return;
      setState((previous) => ({
        ...previous,
        chartLoading: false,
        chartError: getApiErrorMessage(error, '行情数据加载失败，请检查网络连接'),
      }));
    }
  }, []);

  const search = useCallback(async (value: string) => {
    const query = value.trim();
    const generation = ++generationRef.current;
    setState((previous) => ({
      ...previous,
      query: value,
      suggestions: [],
      searchLoading: query.length > 0,
      searchError: null,
    }));
    if (!query) return;

    try {
      const data = await request(api['market-data'].search.get({ query: { q: query } }), isStockSearchData);
      if (generation !== generationRef.current) return;
      setState((previous) => ({
        ...previous,
        suggestions: data,
        searchLoading: false,
      }));
    } catch (error) {
      if (generation !== generationRef.current) return;
      setState((previous) => ({
        ...previous,
        searchLoading: false,
        searchError: getApiErrorMessage(error, '股票搜索失败，请检查网络连接'),
      }));
    }
  }, []);

  useEffect(() => {
    const query = state.query.trim();
    if (state.selected?.code === query) return;
    const timer = window.setTimeout(() => {
      void search(state.query);
    }, query ? SEARCH_DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [search, state.query]);

  const selectStock = useCallback((stock: StockSearchItem) => {
    setState((previous) => ({ ...previous, query: stock.code, suggestions: [] }));
    void loadChart(stock);
  }, [loadChart]);

  const updateQuery = useCallback((value: string) => {
    setState((previous) => ({
      ...previous,
      query: value,
      suggestions: [],
      searchError: null,
      selected: previous.selected?.code === value ? previous.selected : null,
      chartData: previous.selected?.code === value ? previous.chartData : null,
      chartError: previous.selected?.code === value ? previous.chartError : null,
    }));
  }, []);

  const submitSearch = useCallback(() => {
    const match = state.suggestions[0];
    if (match) selectStock(match);
  }, [selectStock, state.suggestions]);

  return { ...state, updateQuery, selectStock, submitSearch, loadChart };
}
