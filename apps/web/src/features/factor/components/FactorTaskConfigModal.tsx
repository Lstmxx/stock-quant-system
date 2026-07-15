import React, { useState, useEffect, useCallback } from 'react';
import { Alert, App, Modal, Form, Select, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { api } from '../../../api/api';
import { getApiErrorMessage } from '../../llm/api-error';
import { LlmModel } from '../../llm/types';

const { Text } = Typography;

interface Props {
  open: boolean;
  onCancel: () => void;
  onSaved?: () => void;
}

export const FactorTaskConfigModal: React.FC<Props> = ({ open, onCancel, onSaved }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchConfigAndModels = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [modelsRes, configRes] = await Promise.all([
        api.llm.get(),
        api.config.get(),
      ]);

      if (modelsRes.error || !modelsRes.data) {
        throw new Error(getApiErrorMessage(modelsRes.error?.value, '获取大模型列表失败'));
      }
      setModels(modelsRes.data as LlmModel[]);

      if (configRes.error) {
        throw new Error(getApiErrorMessage(configRes.error.value, '获取因子任务配置失败'));
      }
      if (configRes.data) {
        const factorConfig = configRes.data.find(
          (c: { key: string; value: string }) => c.key === 'FACTOR_TASK_LLM_MODEL'
        );
        form.setFieldsValue({
          llmModelId: factorConfig?.value ?? undefined,
        });
      }
    } catch (error) {
      const detail = getApiErrorMessage(error, '加载任务配置失败，请检查网络连接');
      setLoadError(detail);
      message.error(detail);
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
        message.error(getApiErrorMessage(error?.value, '保存失败，请重试'));
      }
    } catch (error) {
      if (!(error && typeof error === 'object' && 'errorFields' in error)) {
        message.error(getApiErrorMessage(error, '保存失败，请检查网络连接'));
      }
    } finally {
      setSaving(false);
    }
  };

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
      {loadError ? <Alert title={loadError} type="error" showIcon className="mt-4" /> : null}
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          name="llmModelId"
          label="默认大模型"
          rules={[{ required: true, message: '请选择一个大模型' }]}
          extra={
            !loading && models.length === 0 ? (
              <Text type="warning">
                <WarningOutlined /> 暂无可用大模型，请先
                <Link to="/llm" onClick={onCancel}>前往大模型配置</Link>
                添加
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
