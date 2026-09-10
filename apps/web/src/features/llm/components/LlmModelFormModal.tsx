import { useEffect, useState } from 'react';
import { Alert, App, Form, Input, Select, Switch } from 'antd';

import { api } from '../../../api/api';
import { BaseModal } from '../../../components/Base/BaseModal';
import { getApiErrorMessage, request } from '../../../api/request';
import {
  LLM_PROVIDERS,
  PROVIDER_LABELS,
  providerRequiresApiKey,
  providerSupportsCustomBaseUrl,
  type LlmModel,
  type LlmModelFormValues,
  type LlmProvider,
} from '../types';

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void | Promise<void>;
  initialValues: LlmModel | null;
}

const PROVIDER_OPTIONS = LLM_PROVIDERS.map((provider) => ({
  label: PROVIDER_LABELS[provider],
  value: provider,
}));

function isValidationFailure(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'errorFields' in error);
}

export function LlmModelFormModal({ open, onCancel, onSuccess, initialValues }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<LlmModelFormValues>();
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const provider = Form.useWatch('provider', form) as LlmProvider | undefined;
  const apiKeyAction = Form.useWatch('apiKeyAction', form);
  const requiresApiKey = provider ? providerRequiresApiKey(provider) : true;
  const supportsCustomBaseUrl = provider ? providerSupportsCustomBaseUrl(provider) : false;

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    if (!initialValues) {
      form.resetFields();
      form.setFieldsValue({ provider: 'openai', isDefault: false });
      return;
    }
    const initialAction = initialValues.hasApiKey
      ? 'keep'
      : providerRequiresApiKey(initialValues.provider)
        ? 'replace'
        : 'keep';
    form.setFieldsValue({
      name: initialValues.name,
      provider: initialValues.provider,
      modelName: initialValues.modelName,
      baseUrl: initialValues.baseUrl,
      isDefault: initialValues.isDefault,
      apiKeyAction: initialAction,
      apiKey: undefined,
    });
  }, [form, initialValues, open]);

  useEffect(() => {
    if (!initialValues || !provider || !requiresApiKey) return;
    if (apiKeyAction === 'clear' || (apiKeyAction === 'keep' && !initialValues.hasApiKey)) {
      form.setFieldValue('apiKeyAction', 'replace');
    }
  }, [apiKeyAction, form, initialValues, provider, requiresApiKey]);

  const handleOk = async () => {
    setSubmitError(null);
    try {
      const values = await form.validateFields();
      setLoading(true);
      const normalizedBaseUrl = supportsCustomBaseUrl ? values.baseUrl?.trim() || null : null;
      const basePayload = {
        name: values.name,
        provider: values.provider,
        modelName: values.modelName,
        isDefault: values.isDefault ?? false,
      };
      await request(initialValues
        ? api.llm({ id: initialValues.id }).put({
            ...basePayload,
            baseUrl: normalizedBaseUrl,
            apiKeyAction: values.apiKeyAction ?? 'keep',
            ...(values.apiKeyAction === 'replace' ? { apiKey: values.apiKey } : {}),
          })
        : api.llm.post({
            ...basePayload,
            ...(normalizedBaseUrl ? { baseUrl: normalizedBaseUrl } : {}),
            ...(values.apiKey ? { apiKey: values.apiKey } : {}),
          }));

      message.success(initialValues ? '更新成功' : '创建成功');
      await onSuccess();
      onCancel();
    } catch (error) {
      if (isValidationFailure(error)) return;
      const detail = getApiErrorMessage(error, '保存失败，请检查网络连接');
      setSubmitError(detail);
      message.error(detail);
    } finally {
      setLoading(false);
    }
  };

  return (
    <BaseModal
      title={initialValues ? '编辑配置' : '新增配置'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      okButtonProps={{ disabled: loading }}
    >
      {submitError ? (
        <Alert title={submitError} type="error" showIcon className="mb-4" />
      ) : null}
      <Form form={form} layout="vertical" disabled={loading}>
        <Form.Item
          name="name"
          label="配置名称"
          rules={[{ required: true, whitespace: true, max: 100, message: '请输入配置名称' }]}
        >
          <Input placeholder="例如：生产环境 GPT-5" maxLength={100} />
        </Form.Item>

        <Form.Item name="provider" label="提供商" rules={[{ required: true }]}>
          <Select options={PROVIDER_OPTIONS} placeholder="请选择提供商" />
        </Form.Item>

        <Form.Item
          name="modelName"
          label="模型名称"
          rules={[{ required: true, whitespace: true, max: 200, message: '请输入模型名称' }]}
          extra="填写 Provider 识别的模型 ID，例如 gpt-5、claude-sonnet-4-5 或 qwen3:8b。"
        >
          <Input placeholder="模型 ID" maxLength={200} />
        </Form.Item>

        {supportsCustomBaseUrl ? (
          <Form.Item
            name="baseUrl"
            label="API Base URL"
            rules={[
              {
                required: provider === 'openai_compatible',
                type: 'url',
                message: '请输入有效的 http/https Base URL',
              },
            ]}
            extra={provider === 'ollama'
              ? '留空时使用 Ollama 默认地址 http://localhost:11434。私网自定义地址需由服务端显式允许。'
              : 'OpenAI-compatible Provider 必须提供完整 Base URL。'}
          >
            <Input placeholder="https://gateway.example.com/v1" maxLength={500} />
          </Form.Item>
        ) : (
          <Alert
            title={`${PROVIDER_LABELS[provider ?? 'openai']} 使用官方端点，不接受自定义 Base URL`}
            type="info"
            showIcon
            className="mb-4"
          />
        )}

        {initialValues ? (
          <>
            <Alert
              title={initialValues.hasApiKey ? '已配置 API Key' : '尚未配置 API Key'}
              description="现有密钥不会回显。请选择保留、替换或清除。"
              type={initialValues.hasApiKey ? 'success' : 'warning'}
              showIcon
              className="mb-4"
            />
            <Form.Item name="apiKeyAction" label="密钥操作" rules={[{ required: true }]}>
              <Select
                options={[
                  {
                    label: '保留现有密钥',
                    value: 'keep',
                    disabled: !initialValues.hasApiKey && requiresApiKey,
                  },
                  { label: '替换密钥', value: 'replace' },
                  { label: '清除密钥', value: 'clear', disabled: requiresApiKey },
                ]}
              />
            </Form.Item>
          </>
        ) : null}

        {!initialValues || apiKeyAction === 'replace' ? (
          <Form.Item
            name="apiKey"
            label="API Key"
            rules={[
              {
                required: initialValues ? apiKeyAction === 'replace' : requiresApiKey,
                whitespace: true,
                message: requiresApiKey ? '当前 Provider 必须配置 API Key' : '请输入 API Key',
              },
            ]}
            extra={provider === 'ollama' ? 'Ollama 可不配置 API Key。' : undefined}
          >
            <Input.Password
              placeholder={requiresApiKey ? '输入 API Key' : '可选'}
              autoComplete="new-password"
              maxLength={2000}
            />
          </Form.Item>
        ) : null}

        <Form.Item name="isDefault" label="设为默认模型" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </BaseModal>
  );
}
