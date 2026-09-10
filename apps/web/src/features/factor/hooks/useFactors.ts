import { useState, useEffect } from 'react';
import { App } from 'antd';
import { api } from '../../../api/api';
import { getApiErrorMessage, request } from '../../../api/request';
import { Factor } from '../types';

export const useFactors = () => {
  const { message } = App.useApp();
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
      const data = await request(api.factors.get({
        query: {
          limit: size,
          offset,
          keyword: kw || undefined
        }
      }));
      setFactors(data.data);
      setTotal(data.total);
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取因子列表失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFactors(current, pageSize, keyword);
  }, [current, pageSize, keyword]);

  const fetchSelection = async () => {
    try {
      const data = await request(api.factors.selection.get());
      setSelectionMode(data.mode);
      setSelectedFactorIds(data.factorIds);
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取选股因子集合失败'));
    }
  };

  useEffect(() => {
    void fetchSelection();
  }, []);

  const saveSelection = async (factorIds: string[]) => {
    setSelectionSaving(true);
    try {
      await request(api.factors.selection.put({ factorIds }));
      setSelectionMode(factorIds.length > 0 ? 'MANUAL' : 'AUTO');
      if (factorIds.length === 0) {
        await fetchSelection();
      } else {
        setSelectedFactorIds(factorIds);
      }
      message.success(factorIds.length > 0 ? '已启用手选因子集合' : '已恢复自动优选 Top 5');
      return true;
    } catch (error) {
      message.error(getApiErrorMessage(error, '保存选股因子失败'));
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
