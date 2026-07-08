import React, { useState, useEffect } from 'react';
import { Table, Button, Badge, Modal, Form, Input, Drawer, Empty } from 'antd';
import { PlayCircleOutlined, CodeOutlined } from '@ant-design/icons';
import { api } from '../../api/api';

interface Task {
  id: string;
  type: string;
  status: string;
  params: Record<string, any> | null;
  result: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

const statusColor: Record<string, string> = {
  PENDING: 'warning',
  RUNNING: 'processing',
  COMPLETED: 'success',
  FAILED: 'error'
};

import { useSSELogStream } from '../../hooks/useSSE';

const Dashboard: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  
  const [showLogsDrawer, setShowLogsDrawer] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState('');
  
  const { streamLogs, connect, disconnect } = useSSELogStream();
  const [form] = Form.useForm();

  const fetchTasks = async () => {
    try {
      const { data } = await api.tasks.get();
      if (data) setTasks(data as unknown as Task[]);
    } catch (err) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const submitTask = async (values: any) => {
    setSubmitting(true);
    try {
      await api.tasks.mining.post({ targetSymbol: values.targetSymbol });
      setShowNewTaskModal(false);
      form.resetFields();
      await fetchTasks();
    } finally {
      setSubmitting(false);
    }
  };

  const viewLogs = (taskId: string) => {
    setActiveTaskId(taskId);
    setShowLogsDrawer(true);
    connect(`/tasks/${taskId}/stream`);
  };

  const closeLogs = () => {
    setShowLogsDrawer(false);
    disconnect();
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, []);

  const columns = [
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Badge status={statusColor[status] as any || 'default'} text={status} />
      ),
    },
    {
      title: 'Target',
      dataIndex: 'params',
      key: 'params',
      render: (params: any) => params?.targetSymbol || '—',
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (createdAt: string) => new Date(createdAt).toLocaleString(),
    },
    {
      title: 'Action',
      key: 'action',
      render: (_: any, record: Task) => (
        (record.status === 'RUNNING' || record.status === 'COMPLETED') && (
          <Button type="link" size="small" icon={<CodeOutlined />} onClick={() => viewLogs(record.id)}>
            Logs
          </Button>
        )
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2>Analysis Dashboard</h2>
        <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setShowNewTaskModal(true)}>
          New Analysis
        </Button>
      </div>

      <Table 
        dataSource={tasks} 
        columns={columns} 
        rowKey="id" 
        loading={loading} 
        locale={{ emptyText: <Empty description="No analysis tasks yet. Click 'New Analysis' to start." /> }}
      />

      <Modal
        title="Start New Analysis"
        open={showNewTaskModal}
        onCancel={() => setShowNewTaskModal(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={submitTask}>
          <Form.Item name="targetSymbol" label="Target Symbol" rules={[{ required: true }]}>
            <Input placeholder="e.g. sh.600000" />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Button onClick={() => setShowNewTaskModal(false)} style={{ marginRight: 8 }}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={submitting}>Start Mining</Button>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={`Task Logs: ${activeTaskId}`}
        placement="right"
        width={600}
        onClose={closeLogs}
        open={showLogsDrawer}
      >
        <div style={{ background: '#141414', padding: 16, height: '100%', overflowY: 'auto', color: '#4af626', fontFamily: 'monospace', borderRadius: 8 }}>
          {streamLogs.length === 0 ? (
            <div style={{ color: '#888', fontStyle: 'italic' }}>Waiting for logs...</div>
          ) : (
            streamLogs.map((log, idx) => <div key={idx}>{log}</div>)
          )}
        </div>
      </Drawer>
    </div>
  );
};

export default Dashboard;
