import React, { useState } from 'react';
import { Modal, Form, Input, InputNumber } from 'antd';

interface Props {
  open: boolean;
  onCancel: () => void;
  onSubmit: (targetSymbol: string, days?: number) => void;
}

export const CreateMiningTaskModal: React.FC<Props> = ({ open, onCancel, onSubmit }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await onSubmit(values.targetSymbol, values.days);
      form.resetFields();
      onCancel();
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
        initialValues={{ days: 250 }}
      >
        <Form.Item
          name="targetSymbol"
          label="标的代码 (如: sh.000300)"
          rules={[{ required: true, message: '请输入标的代码' }]}
        >
          <Input placeholder="输入代码，例如 sh.000300" />
        </Form.Item>
        <Form.Item
          name="days"
          label="回溯天数"
        >
          <InputNumber min={10} max={1000} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};
