import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Space, Tag } from 'antd';
import { Plus } from 'lucide-react';

import { api } from '../../api/api';
import { CreateFactorSelectionModal } from './components/CreateFactorSelectionModal';
import { FactorSelectionResultModal } from './components/FactorSelectionResultModal';
import { FactorSelectionTaskTable } from './components/FactorSelectionTaskTable';
import { useFactorSelections } from './hooks/useFactorSelections';

interface FactorSetSummary {
  mode: 'AUTO' | 'MANUAL';
  factorIds: string[];
}

export default function FactorSelectionPage() {
  const selections = useFactorSelections();
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [factorSet, setFactorSet] = useState<FactorSetSummary | null>(null);

  const fetchFactorSet = useCallback(async () => {
    const { data } = await api.factors.selection.get();
    if (data) setFactorSet({ mode: data.mode, factorIds: data.factorIds });
  }, []);

  useEffect(() => {
    void fetchFactorSet();
  }, [fetchFactorSet]);

  return (
    <Space orientation="vertical" size="large" className="w-full">
      <Alert
        showIcon
        type="info"
        title="每次运行都会生成一条独立、可追溯的选股任务"
        description="完成后点击任务行的“查看 Top N”，可查看股票排名、综合得分和逐因子贡献。"
      />
      <Card
        title={(
          <Space>
            因子选股任务
            {factorSet ? <Tag color={factorSet.mode === 'MANUAL' ? 'blue' : 'green'}>{factorSet.mode} · {factorSet.factorIds.length} 个因子</Tag> : null}
          </Space>
        )}
        extra={(
          <Button type="primary" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
            新建选股任务
          </Button>
        )}
      >
        <FactorSelectionTaskTable
          tasks={selections.tasks}
          loading={selections.loading}
          total={selections.total}
          current={selections.current}
          pageSize={selections.pageSize}
          onPageChange={(page, size) => {
            selections.setCurrent(page);
            selections.setPageSize(size);
          }}
          onView={setActiveTaskId}
        />
      </Card>
      <CreateFactorSelectionModal
        open={createOpen}
        factorMode={factorSet?.mode ?? null}
        factorCount={factorSet?.factorIds.length ?? 0}
        onCancel={() => setCreateOpen(false)}
        onSubmit={selections.createTask}
      />
      <FactorSelectionResultModal taskId={activeTaskId} onClose={() => setActiveTaskId(null)} />
    </Space>
  );
}
