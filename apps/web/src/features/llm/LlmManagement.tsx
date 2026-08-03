import { useCallback, useState } from 'react';
import { Alert, Button, Card } from 'antd';
import { Plus } from 'lucide-react';

import { LlmModelFormModal } from './components/LlmModelFormModal';
import { LlmModelTable } from './components/LlmModelTable';
import { useLlmModels } from './hooks/useLlmModels';
import type { LlmModel } from './types';

export default function LlmManagement() {
  const {
    data,
    loading,
    error,
    rowActions,
    fetchData,
    handleDelete,
    handleSetDefault,
    handleTest,
  } = useLlmModels();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<LlmModel | null>(null);

  const handleAdd = useCallback(() => {
    setEditingConfig(null);
    setIsModalVisible(true);
  }, []);

  const handleEdit = useCallback((record: LlmModel) => {
    setEditingConfig(record);
    setIsModalVisible(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsModalVisible(false);
    setEditingConfig(null);
  }, []);

  return (
    <Card
      title="大模型配置"
      extra={(
        <Button type="primary" icon={<Plus size={16} />} onClick={handleAdd}>
          新增配置
        </Button>
      )}
    >
      {error ? <Alert title={error} type="error" showIcon className="mb-4" /> : null}

      <LlmModelTable
        data={data}
        loading={loading}
        rowActions={rowActions}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onSetDefault={handleSetDefault}
        onTest={handleTest}
      />

      <LlmModelFormModal
        open={isModalVisible}
        onCancel={handleClose}
        onSuccess={fetchData}
        initialValues={editingConfig}
      />
    </Card>
  );
}
