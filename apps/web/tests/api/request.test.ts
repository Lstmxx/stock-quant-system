import { describe, expect, it, vi } from 'vitest';
import { ApiCode } from '@stock-quant/api/contracts';
import { request, ApiRequestError, getApiErrorMessage } from '../../src/api/request';

function ok<T>(data: T) {
  return Promise.resolve({ data: { success: true as const, code: 0 as const, message: 'ok', data }, error: null, status: 200 });
}

describe('typed API request boundary', () => {
  it.each([{ data: null }, { data: false }, { data: 0 }, { data: '' }, { data: [] }])('unwraps $data without truthiness checks', async ({ data }) => {
    await expect(request(ok(data))).resolves.toEqual(data);
  });

  it('preserves HTTP status, numeric business code and message', async () => {
    await expect(request(Promise.resolve({ data: null, error: {
      status: 409,
      value: { success: false, code: ApiCode.ACTIVE_TASK, message: '已有任务', data: null },
    }, status: 409 }))).rejects.toMatchObject({ kind: 'http', status: 409, code: ApiCode.ACTIVE_TASK, message: '已有任务' });
  });

  it('rejects a business failure even when HTTP is successful', async () => {
    await expect(request(Promise.resolve({ data: {
      success: false as const, code: ApiCode.ACTIVE_TASK, message: '已有任务', data: null,
    }, error: null, status: 200 }))).rejects.toMatchObject({ kind: 'business', code: ApiCode.ACTIVE_TASK });
  });

  it('rejects malformed runtime envelopes at the common boundary', async () => {
    const malformed = JSON.parse('{"success":true,"code":0,"message":"ok"}');
    await expect(request(Promise.resolve({ data: malformed, error: null, status: 200 }))).rejects.toMatchObject({ kind: 'protocol' });
  });

  it.each([
    { raw: 'null' },
    { raw: '"not JSON data"' },
    { raw: '{"success":true,"code":1,"message":"bad","data":[]}' },
    { raw: '{"success":false,"code":0,"message":"bad","data":null}' },
    { raw: '{"success":false,"code":1000,"message":"bad","data":{}}' },
    { raw: '{"success":true,"code":0,"data":[]}' },
  ])('rejects inconsistent envelope $raw', async ({ raw }) => {
    await expect(request(Promise.resolve({ data: JSON.parse(raw), error: null, status: 200 })))
      .rejects.toMatchObject({ kind: 'protocol', code: null });
  });

  it('does not unwrap success data attached to a failing HTTP status', async () => {
    const response = await ok([1]);
    await expect(request(Promise.resolve({ ...response, status: 500 }))).rejects.toMatchObject({ kind: 'protocol', status: 500 });
  });

  it('validates untrusted payloads without caller-side narrowing', async () => {
    const validate = (data: unknown) => Array.isArray(data) && data.every(Number.isFinite);
    await expect(request(ok([1, 2]), validate)).resolves.toEqual([1, 2]);
    await expect(request(ok([1, 'invalid']), validate)).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('sanitizes non-JSON HTTP failures and unknown upstream bodies', async () => {
    await expect(request(Promise.resolve({ data: null, error: { status: 502, value: '<html>private details</html>' }, status: 502 })))
      .rejects.toMatchObject({ kind: 'http', code: null, message: '请求失败（HTTP 502）' });
  });

  it('normalizes network failures without transport notifications', async () => {
    const listener = vi.fn();
    window.addEventListener('api-error', listener);
    try {
      await expect(request(Promise.reject(new TypeError('fetch failed')))).rejects.toMatchObject({ kind: 'network', status: null, code: null });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('api-error', listener);
    }
  });

  it('preserves intentional aborts and normalizes malformed JSON', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    await expect(request(Promise.reject(abort))).rejects.toBe(abort);
    await expect(request(Promise.reject(new SyntaxError('bad JSON')))).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('provides one message accessor for callers', () => {
    expect(getApiErrorMessage(new ApiRequestError('操作失败', 'business'), 'fallback')).toBe('操作失败');
    expect(getApiErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});
