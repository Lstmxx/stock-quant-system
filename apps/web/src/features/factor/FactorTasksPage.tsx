import React, { useState, useEffect, useRef } from 'react';
import { Button, Card, Space, Drawer, Typography } from 'antd';
import { PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { useFactorTasks } from './hooks/useFactorTasks';
import { useTaskLogsPolling } from './hooks/useTaskLogsPolling';
import { FactorTaskTable } from './components/FactorTaskTable';
import { CreateMiningTaskModal } from './components/CreateMiningTaskModal';
import { FactorTaskConfigModal } from './components/FactorTaskConfigModal';

const { Text } = Typography;

const FactorTasksPage: React.FC = () => {
  const { tasks, loading, handleCreateTask, handleCancelTask } = useFactorTasks();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isConfigVisible, setIsConfigVisible] = useState(false);
  
  // Drawer and polling state
  const [activeLogTaskId, setActiveLogTaskId] = useState<string | null>(null);
  const { logs } = useTaskLogsPolling(activeLogTaskId);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async (targetSymbol: string, days?: number) => {
    await handleCreateTask(targetSymbol, days);
  };

  const handleViewLogs = (taskId: string) => {
    setActiveLogTaskId(taskId);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    if (activeLogTaskId && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeLogTaskId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Card
        title=""
        extra={
          <Space>
            <Button
              icon={<SettingOutlined />}
              onClick={() => setIsConfigVisible(true)}
            >
              任务配置
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setIsModalVisible(true)}
            >
              发起挖掘任务
            </Button>
          </Space>
        }
      >
        <FactorTaskTable 
          tasks={tasks} 
          loading={loading} 
          onCancelTask={handleCancelTask} 
          onViewLogs={handleViewLogs}
        />
      </Card>

      <CreateMiningTaskModal
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        onSubmit={handleSubmit}
      />

      <FactorTaskConfigModal
        open={isConfigVisible}
        onCancel={() => setIsConfigVisible(false)}
      />

      <Drawer
        title="任务日志"
        placement="right"
        width={800}
        onClose={() => setActiveLogTaskId(null)}
        open={!!activeLogTaskId}
        styles={{ body: { backgroundColor: '#1e1e1e', padding: '16px' } }}
      >
        <div style={{ fontFamily: 'monospace', color: '#00ff00', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
          {logs.length === 0 ? (
            <Text style={{ color: '#00ff00' }}>Waiting for logs...</Text>
          ) : (
            logs.map((log, index) => (
              <div key={index}>{log}</div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </Drawer>
    </div>
  );
};

export default FactorTasksPage;
