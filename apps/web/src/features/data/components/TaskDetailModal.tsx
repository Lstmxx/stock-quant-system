import React, { useEffect, useState, useCallback } from 'react';
import { Alert, App, Button, Typography, Tag, Row, Col, Card, Progress, Table } from 'antd';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { BaseModal } from '../../../components/Base/BaseModal';
import { Task, FailedStocksResponse, isActiveTaskStatus, isTerminalTaskStatus } from '../types';
import { useTaskStream } from '../hooks/useTaskStream';
import { API_BASE_URL } from '../../../constant/config';

const { Text } = Typography;

interface Props {
  task: Task | null;
  activeTaskId: string | null;
  open: boolean;
  onCancel: () => void;
  onRetryCreated?: (newTaskId: string) => void;
}

export const TaskDetailModal: React.FC<Props> = ({ task, activeTaskId, open, onCancel, onRetryCreated }) => {
  const { message } = App.useApp();
  // Only poll stream if the modal is open and the selected task is active
  const isActive = Boolean(task && isActiveTaskStatus(task.status) && task.id === activeTaskId);
  const streamTaskId = open && isActive ? activeTaskId : null;

  const { workers, error: progressError } = useTaskStream(streamTaskId);

  // Failed stocks state
  const [failedStocks, setFailedStocks] = useState<FailedStocksResponse | null>(null);
  const [failedLoading, setFailedLoading] = useState(false);
  const [failedError, setFailedError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const isFinished = Boolean(task && isTerminalTaskStatus(task.status));

  const fetchFailedStocks = useCallback(async () => {
    if (!task || !isFinished) return;
    setFailedLoading(true);
    setFailedError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/tasks/${task.id}/failed-stocks`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: FailedStocksResponse = await res.json();
      setFailedStocks(data);
    } catch (e) {
      setFailedStocks(null);
      setFailedError('失败股票明细加载失败，请稍后重试');
    } finally {
      setFailedLoading(false);
    }
  }, [task, isFinished]);

  useEffect(() => {
    if (open && isFinished) {
      fetchFailedStocks();
    } else {
      setFailedStocks(null);
      setFailedError(null);
    }
  }, [open, isFinished, fetchFailedStocks]);

  const handleRetryFailed = async () => {
    if (!task) return;
    setRetrying(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/tasks/${task.id}/retry-failed`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        message.success(`已创建重试任务，共 ${data.stockCount} 只股票`);
        onRetryCreated?.(data.taskId);
        onCancel();
      } else {
        message.error(data.error || '创建重试任务失败');
      }
    } catch (e) {
      message.error('网络错误');
    } finally {
      setRetrying(false);
    }
  };

  const flashingStyle = {
    animation: 'flash 1s infinite alternate',
  };

  const failedColumns = [
    {
      title: '股票代码',
      dataIndex: 'code',
      key: 'code',
      render: (code: string) => <Tag color="red">{code}</Tag>,
    },
    {
      title: '最后错误',
      dataIndex: 'reason',
      key: 'reason',
      render: (reason: string) => <Text type="secondary">{reason}</Text>,
    },
  ];

  const failedDataSource = failedStocks?.failures.map((failure) => ({
    ...failure,
    key: failure.code,
  })) ?? [];
  const recordedFailedCount = isRecord(task?.result)
    && typeof task.result.failedCount === 'number'
    ? task.result.failedCount
    : 0;

  return (
    <>
      <style>
        {`
          @keyframes flash {
            0% { opacity: 1; }
            100% { opacity: 0.3; }
          }
        `}
      </style>
      <BaseModal
        title={`任务明细 - ${task?.id || ''}`}
        open={open}
        onCancel={onCancel}
        width={800}
        footer={[
          <Button key="close" onClick={onCancel}>
            关闭
          </Button>
        ]}
      >
        {task ? (
          <div>
            {/* Active task: show per-worker progress */}
            {isActive && (
              <div style={{ maxHeight: '40vh', overflowY: 'auto', padding: '10px 0', marginBottom: 16 }}>
                {progressError && (
                  <Alert title={progressError} type="warning" showIcon style={{ marginBottom: 12 }} />
                )}
                <Row gutter={[16, 16]}>
                  {Object.values(workers).map((worker) => {
                    const percent = worker.total > 0 ? Math.round(((worker.success + worker.failed) / worker.total) * 100) : 0;
                    return (
                      <Col span={12} key={worker.workerId}>
                        <Card size="small" title={`批次号: Worker ${worker.workerId}`}>
                          <div style={{ marginBottom: 8 }}>
                            <Text type="secondary">进度: </Text>
                            <Text>{worker.success + worker.failed} / {worker.total}</Text>
                          </div>
                          <Progress
                            percent={percent}
                            status={worker.status === 'running'
                              ? 'active'
                              : worker.status === 'completed'
                                ? 'success'
                                : worker.status === 'failed'
                                  ? 'exception'
                                  : 'normal'}
                          />
                          <div style={{ marginTop: 8, height: 24 }}>
                            {worker.status === 'running' && worker.currentCode && (
                              <Tag color="processing" style={flashingStyle}>
                                正在拉取: {worker.currentCode}
                              </Tag>
                            )}
                            {worker.status === 'completed' && (
                              <Tag color="success">完成</Tag>
                            )}
                            {worker.status === 'failed' && (
                              <Tag color="error">失败</Tag>
                            )}
                            {worker.status === 'partial' && (
                              <Tag color="warning">部分失败</Tag>
                            )}
                            {worker.status === 'cancelled' && (
                              <Tag color="default">已取消</Tag>
                            )}
                            {worker.status === 'idle' && (
                              <Tag color="default">等待中</Tag>
                            )}
                          </div>
                        </Card>
                      </Col>
                    );
                  })}
                  {Object.keys(workers).length === 0 && (
                    <Col span={24}>
                      <div className="empty-progress-state">
                        {task.type === 'DATA_COLLECTION' ? '等待 Engine 分配 Worker...' : '此任务类型暂不支持详细进度展示，后台正在执行中...'}
                      </div>
                    </Col>
                  )}
                </Row>
              </div>
            )}

            {/* Non-active task: show summary */}
            {!isActive && (
              <div className="task-summary-state">
                <p>该任务当前状态: <Tag>{task.status}</Tag></p>
                {isRecord(task.result) ? (
                  <div style={{ marginTop: 12 }}>
                    <Text strong>执行总结: </Text>
                    <div className="task-result-summary">
                      {Object.entries(task.result).map(([key, value]) => (
                        <div key={key} style={{ marginBottom: 4 }}>
                          <Text type="secondary">{key}: </Text>
                          <Text strong>{String(value)}</Text>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {/* Failed stocks section — only show for finished DATA_COLLECTION tasks */}
            {isFinished && task.type === 'DATA_COLLECTION' && (
              <div style={{ marginTop: 8 }}>
                {failedDataSource.length > 0 ? (
                  <>
                    <Alert
                      title={`发现 ${failedDataSource.length} 只股票采集失败`}
                      type="warning"
                      icon={<AlertTriangle size={16} />}
                      showIcon
                      style={{ marginBottom: 12 }}
                      action={
                        <Button
                          size="small"
                          type="primary"
                          danger
                          icon={<RefreshCw size={16} />}
                          loading={retrying}
                          onClick={handleRetryFailed}
                        >
                          一键重试
                        </Button>
                      }
                    />
                    <Table
                      size="small"
                      columns={failedColumns}
                      dataSource={failedDataSource}
                      pagination={{ pageSize: 10, size: 'small' }}
                      scroll={{ y: 200 }}
                    />
                  </>
                ) : failedError ? (
                  <Alert
                    title={failedError}
                    type="error"
                    showIcon
                    action={<Button size="small" onClick={fetchFailedStocks}>重新加载</Button>}
                  />
                ) : !failedLoading && failedStocks ? (
                  recordedFailedCount > 0 ? (
                    <Alert
                      title={`任务记录了 ${recordedFailedCount} 只失败股票，但明细已过期，无法直接重试`}
                      type="warning"
                      showIcon
                    />
                  ) : (
                    <Alert title="所有股票均已成功采集，无失败记录" type="success" showIcon />
                  )
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </BaseModal>
    </>
  );
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
