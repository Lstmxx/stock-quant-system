import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Space, Tag } from 'antd';
import { BrainCircuit, Plus } from 'lucide-react';

import { api } from '../../api/api';
import { getApiErrorMessage, request } from '../../api/request';
import type { LlmModel } from '../llm/types';
import { CreateLlmSelectionModal } from './components/create-llm-selection-modal';
import { LlmSelectionResultModal } from './components/llm-selection-result-modal';
import { LlmSelectionTaskTable } from './components/llm-selection-task-table';
import { useLlmStockSelections } from './hooks/use-llm-stock-selections';
import type { LlmSelectionTask } from './types';

interface RunOptions {
  models: LlmModel[];
  factorMode: 'AUTO' | 'MANUAL' | null;
  factorCount: number;
  watchlistCount: number;
}

const emptyOptions: RunOptions = {
  models: [],
  factorMode: null,
  factorCount: 0,
  watchlistCount: 0,
};

export default function LlmStockSelectionPage() {
  const { message } = App.useApp();
  const selections = useLlmStockSelections();
  const [createOpen, setCreateOpen] = useState(false);
  const [activeResultTask, setActiveResultTask] = useState<LlmSelectionTask | null>(null);
  const [options, setOptions] = useState<RunOptions>(emptyOptions);

  const fetchOptions = useCallback(async () => {
    try {
      const [models, factors, watchlists] = await Promise.all([
        request(api.llm.get()),
        request(api.factors.selection.get()),
        request(api.watchlists.get()),
      ]);
      setOptions({
        models,
        factorMode: factors.mode,
        factorCount: factors.factorIds.length,
        watchlistCount: watchlists.length,
      });
    } catch (error) {
      message.error(getApiErrorMessage(error, '加载选股配置失败'));
    }
  }, [message]);

  useEffect(() => {
    void fetchOptions();
  }, [fetchOptions]);

  const handleOpenCreate = () => {
    void fetchOptions();
    setCreateOpen(true);
  };

  return (
    <Space orientation="vertical" size="large" className="w-full">
      <Alert
        showIcon
        type="info"
        title="两阶段 LLM 选股"
        description="先对沪深主板执行全市场量化排名，再分析 Top M 与自选股并集。所有候选、失败原因和模型尝试均可追溯。"
      />
      {selections.activeTask ? (
        <Alert
          showIcon
          type="warning"
          title={`任务 ${selections.activeTask.status}`}
          description="同一用户一次只能运行一个 LLM 选股任务；取消为协作式过程。"
        />
      ) : null}
      <Card
        title={<Space><BrainCircuit size={17} />LLM 选股任务{selections.activeTask ? <Tag color="processing">运行中</Tag> : null}</Space>}
        extra={<Button type="primary" icon={<Plus size={16} />} disabled={Boolean(selections.activeTask)} onClick={handleOpenCreate}>发起分析</Button>}
      >
        <LlmSelectionTaskTable
          tasks={selections.tasks}
          loading={selections.loading}
          total={selections.total}
          page={selections.page}
          pageSize={selections.pageSize}
          rowActionId={selections.rowActionId}
          onPageChange={(page, pageSize) => {
            selections.setPage(page);
            selections.setPageSize(pageSize);
          }}
          onView={setActiveResultTask}
          onCancel={selections.cancelTask}
        />
      </Card>
      <CreateLlmSelectionModal
        open={createOpen}
        submitting={selections.submitting}
        models={options.models}
        factorMode={options.factorMode}
        factorCount={options.factorCount}
        watchlistCount={options.watchlistCount}
        onCancel={() => setCreateOpen(false)}
        onSubmit={async (values) => {
          const success = await selections.createTask(values);
          if (success) setCreateOpen(false);
          return success;
        }}
      />
      <LlmSelectionResultModal
        task={activeResultTask}
        retrying={Boolean(selections.rowActionId)}
        onClose={() => setActiveResultTask(null)}
        onRetry={selections.retryFailed}
      />
    </Space>
  );
}
