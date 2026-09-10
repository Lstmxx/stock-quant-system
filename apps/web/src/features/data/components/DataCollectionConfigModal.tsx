import React, { useEffect, useState } from 'react';
import { Alert, App, Form, InputNumber, Spin, TimePicker } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { api } from '../../../api/api';
import { getApiErrorMessage, request } from '../../../api/request';
import { BaseModal } from '../../../components/Base/BaseModal';

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}

interface ConfigFormValues {
  lookbackDays: number;
  workerCount: number;
  scheduleTime: Dayjs;
}

const DEFAULT_SCHEDULE_TIME = { hour: 20, minute: 0 };

const createScheduleTime = (hour: number, minute: number): Dayjs => (
  dayjs().hour(hour).minute(minute).second(0).millisecond(0)
);

const parseScheduleTime = (cronExpression: string | undefined): Dayjs => {
  const fields = cronExpression?.trim().split(/\s+/);
  if (fields?.length !== 5) return createScheduleTime(DEFAULT_SCHEDULE_TIME.hour, DEFAULT_SCHEDULE_TIME.minute);

  const minute = Number(fields[0]);
  const hour = Number(fields[1]);
  const isWeekdaySchedule = fields[2] === '*' && fields[3] === '*' && fields[4].toLowerCase() === 'mon-fri';
  if (!isWeekdaySchedule || !Number.isInteger(minute) || !Number.isInteger(hour) || minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    return createScheduleTime(DEFAULT_SCHEDULE_TIME.hour, DEFAULT_SCHEDULE_TIME.minute);
  }

  return createScheduleTime(hour, minute);
};

const toCronExpression = (time: Dayjs): string => (
  `0 ${time.minute()} ${time.hour()} * * mon-fri`
);

export const DataCollectionConfigModal: React.FC<Props> = ({ open, onCancel, onSuccess }) => {
  const { message } = App.useApp();
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
        const data = await request(api.tasks['data-collection'].config.get());
        if (cancelled) return;
        form.setFieldsValue({
          lookbackDays: data.lookbackDays,
          workerCount: data.workerCount,
          scheduleTime: parseScheduleTime(data.cronExpression),
        });
      } catch (error) {
        if (!cancelled) setLoadError(getApiErrorMessage(error, '全局采集配置加载失败，请稍后重试'));
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
      const { scheduleTime, ...config } = values;
      await request(api.tasks['data-collection'].config.put({
        ...config,
        cronExpression: toCronExpression(scheduleTime),
      }));
      message.success('全局采集配置已保存');
      onSuccess();
      onCancel();
    } catch (error) {
      if (error instanceof Error) message.error(getApiErrorMessage(error, '保存配置失败，请稍后重试'));
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
            name="scheduleTime"
            label="定时执行时间"
            rules={[{ required: true, message: '请选择定时执行时间' }]}
            tooltip="按 Asia/Shanghai 时区在工作日执行，默认北京时间 20:00"
          >
            <TimePicker
              format="HH:mm"
              minuteStep={1}
              inputReadOnly
              placeholder="请选择时间"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Spin>
    </BaseModal>
  );
};
