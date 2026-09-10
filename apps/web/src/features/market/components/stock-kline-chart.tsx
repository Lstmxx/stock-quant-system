import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import type { MarketKlineData } from '../types';

interface StockKlineChartProps {
  data: MarketKlineData;
}

export function StockKlineChart({ data }: StockKlineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const rootStyles = getComputedStyle(document.documentElement);
    const color = (token: string) => rootStyles.getPropertyValue(token).trim();
    const chartBackground = color('--component-chart-background');
    const chartGrid = color('--component-chart-grid');
    const chartBorder = color('--component-chart-border');
    const chartUp = color('--component-chart-up');
    const chartDown = color('--component-chart-down');
    const chartVolume = color('--component-chart-volume');
    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 540,
      layout: {
        background: { type: ColorType.Solid, color: chartBackground },
        textColor: color('--color-text-secondary'),
        panes: { separatorColor: chartBorder, separatorHoverColor: color('--color-border-hover') },
      },
      grid: {
        vertLines: { color: chartGrid },
        horzLines: { color: chartGrid },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: chartBorder },
      timeScale: { borderColor: chartBorder, timeVisible: false },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: chartUp,
      downColor: chartDown,
      borderVisible: false,
      wickUpColor: chartUp,
      wickDownColor: chartDown,
    }, 0);
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      color: chartVolume,
    }, 1);
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 } });
    chart.panes()[1]?.setHeight(120);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const chart = chartRef.current;
    if (!candleSeries || !volumeSeries || !chart) return;

    const barsByTime = new Map(data.bars.map((bar) => [bar.time, bar]));
    const rootStyles = getComputedStyle(document.documentElement);
    const upColor = rootStyles.getPropertyValue('--component-chart-up').trim();
    const downColor = rootStyles.getPropertyValue('--component-chart-down').trim();
    candleSeries.setData(data.bars.map((bar) => ({ ...bar, time: bar.time as Time })));
    volumeSeries.setData(data.volume.map((point) => {
      const bar = barsByTime.get(point.time);
      return {
        ...point,
        time: point.time as Time,
        color: bar && bar.close >= bar.open ? upColor : downColor,
      };
    }));
    chart.timeScale().fitContent();
  }, [data]);

  return <div ref={containerRef} className="market-chart-canvas" aria-label={`${data.name} K线图`} />;
}
