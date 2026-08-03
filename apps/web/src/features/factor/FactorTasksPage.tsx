import React, { useState, useEffect, useRef } from 'react';
import { Alert, Button, Card, Space, Drawer, Typography } from 'antd';
import { Plus, Settings2 } from 'lucide-react';
import { useFactorTasks } from './hooks/useFactorTasks';
import { useTaskLogsPolling } from './hooks/useTaskLogsPolling';
import { FactorTaskTable } from './components/FactorTaskTable';
import { CreateMiningTaskModal } from './components/CreateMiningTaskModal';
import { FactorTaskConfigModal } from './components/FactorTaskConfigModal';
import type { ResearchDirection } from './components/CreateMiningTaskModal';

const { Text } = Typography;

const FactorTasksPage: React.FC = () => {
  const { tasks, loading, handleCreateTask, handleCancelTask } = useFactorTasks();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isConfigVisible, setIsConfigVisible] = useState(false);
  
  // Drawer and polling state
  const [activeLogTaskId, setActiveLogTaskId] = useState<string | null>(null);
  const activeLogTask = tasks.find((task) => task.id === activeLogTaskId);
  const { logs, error: logsError } = useTaskLogsPolling(activeLogTaskId, activeLogTask?.status);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async (researchDirection: ResearchDirection, days: number) => {
    return handleCreateTask(researchDirection, days);
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
              icon={<Settings2 size={16} />}
              onClick={() => setIsConfigVisible(true)}
            >
              任务配置
            </Button>
            <Button
              type="primary"
              icon={<Plus size={16} />}
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
        size="large"
        onClose={() => setActiveLogTaskId(null)}
        open={!!activeLogTaskId}
        classNames={{ body: 'factor-log-drawer' }}
      >
        {logsError ? <Alert type="error" showIcon title={logsError} className="mb-4" /> : null}
        <div className="factor-log-output">
          {logs.length === 0 ? (
            <Text className="factor-log-muted">Waiting for logs...</Text>
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
