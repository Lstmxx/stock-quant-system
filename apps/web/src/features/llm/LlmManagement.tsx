import React, { useState } from 'react';
import { Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useLlmModels } from './hooks/useLlmModels';
import { LlmModelTable } from './components/LlmModelTable';
import { LlmModelFormModal } from './components/LlmModelFormModal';
import { LlmModel } from './types';

const LlmManagement: React.FC = () => {
  const { data, loading, fetchData, handleDelete, handleSetDefault } = useLlmModels();
  
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<LlmModel | null>(null);

  const handleAdd = () => {
    setEditingConfig(null);
    setIsModalVisible(true);
  };

  const handleEdit = (record: LlmModel) => {
    setEditingConfig(record);
    setIsModalVisible(true);
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <h2>大模型管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          新增配置
        </Button>
      </div>
      
      <LlmModelTable 
        data={data} 
        loading={loading} 
        onEdit={handleEdit} 
        onDelete={handleDelete} 
        onSetDefault={handleSetDefault} 
      />

      <LlmModelFormModal
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        onSuccess={fetchData}
        initialValues={editingConfig}
      />
    </div>
  );
};

export default LlmManagement;
