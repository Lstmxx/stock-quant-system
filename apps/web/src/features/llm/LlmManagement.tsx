import React, { useState } from 'react';
import { Button, Card } from 'antd';
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
    <Card
      bordered={false}
      title="模型列表"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          新增配置
        </Button>
      }
    >
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
    </Card>
  );
};

export default LlmManagement;
