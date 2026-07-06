import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Switch, Space, message, Popconfirm, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, StarOutlined, StarFilled } from '@ant-design/icons';

interface LlmModel {
  id: string;
  provider: string;
  modelName: string;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  isDefault: boolean;
}

const LlmManagement: React.FC = () => {
  const [data, setData] = useState<LlmModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/llm', {
        credentials: 'include'
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        message.error('获取配置失败');
      }
    } catch (e) {
      message.error('网络错误');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAdd = () => {
    setEditingId(null);
    form.resetFields();
    setIsModalVisible(true);
  };

  const handleEdit = (record: LlmModel) => {
    setEditingId(record.id);
    form.setFieldsValue(record);
    setIsModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`http://localhost:3000/api/llm/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        message.success('删除成功');
        fetchData();
      } else {
        message.error('删除失败');
      }
    } catch (e) {
      message.error('网络错误');
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      const res = await fetch(`http://localhost:3000/api/llm/${id}/default`, {
        method: 'POST',
        credentials: 'include'
      });
      if (res.ok) {
        message.success('设置默认成功');
        fetchData();
      } else {
        message.error('设置默认失败');
      }
    } catch (e) {
      message.error('网络错误');
    }
  };

  const handleModalOk = async () => {
    try {
      const values = await form.validateFields();
      const isEdit = !!editingId;
      const url = isEdit ? `http://localhost:3000/api/llm/${editingId}` : 'http://localhost:3000/api/llm';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(values)
      });

      if (res.ok) {
        message.success(isEdit ? '更新成功' : '创建成功');
        setIsModalVisible(false);
        fetchData();
      } else {
        message.error('保存失败');
      }
    } catch (e) {
      console.log('Validate Failed:', e);
    }
  };

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
            onClick={() => handleSetDefault(record.id)}
            title="设为默认"
          />
          <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Popconfirm title="确定删除吗?" onConfirm={() => handleDelete(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <h2>大模型管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          新增配置
        </Button>
      </div>
      <Table 
        columns={columns} 
        dataSource={data} 
        rowKey="id" 
        loading={loading}
      />

      <Modal
        title={editingId ? '编辑配置' : '新增配置'}
        open={isModalVisible}
        onOk={handleModalOk}
        onCancel={() => setIsModalVisible(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="配置名称" rules={[{ required: true }]}>
            <Input placeholder="例如：我的GPT-4配置" />
          </Form.Item>
          <Form.Item name="provider" label="提供商" rules={[{ required: true }]}>
            <Input placeholder="例如：openai, anthropic, ollama" />
          </Form.Item>
          <Form.Item name="modelName" label="模型名称" rules={[{ required: true }]}>
            <Input placeholder="例如：gpt-4o, claude-3-5-sonnet" />
          </Form.Item>
          <Form.Item name="baseUrl" label="API Base URL">
            <Input placeholder="自定义请求基础URL（可选）" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key">
            <Input.Password placeholder="输入 API 密钥 (默认隐藏)" />
          </Form.Item>
          <Form.Item name="isDefault" label="设为默认模型" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default LlmManagement;
