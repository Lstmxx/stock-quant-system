import { useMemo } from 'react';
import { AutoComplete, Card, Empty, Input, Space, Spin, Statistic, Tag, Typography } from 'antd';
import { Search, TrendingUp } from 'lucide-react';
import { StockKlineChart } from './components/stock-kline-chart';
import { useMarketData } from './hooks/use-market-data';

const { Text, Title } = Typography;

export default function MarketChartPage() {
  const {
    query,
    suggestions,
    searchLoading,
    searchError,
    selected,
    chartData,
    chartLoading,
    chartError,
    updateQuery,
    selectStock,
    submitSearch,
  } = useMarketData();

  const options = useMemo(() => suggestions.map((stock) => ({
    value: stock.code,
    label: (
      <div className="market-search-option">
        <span>{stock.code}</span>
        <Text type="secondary">{stock.name || '未命名股票'}</Text>
      </div>
    ),
    stock,
  })), [suggestions]);

  const changePercent = chartData?.latest.changePercent ?? null;
  const changeColor = (changePercent ?? 0) >= 0 ? 'success' : 'error';
  const changeText = changePercent === null
    ? '--'
    : `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`;

  return (
    <div className="market-chart-page">
      <section className="market-chart-hero">
        <div className="market-chart-heading">
          <div className="eyebrow-label"><TrendingUp size={16} /> MARKET VIEW / DAILY</div>
          <Title level={1}>行情图表</Title>
          <Text>搜索主板股票代码或名称，查看本地缓存的日线行情。</Text>
        </div>
        <AutoComplete
          className="market-search"
          options={options}
          value={query}
          onChange={updateQuery}
          onSelect={(_value, option) => selectStock(option.stock)}
          notFoundContent={searchLoading ? <Spin size="small" /> : null}
          showSearch={{ filterOption: false }}
          aria-label="搜索股票代码或名称"
        >
          <Input.Search
            size="large"
            placeholder="输入股票代码或名称，例如 600519 / 贵州茅台"
            enterButton={<Search size={17} />}
            onSearch={submitSearch}
          />
        </AutoComplete>
        {searchError && <Text type="danger">{searchError}</Text>}
      </section>

      {chartLoading && (
        <Card className="market-chart-state"><Spin description="正在加载行情数据" /></Card>
      )}
      {!chartLoading && chartError && (
        <Card className="market-chart-state"><Empty description={chartError} /></Card>
      )}
      {!chartLoading && !chartError && !chartData && (
        <Card className="market-chart-state">
          <Empty description={selected ? '暂无该股票的行情缓存，请先执行数据采集' : '请选择搜索结果查看 K 线图'} />
        </Card>
      )}
      {chartData && (
        <Card className="market-chart-card">
          <div className="market-chart-card-head">
            <div>
              <Space size={10} align="center">
                <Title level={2}>{chartData.name || '未命名股票'}</Title>
                <Tag>{chartData.symbol}</Tag>
              </Space>
              <Text type="secondary">日线 · {chartData.range.start} — {chartData.range.end}</Text>
            </div>
            <div className="market-chart-summary">
              <Statistic title="最新收盘" value={chartData.latest.close.toFixed(2)} />
              <Statistic title="涨跌幅" value={changeText} styles={{ content: { color: changeColor === 'success' ? 'var(--color-success)' : 'var(--color-error)' } }} />
            </div>
          </div>
          <StockKlineChart data={chartData} />
        </Card>
      )}
    </div>
  );
}
