import React, { useState, useEffect } from 'react';
import { Form, InputNumber, message } from 'antd';
import { BaseModal } from '../../../components/Base/BaseModal';
import { api } from '../../../api/api';

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}

export const DataCollectionConfigModal: React.FC<Props> = ({ open, onCancel, onSuccess }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      const fetchConfig = async () => {
        try {
          const { data } = await api.tasks['data-collection'].config.get();
          if (data) {
            form.setFieldsValue(data);
          }
        } catch (e) {}
      };
      fetchConfig();
    }
  }, [open, form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const { error } = await api.tasks['data-collection'].config.put({ lookbackDays: values.lookbackDays });
      if (!error) {
        message.success('保存配置成功');
        onSuccess();
        onCancel();
      } else {
        message.error('保存失败');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <BaseModal
      title="数据采集设置"
      open={open}
      onOk={handleSave}
      onCancel={onCancel}
      confirmLoading={loading}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="lookbackDays"
          label="回溯天数 (默认250)"
          rules={[{ required: true, message: '请输入回溯天数' }]}
          tooltip="设置每次拉取的默认K线历史长度"
        >
          <InputNumber min={1} max={5000} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </BaseModal>
  );
};
