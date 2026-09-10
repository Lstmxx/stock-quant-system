import type { ApiResponse, ApiSuccess } from '@stock-quant/api/contracts';

interface EdenResponse<T> {
  data: ApiResponse<T> | null;
  error: { status: unknown; value: unknown } | null;
  status?: number;
}

export type ApiData<Operation extends (...parameters: never[]) => PromiseLike<{ data: unknown }>> =
  Extract<Awaited<ReturnType<Operation>>['data'], ApiSuccess<unknown>>['data'];

type ApiFailureKind = 'http' | 'business' | 'network' | 'protocol';

export class ApiRequestError extends Error {
  readonly kind: ApiFailureKind;
  readonly status: number | null;
  readonly code: number | null;

  constructor(message: string, kind: ApiFailureKind, status: number | null = null, code: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiRequestError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

interface Envelope {
  success: boolean;
  code: number;
  message: string;
  data: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  if (!('success' in value) || typeof value.success !== 'boolean') return false;
  if (!('code' in value) || typeof value.code !== 'number' || !Number.isSafeInteger(value.code)) return false;
  if (!('message' in value) || typeof value.message !== 'string') return false;
  if (!('data' in value) || value.data === undefined) return false;
  return value.success ? value.code === 0 : value.code > 0 && value.data === null;
}

export async function request<T>(operation: PromiseLike<EdenResponse<T>>, validate?: (data: unknown) => boolean): Promise<T> {
  try {
    const response = await operation;
    const httpStatus = typeof response.status === 'number' ? response.status : null;
    if (response.error) {
      const errorStatus = typeof response.error.status === 'number' ? response.error.status : httpStatus;
      const value = response.error.value;
      if (isEnvelope(value) && !value.success) {
        throw new ApiRequestError(value.message || '请求失败', 'http', errorStatus, value.code);
      }
      throw new ApiRequestError(errorStatus ? `请求失败（HTTP ${errorStatus}）` : '请求失败', 'http', errorStatus);
    }
    const envelope = response.data;
    if (!isEnvelope(envelope) || httpStatus !== null && (httpStatus < 200 || httpStatus >= 300)) {
      throw new ApiRequestError('服务器响应格式无效，请稍后重试', 'protocol', httpStatus);
    }
    if (!envelope.success) {
      throw new ApiRequestError(envelope.message || '请求失败', 'business', httpStatus, envelope.code);
    }
    if (validate && !validate(envelope.data)) {
      throw new ApiRequestError('服务器响应数据无效，请稍后重试', 'protocol', httpStatus);
    }
    return envelope.data;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') throw error;
    if (error instanceof SyntaxError) {
      throw new ApiRequestError('服务器响应格式无效，请稍后重试', 'protocol', null, null, { cause: error });
    }
    throw new ApiRequestError('网络异常，请检查网络连接', 'network', null, null, { cause: error });
  }
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}
