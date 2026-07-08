import React, { useState } from 'react';
import { Button, Space, Card, Row, Col, Typography } from 'antd';
import { DatabaseOutlined, SettingOutlined, SyncOutlined } from '@ant-design/icons';
import { useTasks } from './hooks/useTasks';
import { TaskTable } from './components/TaskTable';
import { TaskDetailModal } from './components/TaskDetailModal';
import { DataCollectionConfigModal } from './components/DataCollectionConfigModal';
import { Task } from './types';

const { Title } = Typography;

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
      <Row justify="space-between" align="middle">
        <Col>
          <Title level={3} style={{ margin: 0 }}>
            <DatabaseOutlined style={{ marginRight: 8 }} />
            股票数据管理
          </Title>
        </Col>
        <Col>
          <Space>
            <Button icon={<SettingOutlined />} onClick={() => setIsConfigModalVisible(true)}>设置</Button>
            <Button type="primary" icon={<SyncOutlined />} onClick={handleRunNow}>
              立即更新
            </Button>
          </Space>
        </Col>
      </Row>

      <Row gutter={[24, 24]}>
        <Col span={24}>
          <Card title="历史记录" bordered={false}>
            <TaskTable tasks={tasks} loading={loading} onViewTask={handleViewTask} onCancelTask={handleCancelTask} />
          </Card>
        </Col>
      </Row>

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
