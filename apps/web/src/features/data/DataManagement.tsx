import React, { useState } from 'react';
import { Button, Space, Card } from 'antd';
import { SettingOutlined, SyncOutlined } from '@ant-design/icons';
import { useTasks } from './hooks/useTasks';
import { TaskTable } from './components/TaskTable';
import { TaskDetailModal } from './components/TaskDetailModal';
import { DataCollectionConfigModal } from './components/DataCollectionConfigModal';
import { Task } from './types';

const DataManagement: React.FC = () => {
  const { tasks, loading, activeTaskId, fetchTasks, handleRunNow, handleCancelTask } = useTasks();

  const [isConfigModalVisible, setIsConfigModalVisible] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isDetailModalVisible, setIsDetailModalVisible] = useState(false);

  const handleViewTask = (task: Task) => {
    setSelectedTask(task);
    setIsDetailModalVisible(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Card
        title=""
        extra={
          <Space>
            <Button icon={<SettingOutlined />} onClick={() => setIsConfigModalVisible(true)}>设置</Button>
            <Button type="primary" icon={<SyncOutlined />} onClick={handleRunNow}>
              立即更新
            </Button>
          </Space>
        }
      >
        <TaskTable tasks={tasks} loading={loading} onViewTask={handleViewTask} onCancelTask={handleCancelTask} />
      </Card>

      <TaskDetailModal
        task={selectedTask}
        activeTaskId={activeTaskId}
        open={isDetailModalVisible}
        onCancel={() => setIsDetailModalVisible(false)}
        onRetryCreated={() => fetchTasks()}
      />

      <DataCollectionConfigModal
        open={isConfigModalVisible}
        onCancel={() => setIsConfigModalVisible(false)}
        onSuccess={fetchTasks}
      />
    </div>
  );
};

export default DataManagement;
