import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  List,
  Modal,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';

import { api } from '../../../api/api';
import { getApiErrorMessage, request } from '../../../api/request';
import { normalizeLlmSelectionTask } from '../types';
import type {
  LlmSelectionResult,
  LlmSelectionResultsResponse,
  LlmSelectionStockDetail,
  LlmSelectionTask,
} from '../types';

const { Paragraph, Text, Title } = Typography;
type ResultView = 'selected' | 'all' | 'failed';

interface Props {
  task: LlmSelectionTask | null;
  retrying: boolean;
  onClose: () => void;
  onRetry: (taskId: string, symbols?: string[]) => Promise<boolean>;
}

export function LlmSelectionResultModal(props: Props) {
  const [view, setView] = useState<ResultView>('selected');
  const [response, setResponse] = useState<LlmSelectionResultsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);

  const fetchResults = useCallback(async () => {
    if (!props.task) return;
    setLoading(true);
    setError(null);
    try {
      const data = await request(api['llm-stock-selections']({ id: props.task.id }).results.get({
        query: { view, limit: 200, offset: 0 },
      }));
      const resultResponse: LlmSelectionResultsResponse = {
        task: normalizeLlmSelectionTask(data.task),
        items: data.items,
        total: data.total,
      };
      setResponse(resultResponse);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, '加载选股结果失败'));
    } finally {
      setLoading(false);
    }
  }, [props.task, view]);

  useEffect(() => {
    setSelectedSymbols([]);
    void fetchResults();
  }, [fetchResults]);

  const handleRetry = async (symbols?: string[]) => {
    if (!props.task) return;
    const success = await props.onRetry(props.task.id, symbols);
    if (success) {
      setSelectedSymbols([]);
      await fetchResults();
    }
  };

  const columns: TableColumnsType<LlmSelectionResult> = useMemo(() => [
    { title: '最终排名', dataIndex: 'finalRank', width: 90, render: (value) => value ?? '-' },
    { title: '量化排名', dataIndex: 'quantitativeRank', width: 90, render: (value) => value ?? '-' },
    { title: '股票', key: 'stock', render: (_, row) => `${row.stockName ?? row.symbol} · ${row.symbol}` },
    {
      title: '来源',
      dataIndex: 'candidateSources',
      render: (sources: string[]) => sources.map((source) => <Tag key={source}>{source === 'WATCHLIST' ? '自选股' : '量化'}</Tag>),
    },
    { title: 'LLM 分数', dataIndex: 'judgment', width: 100, render: (judgment) => judgment?.selectionScore ?? '-' },
    { title: '状态', dataIndex: 'llmStatus', width: 110, render: (status) => <Tag>{status}</Tag> },
    {
      title: '失败原因',
      key: 'error',
      render: (_, row) => row.exclusionMessage ?? row.latestErrorMessage ?? '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_, row) => (
        <Space>
          <Button type="link" size="small" onClick={() => setDetailSymbol(row.symbol)}>详情</Button>
          {row.llmStatus === 'FAILED' ? (
            <Button type="link" size="small" loading={props.retrying} onClick={() => handleRetry([row.symbol])}>重试</Button>
          ) : null}
        </Space>
      ),
    },
  ], [props.retrying]);

  const taskSummary = response?.task.result ?? props.task?.result;
  return (
    <>
      <Modal
        title="LLM 选股结果"
        open={Boolean(props.task)}
        onCancel={props.onClose}
        footer={null}
        width={1200}
        destroyOnHidden
      >
        {error ? <Alert type="error" showIcon title={error} className="mb-4" /> : null}
        <Descriptions
          size="small"
          className="mb-4"
          items={[
            { key: 'date', label: '数据日期', children: taskSummary?.dataDate ?? '-' },
            { key: 'coverage', label: '覆盖率', children: typeof taskSummary?.coverageRate === 'number' ? `${(taskSummary.coverageRate * 100).toFixed(1)}%` : '-' },
            { key: 'candidates', label: '候选数', children: taskSummary?.candidateCount ?? '-' },
            { key: 'tokens', label: 'Token', children: taskSummary?.totalTokens?.toLocaleString() ?? '-' },
          ]}
        />
        <Tabs
          activeKey={view}
          onChange={(key) => setView(key as ResultView)}
          items={[
            { key: 'selected', label: '最终入选' },
            { key: 'all', label: '全部候选' },
            { key: 'failed', label: '失败项' },
          ]}
          tabBarExtraContent={view === 'failed' ? (
            <Button
              type="primary"
              disabled={selectedSymbols.length === 0}
              loading={props.retrying}
              onClick={() => handleRetry(selectedSymbols)}
            >
              重试已选失败项
            </Button>
          ) : null}
        />
        <Table<LlmSelectionResult>
          rowKey="symbol"
          columns={columns}
          dataSource={response?.items ?? []}
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={false}
          rowSelection={view === 'failed' ? {
            selectedRowKeys: selectedSymbols,
            getCheckboxProps: (row) => ({ disabled: row.llmStatus !== 'FAILED' }),
            onChange: (keys) => setSelectedSymbols(keys.map(String)),
          } : undefined}
        />
      </Modal>
      <StockEvidenceDrawer
        taskId={props.task?.id ?? null}
        symbol={detailSymbol}
        onClose={() => setDetailSymbol(null)}
      />
    </>
  );
}

function StockEvidenceDrawer(props: { taskId: string | null; symbol: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<LlmSelectionStockDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!props.taskId || !props.symbol) {
      setDetail(null);
      setError(null);
      return;
    }
    setLoading(true);
    request(api['llm-stock-selections']({ id: props.taskId }).results({ symbol: props.symbol }).get())
      .then((data) => {
        if (!active) return;
        setDetail(data);
      })
      .catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, '加载股票证据失败'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [props.symbol, props.taskId]);

  const result = detail?.result;
  return (
    <Drawer
      title={result ? `${result.stockName ?? result.symbol} · ${result.symbol}` : '股票分析证据'}
      open={Boolean(props.symbol)}
      onClose={props.onClose}
      size={720}
      loading={loading}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon title={error} /> : null}
      {result?.judgment ? (
        <Space orientation="vertical" size="middle" className="w-full">
          <Descriptions
            bordered
            size="small"
            items={[
              { key: 'score', label: 'LLM 分数', children: result.judgment.selectionScore },
              { key: 'confidence', label: '置信度', children: `${(result.judgment.confidence * 100).toFixed(0)}%` },
              { key: 'outlook', label: '展望', children: result.judgment.outlook },
              { key: 'quant', label: '量化排名', children: result.quantitativeRank ?? '-' },
            ]}
          />
          <div>
            <Title level={5}>结论</Title>
            <Paragraph>{result.judgment.summary}</Paragraph>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <List size="small" header={<Text strong>优势</Text>} dataSource={result.judgment.strengths} renderItem={(item) => <List.Item>{item}</List.Item>} />
            <List size="small" header={<Text strong>风险</Text>} dataSource={result.judgment.risks} renderItem={(item) => <List.Item>{item}</List.Item>} />
          </div>
          <List
            size="small"
            header={<Text strong>关键证据</Text>}
            dataSource={result.judgment.keySignals}
            renderItem={(signal) => <List.Item><Text strong>{signal.category} · {signal.name}</Text><Text>{signal.interpretation}</Text></List.Item>}
          />
          <div>
            <Title level={5}>输入快照</Title>
            <pre className="max-h-96 overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-100">
              {JSON.stringify(result.inputSnapshot, null, 2)}
            </pre>
          </div>
          <List
            size="small"
            header={<Text strong>尝试历史</Text>}
            dataSource={detail?.attempts ?? []}
            renderItem={(attempt) => (
              <List.Item>
                第 {attempt.attemptNo} 次 · {attempt.status} · {attempt.modelName ?? '-'} · {attempt.totalTokens} Token
                {attempt.errorMessage ? ` · ${attempt.errorMessage}` : ''}
              </List.Item>
            )}
          />
        </Space>
      ) : result ? (
        <Alert type="warning" showIcon title={result.exclusionMessage ?? result.latestErrorMessage ?? '该股票暂无成功分析结果'} />
      ) : null}
    </Drawer>
  );
}
