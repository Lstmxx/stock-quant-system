import React from 'react';
import { Card, Input } from 'antd';
import { useFactors } from './hooks/useFactors';
import { FactorTable } from './components/FactorTable';

const { Search } = Input;

const FactorListPage: React.FC = () => {
  const { 
    factors, total, loading, 
    current, pageSize, 
    setCurrent, setPageSize, setKeyword 
  } = useFactors();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Card
        title="因子库"
        extra={
          <Search 
            placeholder="搜索因子名称或表达式" 
            onSearch={value => {
              setKeyword(value);
              setCurrent(1);
            }} 
            style={{ width: 300 }} 
            allowClear
          />
        }
      >
        <FactorTable 
          factors={factors}
          total={total}
          loading={loading}
          current={current}
          pageSize={pageSize}
          onChange={(page, size) => {
            setCurrent(page);
            setPageSize(size);
          }}
        />
      </Card>
    </div>
  );
};

export default FactorListPage;
