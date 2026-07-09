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

  const fetchFactors = async (page: number, size: number, kw: string) => {
    setLoading(true);
    try {
      const offset = (page - 1) * size;
      const { data, error } = await api.factors.get({
        query: {
          limit: String(size),
          offset: String(offset),
          keyword: kw || undefined
        }
      });
      if (data) {
        setFactors(data.data || []);
        setTotal(data.total || 0);
      } else if (error) {
        message.error('获取因子列表失败');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFactors(current, pageSize, keyword);
  }, [current, pageSize, keyword]);

  return { 
    factors, total, loading, 
    current, pageSize, keyword,
    setCurrent, setPageSize, setKeyword,
    fetchFactors 
  };
};
