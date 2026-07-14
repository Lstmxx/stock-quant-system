import React from 'react';
import { Alert, Button, Card, Input, Space, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useFactors } from './hooks/useFactors';
import { FactorTable } from './components/FactorTable';

const { Search } = Input;

const FactorListPage: React.FC = () => {
  const navigate = useNavigate();
  const { 
    factors, total, loading, 
    current, pageSize, 
    setCurrent, setPageSize, setKeyword,
    selectionMode, selectedFactorIds, setSelectedFactorIds,
    selectionSaving, saveSelection,
  } = useFactors();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Alert
        showIcon
        type="info"
        title="因子用于横截面选股，并将实际暴露、排名与贡献传入后续 LLM 个股分析"
        description="未手动指定时系统自动使用质量最高的 5 个有效因子；勾选后保存即可覆盖自动集合。"
      />
      <Card
        title={<Space>因子库 <Tag color={selectionMode === 'MANUAL' ? 'blue' : 'green'}>{selectionMode}</Tag></Space>}
        extra={
          <Space wrap>
            <Button loading={selectionSaving} onClick={() => void saveSelection(selectedFactorIds)}>
              保存手选集合（{selectedFactorIds.length}）
            </Button>
            <Button loading={selectionSaving} onClick={() => void saveSelection([])}>恢复自动 Top 5</Button>
            <Button type="primary" onClick={() => navigate('/factor/selection')}>前往因子选股</Button>
            <Search
              placeholder="搜索因子名称或表达式"
              onSearch={value => {
                setKeyword(value);
                setCurrent(1);
              }}
              className="w-72"
              allowClear
            />
          </Space>
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
          selectedFactorIds={selectedFactorIds}
          onSelectedFactorIdsChange={setSelectedFactorIds}
        />
      </Card>
    </div>
  );
};

export default FactorListPage;
