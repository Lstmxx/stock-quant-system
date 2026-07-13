import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Form, Select, message, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { api } from '../../../api/api';
import { LlmModel } from '../../llm/types';

const { Text } = Typography;

interface Props {
  open: boolean;
  onCancel: () => void;
  onSaved?: () => void;
}

export const FactorTaskConfigModal: React.FC<Props> = ({ open, onCancel, onSaved }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<LlmModel[]>([]);

  const fetchConfigAndModels = useCallback(async () => {
    setLoading(true);
    try {
      const [modelsRes, configRes] = await Promise.all([
        api.llm.get(),
        api.config.get(),
      ]);

      if (modelsRes.data) {
        setModels(modelsRes.data);
      }

      if (configRes.data) {
        const factorConfig = configRes.data.find(
          (c: { key: string; value: string }) => c.key === 'FACTOR_TASK_LLM_MODEL'
        );
        form.setFieldsValue({
          llmModelId: factorConfig?.value ?? undefined,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    if (open) {
      fetchConfigAndModels();
    } else {
      form.resetFields();
      setModels([]);
    }
  }, [open, fetchConfigAndModels, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const { error } = await api.config.post({
        key: 'FACTOR_TASK_LLM_MODEL',
        value: values.llmModelId,
      });

      if (!error) {
        message.success('任务配置已保存');
        onSaved?.();
        onCancel();
      } else {
        message.error('保存失败，请重试');
      }
    } catch (e) {
      // Validation error — do nothing
    } finally {
      setSaving(false);
    }
  };

  const selectedModel = models.find(
    (m) => m.id === form.getFieldValue('llmModelId')
  );

  return (
    <Modal
      title="因子任务配置"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          name="llmModelId"
          label="默认大模型"
          rules={[{ required: true, message: '请选择一个大模型' }]}
          extra={
            !loading && models.length === 0 ? (
              <Text type="warning">
                <WarningOutlined /> 暂无可用大模型，请先前往「大模型配置」添加
              </Text>
            ) : null
          }
        >
          <Select
            placeholder="未选择模型"
            loading={loading}
            options={models.map((m) => ({
              label: `${m.name}（${m.provider} / ${m.modelName}）`,
              value: m.id,
            }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};
