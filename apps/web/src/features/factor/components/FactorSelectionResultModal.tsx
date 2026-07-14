import { useEffect, useState } from 'react';
import { Alert, Descriptions, Modal, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';

import { api } from '../../../api/api';
import type { FactorSelectionDetail, FactorSelectionResult } from '../types';

const { Text } = Typography;

interface Props {
  taskId: string | null;
  onClose: () => void;
}

export function FactorSelectionResultModal({ taskId, onClose }: Props) {
  const [detail, setDetail] = useState<FactorSelectionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!taskId) {
      setDetail(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    api['factor-selections']({ id: taskId }).get().then(({ data, error: requestError }) => {
      if (!active) return;
      if (data && 'results' in data) setDetail(data);
      else setError(requestError ? '加载选股结果失败' : '任务结果不存在');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [taskId]);

  const columns: TableColumnsType<FactorSelectionResult> = [
    { title: '排名', dataIndex: 'rank', width: 72 },
    { title: '股票代码', dataIndex: 'symbol', width: 140 },
    {
      title: '综合得分',
      dataIndex: 'compositeScore',
      render: (value: number) => value.toFixed(4),
    },
    { title: '数据日期', dataIndex: 'dataDate', width: 120 },
  ];

  return (
    <Modal
      title="选股任务 Top N"
      open={Boolean(taskId)}
      onCancel={onClose}
      footer={null}
      width={1000}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon title={error} className="mb-4" /> : null}
      {detail ? (
        <Descriptions
          size="small"
          className="mb-4"
          items={[
            { key: 'status', label: '状态', children: <Tag>{detail.task.status}</Tag> },
            { key: 'createdAt', label: '创建时间', children: String(detail.task.createdAt) },
            { key: 'count', label: '结果数量', children: detail.results.length },
          ]}
        />
      ) : null}
      <Table<FactorSelectionResult>
        rowKey="id"
        columns={columns}
        dataSource={detail?.results ?? []}
        loading={loading}
        pagination={false}
        size="small"
        expandable={{
          expandedRowRender: (record) => (
            <Table
              rowKey="factorId"
              size="small"
              pagination={false}
              dataSource={record.factorContributions}
              columns={[
                { title: '因子', dataIndex: 'name' },
                { title: '原始值', dataIndex: 'value', render: (value: number) => value.toFixed(4) },
                { title: '方向', dataIndex: 'direction', render: (value: number) => value === -1 ? '负向' : '正向' },
                { title: 'Z 分数', dataIndex: 'zScore', render: (value: number) => value.toFixed(4) },
                { title: '权重', dataIndex: 'weight', render: (value: number) => `${(value * 100).toFixed(1)}%` },
                { title: '百分位', dataIndex: 'percentile', render: (value: number) => `${value.toFixed(1)}%` },
                { title: '贡献', dataIndex: 'contribution', render: (value: number) => <Text>{value.toFixed(4)}</Text> },
              ]}
            />
          ),
        }}
      />
    </Modal>
  );
}
