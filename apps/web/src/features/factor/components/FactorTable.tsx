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
  selectedFactorIds: string[];
  onSelectedFactorIdsChange: (factorIds: string[]) => void;
}

export const FactorTable: React.FC<Props> = ({
  factors,
  total,
  loading,
  current,
  pageSize,
  onChange,
  selectedFactorIds,
  onSelectedFactorIdsChange,
}) => {
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
      render: (val: number | null) => val === null ? '-' : val.toFixed(4)
    },
    {
      title: 'ICIR',
      dataIndex: 'icir',
      key: 'icir',
      render: (val: number | null) => val === null ? '-' : val.toFixed(4)
    },
    {
      title: '因子方向',
      dataIndex: 'direction',
      key: 'direction',
      render: (val: number | null) => val === 1
        ? <Tag color="green">正向</Tag>
        : val === -1
          ? <Tag color="red">负向</Tag>
          : <Tag>中性</Tag>
    },
    {
      title: '有效性',
      dataIndex: 'isValid',
      key: 'isValid',
      render: (isValid: boolean) => isValid ? <Tag color="success">有效</Tag> : <Tag>未通过</Tag>,
    }
  ];

  return (
    <BaseTable
      rowKey="id"
      dataSource={factors}
      columns={columns}
      loading={loading}
      rowSelection={{
        selectedRowKeys: selectedFactorIds,
        preserveSelectedRowKeys: true,
        getCheckboxProps: (record) => ({ disabled: !record.isValid }),
        onChange: (keys) => onSelectedFactorIdsChange(keys.map(String)),
      }}
      pagination={{
        current,
        pageSize,
        total,
        onChange
      }}
    />
  );
};
