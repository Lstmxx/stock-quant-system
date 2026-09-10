import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';

import { useLlmModels } from '../../src/features/llm/hooks/useLlmModels';
import { failureResponse, successResponse } from '../helpers/api-response';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
  setDefault: vi.fn(),
  testConnection: vi.fn(),
  messageSuccess: vi.fn(),
  messageError: vi.fn(),
}));

vi.mock('../../src/api/api', () => {
  const llm = Object.assign(
    vi.fn(() => ({
      delete: mocks.remove,
      default: { post: mocks.setDefault },
      test: { post: mocks.testConnection },
    })),
    { get: mocks.list },
  );
  return { api: { llm } };
});

vi.mock('antd', () => {
  const feedback = {
    success: mocks.messageSuccess,
    error: mocks.messageError,
  };
  return {
    message: feedback,
    App: { useApp: () => ({ message: feedback }) },
  };
});

const model = {
  id: 'model-1',
  name: 'Primary',
  provider: 'openai',
  modelName: 'gpt-5',
  baseUrl: null,
  hasApiKey: true,
  isDefault: true,
  createdAt: '2026-07-15T00:00:00Z',
  updatedAt: '2026-07-15T00:00:00Z',
};

describe('useLlmModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue(successResponse([model]));
  });

  it('keeps request errors visible instead of swallowing them', async () => {
    mocks.list.mockResolvedValue(failureResponse('Engine unavailable'));

    const { result } = renderHook(() => useLlmModels());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Engine unavailable');
    expect(message.error).toHaveBeenCalledWith('Engine unavailable');
  });

  it('tests one row through the API and refreshes the list', async () => {
    mocks.testConnection.mockResolvedValue(successResponse({ provider: 'openai', model: 'gpt-5' }));
    const { result } = renderHook(() => useLlmModels());
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    await act(async () => {
      await result.current.handleTest('model-1');
    });

    expect(mocks.testConnection).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(message.success).toHaveBeenCalledWith('连接测试成功');
  });

  it('accepts a null delete acknowledgement and releases a failed row operation', async () => {
    mocks.remove.mockResolvedValueOnce(failureResponse('配置仍被引用'))
      .mockResolvedValueOnce(successResponse(null));
    const { result } = renderHook(() => useLlmModels());
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    await act(async () => { expect(await result.current.handleDelete('model-1')).toBe(false); });
    expect(result.current.rowActions['model-1']).toBeUndefined();
    expect(message.error).toHaveBeenCalledTimes(1);

    await act(async () => { expect(await result.current.handleDelete('model-1')).toBe(true); });
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(message.success).toHaveBeenCalledWith('已删除大模型配置');
  });

  it('blocks duplicate row actions while the first request is pending', async () => {
    let finishRequest: ((value: unknown) => void) | undefined;
    mocks.testConnection.mockReturnValue(new Promise((resolve) => {
      finishRequest = resolve;
    }));
    const { result } = renderHook(() => useLlmModels());
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    let firstRequest: Promise<boolean>;
    let secondResult: boolean | undefined;
    await act(async () => {
      firstRequest = result.current.handleTest('model-1');
      secondResult = await result.current.handleTest('model-1');
    });

    expect(secondResult).toBe(false);
    expect(mocks.testConnection).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishRequest?.(successResponse({ provider: 'openai', model: 'gpt-5' }));
      await firstRequest!;
    });
  });
});
