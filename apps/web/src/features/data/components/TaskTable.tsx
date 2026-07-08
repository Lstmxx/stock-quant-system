import React from 'react';
import { Button, Tag, Popconfirm, Space, Popover, Typography } from 'antd';
import { BaseTable } from '../../../components/Base/BaseTable';
import dayjs from 'dayjs';
import { Task } from '../types';

interface Props {
  tasks: Task[];
  loading: boolean;
  onViewTask: (task: Task) => void;
  onCancelTask: (id: string) => void;
}

export const TaskTable: React.FC<Props> = ({ tasks, loading, onViewTask, onCancelTask }) => {
  const columns = [
    {
      title: '执行时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (val: string | Date) => dayjs(val).format('YYYY-MM-DD HH:mm:ss')
    },
    {
      title: '执行结果',
      dataIndex: 'result',
      key: 'result',
      render: (result: Record<string, any>) => {
        if (!result) return '-';
        
        const content = (
          <div style={{ maxWidth: 300 }}>
            {Object.entries(result).map(([key, value]) => (
              <div key={key} style={{ marginBottom: 4 }}>
                <Typography.Text type="secondary">{key}: </Typography.Text>
                <Typography.Text strong>{String(value)}</Typography.Text>
              </div>
            ))}
          </div>
        );

        return (
          <Popover content={content} title="总结" trigger="hover">
            <Tag color="processing" style={{ cursor: 'pointer' }}>查看总结</Tag>
          </Popover>
        );
      },
    },
    {
      title: '触发者',
      dataIndex: 'userId',
      key: 'userId',
      render: (val: string) => val === 'system' ? <Tag color="blue">System (Cron)</Tag> : <Tag color="green">Manual</Tag>
    },
    {
      title: '回溯天数',
      dataIndex: 'params',
      key: 'days',
      render: (params: any) => params?.days || '-'
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const colorMap: Record<string, string> = {
          'PENDING': 'default',
          'RUNNING': 'processing',
          'COMPLETED': 'success',
          'FAILED': 'error',
          'CANCELLED': 'warning'
        };
        return <Tag color={colorMap[status]}>{status}</Tag>;
      }
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Task) => (
        <Space size="middle">
          <Button type="link" onClick={() => onViewTask(record)}>
            查看
          </Button>
          {(record.status === 'RUNNING' || record.status === 'PENDING') && (
            <Popconfirm title="确定要终止该任务吗?" onConfirm={() => onCancelTask(record.id)}>
              <Button type="link" danger>
                终止
              </Button>
            </Popconfirm>
          )}
        </Space>
      )
    }
  ];

  return (
    <BaseTable
      dataSource={tasks}
      columns={columns}
      loading={loading}
    />
  );
};
