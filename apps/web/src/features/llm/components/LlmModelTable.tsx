import { Button, Empty, Popconfirm, Space, Tag, Tooltip, type TableColumnsType } from 'antd';
import {
  ApiOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons';

import { BaseTable } from '../../../components/Base/BaseTable';
import type { LlmRowAction } from '../hooks/useLlmModels';
import { PROVIDER_LABELS, type LlmModel } from '../types';

interface Props {
  data: LlmModel[];
  loading: boolean;
  rowActions: Record<string, LlmRowAction | undefined>;
  onAdd: () => void;
  onEdit: (record: LlmModel) => void;
  onDelete: (id: string) => Promise<boolean>;
  onSetDefault: (id: string) => Promise<boolean>;
  onTest: (id: string) => Promise<boolean>;
}

export function LlmModelTable({
  data,
  loading,
  rowActions,
  onAdd,
  onEdit,
  onDelete,
  onSetDefault,
  onTest,
}: Props) {
  const columns: TableColumnsType<LlmModel> = [
    {
      title: '配置名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '提供商',
      dataIndex: 'provider',
      key: 'provider',
      render: (provider: LlmModel['provider']) => PROVIDER_LABELS[provider],
    },
    {
      title: '模型名称',
      dataIndex: 'modelName',
      key: 'modelName',
    },
    {
      title: '密钥',
      dataIndex: 'hasApiKey',
      key: 'hasApiKey',
      render: (hasApiKey: boolean) => (
        <Tag color={hasApiKey ? 'success' : 'default'}>
          {hasApiKey ? '已配置' : '未配置'}
        </Tag>
      ),
    },
    {
      title: '默认',
      dataIndex: 'isDefault',
      key: 'isDefault',
      render: (isDefault: boolean) => (
        <Tag color={isDefault ? 'green' : 'default'}>{isDefault ? '是' : '否'}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => {
        const activeAction = rowActions[record.id];
        const actionDisabled = Boolean(activeAction);
        return (
          <Space size="small">
            <Tooltip title={record.isDefault ? '当前默认模型' : '设为默认模型'}>
              <Button
                type="text"
                icon={record.isDefault ? <StarFilled className="text-amber-500" /> : <StarOutlined />}
                aria-label={record.isDefault ? '当前默认模型' : `将 ${record.name} 设为默认模型`}
                disabled={record.isDefault || actionDisabled}
                loading={activeAction === 'default'}
                onClick={() => void onSetDefault(record.id)}
              />
            </Tooltip>
            <Tooltip title="测试连接">
              <Button
                type="text"
                icon={<ApiOutlined />}
                aria-label={`测试 ${record.name} 连接`}
                disabled={actionDisabled}
                loading={activeAction === 'test'}
                onClick={() => void onTest(record.id)}
              />
            </Tooltip>
            <Tooltip title="编辑配置">
              <Button
                type="text"
                icon={<EditOutlined />}
                aria-label={`编辑 ${record.name}`}
                disabled={actionDisabled}
                onClick={() => onEdit(record)}
              />
            </Tooltip>
            <Popconfirm
              title="删除大模型配置？"
              description="删除后无法恢复；若因子任务仍引用该模型，服务端会拒绝删除并提示先切换。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true, loading: activeAction === 'delete' }}
              disabled={actionDisabled}
              onConfirm={() => onDelete(record.id)}
            >
              <Tooltip title="删除配置">
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label={`删除 ${record.name}`}
                  disabled={actionDisabled}
                  loading={activeAction === 'delete'}
                />
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <BaseTable<LlmModel>
      columns={columns}
      dataSource={data}
      loading={loading}
      locale={{
        emptyText: (
          <Empty description="尚未配置大模型">
            <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
              新增配置
            </Button>
          </Empty>
        ),
      }}
    />
  );
}
