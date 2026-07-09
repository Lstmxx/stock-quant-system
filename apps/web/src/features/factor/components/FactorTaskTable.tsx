import React from 'react';
import { Button, Tag, Popconfirm, Space } from 'antd';
import { BaseTable } from '../../../components/Base/BaseTable';
import dayjs from 'dayjs';
import { FactorTask } from '../types';

interface Props {
  tasks: FactorTask[];
  loading: boolean;
  onCancelTask: (id: string) => void;
  onViewLogs: (id: string) => void;
}

export const FactorTaskTable: React.FC<Props> = ({ tasks, loading, onCancelTask, onViewLogs }) => {
  const columns = [
    {
      title: '执行时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (val: string | Date) => dayjs(val).format('YYYY-MM-DD HH:mm:ss')
    },
    {
      title: '标的代码',
      dataIndex: 'params',
      key: 'targetSymbol',
      render: (params: any) => params?.targetSymbol || '-'
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
      render: (_: any, record: FactorTask) => (
        <Space size="middle">
          <Button type="link" onClick={() => onViewLogs(record.id)}>
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
      rowKey="id"
      dataSource={tasks}
      columns={columns}
      loading={loading}
    />
  );
};
