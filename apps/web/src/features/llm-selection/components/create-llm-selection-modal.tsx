import { useEffect, useMemo } from 'react';
import { Alert, Form, InputNumber, Modal, Select, Space, Tag, Typography } from 'antd';

import type { LlmModel } from '../../llm/types';
import type { CreateLlmSelectionValues } from '../types';

const { Text } = Typography;

interface Props {
  open: boolean;
  submitting: boolean;
  models: LlmModel[];
  factorMode: 'AUTO' | 'MANUAL' | null;
  factorCount: number;
  watchlistCount: number;
  onCancel: () => void;
  onSubmit: (values: CreateLlmSelectionValues) => Promise<boolean>;
}

export function CreateLlmSelectionModal(props: Props) {
  const [form] = Form.useForm<CreateLlmSelectionValues>();
  const candidateCount = Form.useWatch('candidateCount', form) ?? 50;
  const defaultModelId = useMemo(
    () => props.models.find((model) => model.isDefault)?.id ?? props.models[0]?.id,
    [props.models],
  );

  useEffect(() => {
    if (props.open && defaultModelId && !form.getFieldValue('llmModelId')) {
      form.setFieldValue('llmModelId', defaultModelId);
    }
  }, [defaultModelId, form, props.open]);

  const estimatedCalls = candidateCount + props.watchlistCount;
  const handleFinish = async (values: CreateLlmSelectionValues) => {
    const success = await props.onSubmit(values);
    if (success) form.resetFields();
  };

  return (
    <Modal
      title="发起 LLM 选股分析"
      open={props.open}
      onCancel={props.onCancel}
      onOk={() => form.submit()}
      okText="开始分析"
      cancelText="取消"
      confirmLoading={props.submitting}
      okButtonProps={{ disabled: props.models.length === 0 }}
      destroyOnHidden={false}
      width={640}
    >
      <Space orientation="vertical" size="middle" className="w-full">
        <Alert
          showIcon
          type="info"
          title="沪深主板 · 未来约 20 个交易日"
          description="量化 Top M 与当前自选股快照取并集后逐只调用模型，最终按结构化评分排序。"
        />
        {props.models.length === 0 ? (
          <Alert showIcon type="warning" title="暂无大模型配置，请先前往大模型管理页面配置" />
        ) : null}
        <Form<CreateLlmSelectionValues>
          form={form}
          layout="vertical"
          initialValues={{ candidateCount: 50, finalTopN: 10, lookbackDays: 250 }}
          onFinish={handleFinish}
        >
          <Form.Item name="llmModelId" label="本次使用的大模型" rules={[{ required: true, message: '请选择大模型' }]}>
            <Select
              options={props.models.map((model) => ({
                value: model.id,
                label: `${model.name} · ${model.modelName}${model.isDefault ? '（默认）' : ''}`,
              }))}
            />
          </Form.Item>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Form.Item name="candidateCount" label="量化候选 Top M" rules={[{ required: true }]}>
              <InputNumber min={20} max={100} className="w-full" />
            </Form.Item>
            <Form.Item name="finalTopN" label="最终入选 Top N" rules={[{ required: true }]}>
              <InputNumber min={1} max={20} className="w-full" />
            </Form.Item>
            <Form.Item name="lookbackDays" label="回溯交易日" rules={[{ required: true }]}>
              <InputNumber min={120} max={500} className="w-full" />
            </Form.Item>
          </div>
        </Form>
        <Space wrap>
          <Tag color={props.factorMode === 'MANUAL' ? 'blue' : 'green'}>
            因子：{props.factorMode ?? '-'} · {props.factorCount} 个
          </Tag>
          <Tag color="purple">自选股：{props.watchlistCount} 只</Tag>
          <Tag color={estimatedCalls > 150 ? 'error' : 'gold'}>
            预计最多调用：{estimatedCalls} 次
          </Tag>
        </Space>
        {estimatedCalls > 150 ? (
          <Text type="danger">预计调用数超过 150，请降低 Top M 或整理自选股。</Text>
        ) : null}
      </Space>
    </Modal>
  );
}
