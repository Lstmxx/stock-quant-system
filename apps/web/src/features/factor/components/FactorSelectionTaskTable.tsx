import { Button, Space, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';

import type { FactorSelectionTask } from '../types';

interface Props {
  tasks: FactorSelectionTask[];
  loading: boolean;
  total: number;
  current: number;
  pageSize: number;
  onPageChange: (page: number, pageSize: number) => void;
  onView: (taskId: string) => void;
}

export function FactorSelectionTaskTable(props: Props) {
  const columns: TableColumnsType<FactorSelectionTask> = [
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      render: (value: string | Date) => dayjs(value).format('YYYY-MM-DD HH:mm:ss'),
    },
    { title: '股票池', dataIndex: 'params', render: (params: unknown) => readParam(params, 'universeType') === 'WATCHLIST' ? '我的自选股' : '全市场' },
    { title: '因子模式', dataIndex: 'params', render: (params: unknown) => readParam(params, 'selectionMode') || '-' },
    { title: '因子数', dataIndex: 'params', render: (params: unknown) => readArrayLength(params, 'factorIds') },
    { title: 'Top N', dataIndex: 'params', render: (params: unknown) => readParam(params, 'topN') || '-' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (status: string) => <Tag color={statusColor[status] ?? 'default'}>{statusLabel[status] ?? status}</Tag>,
    },
    { title: '结果摘要', dataIndex: 'result', render: (result: unknown) => readResult(result) },
    {
      title: '操作',
      render: (_, task) => (
        <Space>
          <Button
            type="link"
            disabled={task.status !== 'COMPLETED'}
            onClick={() => props.onView(task.id)}
          >
            查看 Top N
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={props.tasks}
      loading={props.loading}
      pagination={{
        current: props.current,
        pageSize: props.pageSize,
        total: props.total,
        showSizeChanger: true,
        onChange: props.onPageChange,
      }}
      scroll={{ x: 900 }}
    />
  );
}

const statusColor: Record<string, string> = {
  PENDING: 'default',
  RUNNING: 'processing',
  CANCELLING: 'warning',
  COMPLETED: 'success',
  FAILED: 'error',
  CANCELLED: 'warning',
};

const statusLabel: Record<string, string> = {
  PENDING: '等待中',
  RUNNING: '运行中',
  CANCELLING: '正在取消',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
};

function readParam(params: unknown, key: string): string {
  if (!params || typeof params !== 'object' || !(key in params)) return '';
  const value = (params as Record<string, unknown>)[key];
  return value === null || value === undefined ? '' : String(value);
}

function readArrayLength(params: unknown, key: string): number | '-' {
  if (!params || typeof params !== 'object' || !(key in params)) return '-';
  const value = (params as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.length : '-';
}

function readResult(result: unknown): string {
  if (!result || typeof result !== 'object') return '-';
  const values = result as Record<string, unknown>;
  const error = values.error ?? values.detail ?? values.message;
  if (error !== undefined) return String(error);
  return Object.entries(values)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('；') || '-';
}
