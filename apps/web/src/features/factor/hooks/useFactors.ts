import { useState, useEffect } from 'react';
import { message } from 'antd';
import { api } from '../../../api/api';
import { Factor } from '../types';

export const useFactors = () => {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  
  const [current, setCurrent] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState<string>('');
  const [selectionMode, setSelectionMode] = useState<'AUTO' | 'MANUAL'>('AUTO');
  const [selectedFactorIds, setSelectedFactorIds] = useState<string[]>([]);
  const [selectionSaving, setSelectionSaving] = useState(false);

  const fetchFactors = async (page: number, size: number, kw: string) => {
    setLoading(true);
    try {
      const offset = (page - 1) * size;
      const { data, error } = await api.factors.get({
        query: {
          limit: size,
          offset,
          keyword: kw || undefined
        }
      });
      if (data) {
        setFactors(data.data || []);
        setTotal(data.total || 0);
      } else if (error) {
        message.error('获取因子列表失败');
      }
    } catch {
      message.error('获取因子列表失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFactors(current, pageSize, keyword);
  }, [current, pageSize, keyword]);

  const fetchSelection = async () => {
    try {
      const { data, error } = await api.factors.selection.get();
      if (data) {
        setSelectionMode(data.mode);
        setSelectedFactorIds(data.factorIds);
      } else if (error) {
        message.error('获取选股因子集合失败');
      }
    } catch {
      message.error('获取选股因子集合失败，请检查网络连接');
    }
  };

  useEffect(() => {
    void fetchSelection();
  }, []);

  const saveSelection = async (factorIds: string[]) => {
    setSelectionSaving(true);
    try {
      const { data, error } = await api.factors.selection.put({ factorIds });
      if (error || !data?.success) {
        message.error('保存选股因子失败');
        return false;
      }
      setSelectionMode(factorIds.length > 0 ? 'MANUAL' : 'AUTO');
      if (factorIds.length === 0) {
        await fetchSelection();
      } else {
        setSelectedFactorIds(factorIds);
      }
      message.success(factorIds.length > 0 ? '已启用手选因子集合' : '已恢复自动优选 Top 5');
      return true;
    } catch {
      message.error('保存选股因子失败，请检查网络连接');
      return false;
    } finally {
      setSelectionSaving(false);
    }
  };

  return { 
    factors, total, loading, 
    current, pageSize, keyword,
    setCurrent, setPageSize, setKeyword,
    fetchFactors,
    selectionMode,
    selectedFactorIds,
    setSelectedFactorIds,
    selectionSaving,
    saveSelection,
  };
};
