import React, { useState } from 'react';
import { Modal, Form, InputNumber, Select, Typography } from 'antd';

const { Text } = Typography;

export const researchDirectionOptions = [
  { value: '量价关系', label: '量价关系', description: '研究价格与成交量之间的横截面关系' },
  { value: '动量反转', label: '动量反转', description: '研究趋势延续与均值回归效应' },
  { value: '波动率', label: '波动率', description: '研究波动水平、变化和风险补偿' },
  { value: '资金流向', label: '资金流向', description: '研究成交额、换手率与资金行为' },
  { value: '市场情绪', label: '市场情绪', description: '研究交易拥挤度与情绪代理指标' },
  { value: '趋势跟踪', label: '趋势跟踪', description: '研究不同周期的趋势强度' },
] as const;

export type ResearchDirection = (typeof researchDirectionOptions)[number]['value'];

interface Props {
  open: boolean;
  onCancel: () => void;
  onSubmit: (researchDirection: ResearchDirection, days: number) => Promise<boolean>;
}

export const CreateMiningTaskModal: React.FC<Props> = ({ open, onCancel, onSubmit }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const success = await onSubmit(values.researchDirection, values.days);
      if (success) {
        form.resetFields();
        onCancel();
      }
    } catch (e) {
      console.error('Validation failed:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="发起因子挖掘任务"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ researchDirection: '量价关系', days: 250 }}
      >
        <Form.Item
          name="researchDirection"
          label="研究方向"
          rules={[{ required: true, message: '请选择研究方向' }]}
        >
          <Select
            options={researchDirectionOptions.map(({ value, label, description }) => ({
              value,
              label: (
                <div>
                  <div>{label}</div>
                  <Text type="secondary">{description}</Text>
                </div>
              ),
            }))}
            optionLabelProp="value"
          />
        </Form.Item>
        <Form.Item
          name="days"
          label="回溯天数"
          rules={[{ required: true, message: '请输入回溯天数' }]}
        >
          <InputNumber min={10} max={1000} className="w-full" />
        </Form.Item>
      </Form>
    </Modal>
  );
};
