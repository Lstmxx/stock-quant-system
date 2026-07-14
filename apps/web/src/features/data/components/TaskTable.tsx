import React from 'react';
import { Button, Popconfirm, Popover, Space, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import { BaseTable } from '../../../components/Base/BaseTable';
import { isActiveTaskStatus, Task } from '../types';

interface Props {
  tasks: Task[];
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  cancellingId: string | null;
  onPageChange: (page: number, pageSize: number) => void;
  onViewTask: (task: Task) => void;
  onCancelTask: (id: string) => void;
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'default', label: '等待执行' },
  RUNNING: { color: 'processing', label: '采集中' },
  CANCELLING: { color: 'warning', label: '正在取消' },
  COMPLETED: { color: 'success', label: '已完成' },
  PARTIAL_SUCCESS: { color: 'warning', label: '部分成功' },
  FAILED: { color: 'error', label: '失败' },
  CANCELLED: { color: 'default', label: '已取消' },
};

function getParams(task: Task): Record<string, unknown> {
  return task.params && typeof task.params === 'object' && !Array.isArray(task.params)
    ? task.params as Record<string, unknown>
    : {};
}

export const TaskTable: React.FC<Props> = ({
  tasks,
  loading,
  total,
  page,
  pageSize,
  cancellingId,
  onPageChange,
  onViewTask,
  onCancelTask,
}) => {
  const columns: TableColumnsType<Task> = [
    {
      title: '执行时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: string | Date) => dayjs(value).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '执行结果',
      dataIndex: 'result',
      key: 'result',
      render: (result: unknown) => {
        if (!result || typeof result !== 'object' || Array.isArray(result)) return '-';
        const entries = Object.entries(result as Record<string, unknown>);
        return (
          <Popover
            title="执行总结"
            trigger={['hover', 'click']}
            content={(
              <div style={{ maxWidth: 360 }}>
                {entries.map(([key, value]) => (
                  <div key={key} style={{ marginBottom: 4 }}>
                    <Typography.Text type="secondary">{key}: </Typography.Text>
                    <Typography.Text strong>{String(value)}</Typography.Text>
                  </div>
                ))}
              </div>
            )}
          >
            <Button type="link" size="small">查看总结</Button>
          </Popover>
        );
      },
    },
    {
      title: '触发方式',
      key: 'trigger',
      render: (_, task) => {
        const trigger = getParams(task).trigger;
        if (trigger === 'SCHEDULED' || task.userId === null) return <Tag color="blue">定时任务</Tag>;
        if (trigger === 'RETRY') return <Tag color="orange">失败重试</Tag>;
        return <Tag color="green">手动触发</Tag>;
      },
    },
    {
      title: '回溯参数',
      key: 'days',
      render: (_, task) => String(getParams(task).days ?? '-'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const meta = STATUS_META[status] ?? { color: 'default', label: status };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_, task) => (
        <Space size="small">
          <Button type="link" onClick={() => onViewTask(task)}>查看</Button>
          {isActiveTaskStatus(task.status) && task.status !== 'CANCELLING' && (
            <Popconfirm
              title="确定要取消当前全局采集任务吗？"
              description="运行中的任务会在下一个股票检查点停止。"
              onConfirm={() => onCancelTask(task.id)}
            >
              <Button type="link" danger loading={cancellingId === task.id}>取消</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <BaseTable<Task>
      dataSource={tasks}
      columns={columns}
      loading={loading}
      pagination={{
        current: page,
        pageSize,
        total,
        showTotal: (count) => `共 ${count} 条任务`,
        onChange: onPageChange,
      }}
    />
  );
};
