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
      title: '研究方向',
      dataIndex: 'params',
      key: 'researchDirection',
      render: (params: unknown) => readTaskParam(params, 'researchDirection') || readTaskParam(params, 'targetSymbol') || '-'
    },
    {
      title: '回溯天数',
      dataIndex: 'params',
      key: 'days',
      render: (params: unknown) => readTaskParam(params, 'days') || '-'
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const colorMap: Record<string, string> = {
          'PENDING': 'default',
          'RUNNING': 'processing',
          'CANCELLING': 'warning',
          'COMPLETED': 'success',
          'FAILED': 'error',
          'CANCELLED': 'warning'
        };
        return <Tag color={colorMap[status]}>{statusLabels[status] ?? status}</Tag>;
      }
    },
    {
      title: '结果摘要',
      dataIndex: 'result',
      key: 'result',
      render: (result: unknown) => readTaskResult(result),
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

const statusLabels: Record<string, string> = {
  PENDING: '等待中',
  RUNNING: '运行中',
  CANCELLING: '正在取消',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
};

function readTaskParam(params: unknown, key: string): string {
  if (!params || typeof params !== 'object' || !(key in params)) return '';
  const value = (params as Record<string, unknown>)[key];
  return value === null || value === undefined ? '' : String(value);
}

function readTaskResult(result: unknown): string {
  if (!result || typeof result !== 'object') return '-';
  const values = result as Record<string, unknown>;
  const error = values.error ?? values.detail ?? values.message;
  if (error !== undefined) return String(error);
  return Object.entries(values)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('；') || '-';
}
