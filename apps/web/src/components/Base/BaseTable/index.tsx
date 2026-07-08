import { Table, TableProps } from 'antd';

export function BaseTable<RecordType extends object = any>(props: TableProps<RecordType>) {
  return (
    <Table
      rowKey="id"
      pagination={{
        pageSize: 10,
        showSizeChanger: true,
        showQuickJumper: true,
        ...(typeof props.pagination === 'object' ? props.pagination : {}),
      }}
      size="middle"
      {...props}
    />
  );
}
