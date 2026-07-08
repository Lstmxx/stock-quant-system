import React from 'react';
import { Button, Space, Popconfirm, Tag } from 'antd';
import { BaseTable } from '../../../components/Base/BaseTable';
import { EditOutlined, DeleteOutlined, StarOutlined, StarFilled } from '@ant-design/icons';
import { LlmModel } from '../types';

interface Props {
  data: LlmModel[];
  loading: boolean;
  onEdit: (record: LlmModel) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
}

export const LlmModelTable: React.FC<Props> = ({ data, loading, onEdit, onDelete, onSetDefault }) => {
  const columns = [
    {
      title: '配置名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '提供商',
      dataIndex: 'provider',
      key: 'provider',
    },
    {
      title: '模型名称',
      dataIndex: 'modelName',
      key: 'modelName',
    },
    {
      title: '默认',
      key: 'isDefault',
      render: (_: any, record: LlmModel) => (
        record.isDefault ? <Tag color="green">是</Tag> : <Tag>否</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: LlmModel) => (
        <Space size="middle">
          <Button 
            type="text" 
            icon={record.isDefault ? <StarFilled style={{color: '#faad14'}} /> : <StarOutlined />} 
            onClick={() => onSetDefault(record.id)}
            title="设为默认"
          />
          <Button type="text" icon={<EditOutlined />} onClick={() => onEdit(record)} />
          <Popconfirm title="确定删除吗?" onConfirm={() => onDelete(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <BaseTable 
      columns={columns} 
      dataSource={data} 
      loading={loading}
    />
  );
};
