import React, { useEffect } from 'react';
import { Form, Input, Switch, message } from 'antd';
import { BaseModal } from '../../../components/Base/BaseModal';
import { api } from '../../../api/api';
import { LlmModel } from '../types';

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  initialValues: LlmModel | null;
}

export const LlmModelFormModal: React.FC<Props> = ({ open, onCancel, onSuccess, initialValues }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = React.useState(false);
  const isEdit = !!initialValues;

  useEffect(() => {
    if (open) {
      if (initialValues) {
        form.setFieldsValue(initialValues);
      } else {
        form.resetFields();
      }
    }
  }, [open, initialValues, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const { error } = isEdit 
        ? await api.llm({ id: initialValues.id }).put(values)
        : await api.llm.post(values);

      if (!error) {
        message.success(isEdit ? '更新成功' : '创建成功');
        onSuccess();
        onCancel();
      } else {
        message.error((error?.value as any)?.message || '保存失败');
      }
    } catch (e) {
      console.log('Validate Failed:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <BaseModal
      title={isEdit ? '编辑配置' : '新增配置'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
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
    </BaseModal>
  );
};
