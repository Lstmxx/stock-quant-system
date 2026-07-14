import { useState } from 'react';
import { Alert, Form, InputNumber, Modal, Select } from 'antd';

interface SelectionValues {
  universeType: 'ALL_MARKET' | 'WATCHLIST';
  topN: number;
  lookbackDays: number;
}

interface Props {
  open: boolean;
  factorMode: 'AUTO' | 'MANUAL' | null;
  factorCount: number;
  onCancel: () => void;
  onSubmit: (values: SelectionValues) => Promise<boolean>;
}

export function CreateFactorSelectionModal({
  open,
  factorMode,
  factorCount,
  onCancel,
  onSubmit,
}: Props) {
  const [form] = Form.useForm<SelectionValues>();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (await onSubmit(values)) {
        form.resetFields();
        onCancel();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="新建因子选股任务"
      open={open}
      onCancel={onCancel}
      onOk={handleSubmit}
      confirmLoading={submitting}
      destroyOnHidden
    >
      <Alert
        type={factorCount > 0 ? 'info' : 'warning'}
        showIcon
        title={factorCount > 0
          ? `本次使用${factorMode === 'MANUAL' ? '手选' : '自动优选'}的 ${factorCount} 个因子`
          : '暂无可用因子，请先完成因子挖掘'}
        className="mb-4"
      />
      <Form<SelectionValues>
        form={form}
        layout="vertical"
        initialValues={{ universeType: 'ALL_MARKET', topN: 20, lookbackDays: 250 }}
      >
        <Form.Item name="universeType" label="股票池" rules={[{ required: true }]}>
          <Select options={[
            { value: 'ALL_MARKET', label: '全市场' },
            { value: 'WATCHLIST', label: '我的自选股（创建时固化快照）' },
          ]} />
        </Form.Item>
        <Form.Item name="topN" label="输出 Top N" rules={[{ required: true }]}>
          <InputNumber min={1} max={100} className="w-full" />
        </Form.Item>
        <Form.Item name="lookbackDays" label="行情回溯天数" rules={[{ required: true }]}>
          <InputNumber min={30} max={1000} className="w-full" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
