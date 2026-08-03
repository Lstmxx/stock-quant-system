import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Space, Tooltip } from 'antd';
import { RefreshCw, Settings2 } from 'lucide-react';
import { DataCollectionConfigModal } from './components/DataCollectionConfigModal';
import { TaskDetailModal } from './components/TaskDetailModal';
import { TaskTable } from './components/TaskTable';
import { useTasks } from './hooks/useTasks';

const DataManagement: React.FC = () => {
  const {
    tasks,
    total,
    page,
    pageSize,
    loading,
    running,
    cancellingId,
    error,
    activeTask,
    fetchTasks,
    changePage,
    handleRunNow,
    handleCancelTask,
  } = useTasks();
  const [isConfigModalVisible, setIsConfigModalVisible] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isDetailModalVisible, setIsDetailModalVisible] = useState(false);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <Alert title={error} type="error" showIcon />}
      {activeTask && (
        <Alert
          title={`全局采集任务正在${activeTask.status === 'CANCELLING' ? '取消' : '执行'}，完成前不能重复启动。`}
          type="info"
          showIcon
        />
      )}
      <Card
        extra={(
          <Space>
            <Button icon={<Settings2 size={16} />} onClick={() => setIsConfigModalVisible(true)}>
              全局设置
            </Button>
            <Tooltip title={activeTask ? '已有全局采集任务正在执行' : undefined}>
              <Button
                type="primary"
                icon={<RefreshCw size={16} className={running ? 'icon-spin' : undefined} />}
                loading={running}
                disabled={Boolean(activeTask)}
                onClick={handleRunNow}
              >
                立即更新
              </Button>
            </Tooltip>
          </Space>
        )}
      >
        <TaskTable
          tasks={tasks}
          loading={loading}
          total={total}
          page={page}
          pageSize={pageSize}
          cancellingId={cancellingId}
          onPageChange={changePage}
          onViewTask={(task) => {
            setSelectedTaskId(task.id);
            setIsDetailModalVisible(true);
          }}
          onCancelTask={handleCancelTask}
        />
      </Card>

      <TaskDetailModal
        task={selectedTask}
        activeTaskId={activeTask?.id ?? null}
        open={isDetailModalVisible}
        onCancel={() => setIsDetailModalVisible(false)}
        onRetryCreated={() => void fetchTasks()}
      />

      <DataCollectionConfigModal
        open={isConfigModalVisible}
        onCancel={() => setIsConfigModalVisible(false)}
        onSuccess={() => void fetchTasks()}
      />
    </div>
  );
};

export default DataManagement;
