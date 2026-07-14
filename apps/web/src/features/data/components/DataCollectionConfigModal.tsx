import React, { useEffect, useState } from 'react';
import { Alert, Form, Input, InputNumber, message, Spin } from 'antd';
import { api } from '../../../api/api';
import { BaseModal } from '../../../components/Base/BaseModal';

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}

interface ConfigFormValues {
  lookbackDays: number;
  workerCount: number;
  cronExpression: string;
}

export const DataCollectionConfigModal: React.FC<Props> = ({ open, onCancel, onSuccess }) => {
  const [form] = Form.useForm<ConfigFormValues>();
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const fetchConfig = async () => {
      setFetching(true);
      setLoadError(null);
      try {
        const { data, error } = await api.tasks['data-collection'].config.get();
        if (cancelled) return;
        if (error || !data || !('lookbackDays' in data)) {
          setLoadError('全局采集配置加载失败，请稍后重试');
          return;
        }
        form.setFieldsValue(data);
      } catch {
        if (!cancelled) setLoadError('网络异常，无法加载全局采集配置');
      } finally {
        if (!cancelled) setFetching(false);
      }
    };

    void fetchConfig();
    return () => { cancelled = true; };
  }, [form, open]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const { data, error } = await api.tasks['data-collection'].config.put(values);
      if (error || !data || !data.success) {
        message.error('保存失败，请检查 cron 表达式或 Engine 状态');
        return;
      }
      message.success('全局采集配置已保存');
      onSuccess();
      onCancel();
    } catch (error) {
      if (error instanceof Error) message.error('保存配置失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseModal
      title="全局数据采集设置"
      open={open}
      onOk={handleSave}
      onCancel={onCancel}
      confirmLoading={saving}
      okButtonProps={{ disabled: fetching || Boolean(loadError) }}
    >
      <Spin spinning={fetching}>
        <Alert
          title="该配置对所有用户、手动任务和定时任务生效，调度时区为 Asia/Shanghai。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        {loadError && <Alert title={loadError} type="error" showIcon style={{ marginBottom: 16 }} />}
        <Form form={form} layout="vertical">
          <Form.Item
            name="lookbackDays"
            label="回溯自然日参数"
            rules={[{ required: true, message: '请输入回溯天数' }]}
            tooltip="采集器会额外预留非交易日窗口，实际数据按可用交易日生成"
          >
            <InputNumber min={1} max={5000} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="workerCount"
            label="并发进程数"
            rules={[{ required: true, message: '请输入并发进程数' }]}
            tooltip="设置过高可能触发数据源限流"
          >
            <InputNumber min={1} max={16} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="cronExpression"
            label="定时规则（分 时 日 月 星期）"
            rules={[
              { required: true, message: '请输入 cron 表达式' },
              { pattern: /^\S+( \S+){4}$/, message: '请输入标准 5 段 cron 表达式' },
            ]}
            tooltip="默认 0 20 * * mon-fri，即工作日北京时间 20:00"
          >
            <Input placeholder="0 20 * * mon-fri" />
          </Form.Item>
        </Form>
      </Spin>
    </BaseModal>
  );
};
