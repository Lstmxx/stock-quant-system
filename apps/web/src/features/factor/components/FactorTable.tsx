import React from 'react';
import { Tag } from 'antd';
import { BaseTable } from '../../../components/Base/BaseTable';
import { Factor } from '../types';

interface Props {
  factors: Factor[];
  total: number;
  loading: boolean;
  current: number;
  pageSize: number;
  onChange: (page: number, pageSize: number) => void;
}

export const FactorTable: React.FC<Props> = ({ factors, total, loading, current, pageSize, onChange }) => {
  const columns = [
    {
      title: '因子名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '表达式',
      dataIndex: 'expression',
      key: 'expression',
      render: (text: string) => <code>{text}</code>
    },
    {
      title: 'IC 均值',
      dataIndex: 'icValue',
      key: 'icValue',
      render: (val: string) => val ? Number(val).toFixed(4) : '-'
    },
    {
      title: 'ICIR',
      dataIndex: 'icir',
      key: 'icir',
      render: (val: string) => val ? Number(val).toFixed(4) : '-'
    },
    {
      title: '因子方向',
      dataIndex: 'direction',
      key: 'direction',
      render: (val: string) => (
        Number(val) > 0 
          ? <Tag color="green">正向</Tag> 
          : <Tag color="red">负向</Tag>
      )
    }
  ];

  return (
    <BaseTable
      rowKey="id"
      dataSource={factors}
      columns={columns}
      loading={loading}
      pagination={{
        current,
        pageSize,
        total,
        onChange
      }}
    />
  );
};
