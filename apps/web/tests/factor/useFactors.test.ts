import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFactors } from '../../src/features/factor/hooks/useFactors';
import { api } from '../../src/api/api';
import { message } from 'antd';
import { failureResponse, successResponse } from '../helpers/api-response';

const mocks = vi.hoisted(() => ({ list: vi.fn(), selection: vi.fn(), save: vi.fn() }));

vi.mock('../../src/api/api', () => ({
  api: {
    factors: {
      get: mocks.list,
      selection: {
        get: mocks.selection,
        put: mocks.save,
      },
    },
  },
}));

vi.mock('antd', () => {
  const messageApi = {
    success: vi.fn(),
    error: vi.fn(),
  };
  return { message: messageApi, App: { useApp: () => ({ message: messageApi }) } };
});

describe('useFactors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selection.mockResolvedValue(successResponse({ mode: 'AUTO', factorIds: [], factors: [] }));
  });

  it('should initialize with default states and fetch on mount', async () => {
    mocks.list.mockResolvedValue(successResponse({ data: [], total: 0 }));

    const { result } = renderHook(() => useFactors());

    // Initial state
    expect(result.current.loading).toBe(true);
    expect(result.current.factors).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.current).toBe(1);
    expect(result.current.pageSize).toBe(10);
    expect(result.current.keyword).toBe('');

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(api.factors.get).toHaveBeenCalledWith({
      query: { limit: 10, offset: 0, keyword: undefined },
    });
  });

  it('should update factors and total when fetch succeeds', async () => {
    const mockFactors = [{ id: 'f1', name: 'Factor 1' }, { id: 'f2', name: 'Factor 2' }];
    mocks.list.mockResolvedValue(successResponse({ data: mockFactors, total: 2 }));

    const { result } = renderHook(() => useFactors());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.factors).toEqual(mockFactors);
    expect(result.current.total).toBe(2);
  });

  it('should show error message when fetch fails', async () => {
    mocks.list.mockResolvedValue(failureResponse('获取因子列表失败'));

    const { result } = renderHook(() => useFactors());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(message.error).toHaveBeenCalledWith('获取因子列表失败');
    expect(result.current.factors).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it('should update states when setters are called', async () => {
    mocks.list.mockResolvedValue(successResponse({ data: [], total: 0 }));

    const { result } = renderHook(() => useFactors());
    
    await waitFor(() => expect(result.current.loading).toBe(false));
    
    act(() => {
      result.current.setKeyword('MACD');
    });
    
    expect(result.current.keyword).toBe('MACD');
    
    act(() => {
      result.current.setCurrent(2);
      result.current.setPageSize(20);
    });

    expect(result.current.current).toBe(2);
    expect(result.current.pageSize).toBe(20);
    
    await waitFor(() => {
      expect(api.factors.get).toHaveBeenCalledWith({
        query: { limit: 20, offset: 20, keyword: 'MACD' },
      });
    });
  });
});
