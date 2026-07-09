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
          const { data, error } = await api.tasks['data-collection'].config.get();
          if (!error && data) {
            form.setFieldsValue({ 
              lookbackDays: data.lookbackDays ?? 250,
              workerCount: data.workerCount ?? 4 
            });
          }
        } catch (e) {
          console.error('Failed to fetch config', e);
        }
      };
      fetchConfig();
    }
  }, [open, form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const { error } = await api.tasks['data-collection'].config.put({ 
        lookbackDays: values.lookbackDays,
        workerCount: values.workerCount
      });
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
        <Form.Item
          name="workerCount"
          label="并发进程数 (默认4)"
          rules={[{ required: true, message: '请输入并发进程数' }]}
          tooltip="设置数据采集时启动的并发 Worker 数量，设置过高可能导致网络超时"
        >
          <InputNumber min={1} max={16} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </BaseModal>
  );
};
