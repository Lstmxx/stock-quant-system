import { Button, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';

import type { LlmSelectionTask } from '../types';

const { Text } = Typography;
const activeStatuses = new Set(['PENDING', 'RUNNING', 'CANCELLING']);
const statusColors: Record<string, string> = {
  PENDING: 'gold',
  RUNNING: 'processing',
  CANCELLING: 'orange',
  COMPLETED: 'success',
  PARTIAL_SUCCESS: 'warning',
  FAILED: 'error',
  CANCELLED: 'default',
};

interface Props {
  tasks: LlmSelectionTask[];
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  rowActionId: string | null;
  onPageChange: (page: number, pageSize: number) => void;
  onView: (task: LlmSelectionTask) => void;
  onCancel: (taskId: string) => void;
}

export function LlmSelectionTaskTable(props: Props) {
  const columns: TableColumnsType<LlmSelectionTask> = [
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 175,
      render: (value: string | Date) => dayjs(value).format('YYYY-MM-DD HH:mm:ss'),
    },
    { title: '数据日期', dataIndex: 'result', width: 115, render: (result) => result.dataDate ?? '-' },
    { title: '模型', dataIndex: 'params', width: 150, render: (params) => params?.llmModelDisplayName ?? '-' },
    {
      title: '配置',
      dataIndex: 'params',
      render: (params) => params ? `Top ${params.candidateCount} → ${params.finalTopN} · ${params.lookbackDays}日` : '-',
    },
    {
      title: '覆盖率',
      dataIndex: 'result',
      width: 100,
      render: (result) => typeof result.coverageRate === 'number' ? `${(result.coverageRate * 100).toFixed(1)}%` : '-',
    },
    {
      title: '候选/失败',
      dataIndex: 'result',
      width: 110,
      render: (result) => `${result.candidateCount ?? '-'} / ${result.failedCount ?? '-'}`,
    },
    {
      title: 'Token',
      dataIndex: 'result',
      width: 100,
      render: (result) => result.totalTokens?.toLocaleString() ?? '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 125,
      render: (status: string) => <Tag color={statusColors[status]}>{status}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_, task) => (
        <Space>
          <Button type="link" size="small" onClick={() => props.onView(task)}>
            查看结果
          </Button>
          {activeStatuses.has(task.status) ? (
            <Button
              danger
              type="link"
              size="small"
              loading={props.rowActionId === task.id}
              disabled={task.status === 'CANCELLING'}
              onClick={() => props.onCancel(task.id)}
            >
              {task.status === 'CANCELLING' ? '正在取消' : '取消'}
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <>
      <Table<LlmSelectionTask>
        rowKey="id"
        columns={columns}
        dataSource={props.tasks}
        loading={props.loading}
        scroll={{ x: 1100 }}
        pagination={{
          current: props.page,
          pageSize: props.pageSize,
          total: props.total,
          showSizeChanger: true,
          onChange: props.onPageChange,
        }}
      />
      {props.tasks.length === 0 && !props.loading ? (
        <Text type="secondary">暂无 LLM 选股任务</Text>
      ) : null}
    </>
  );
}
