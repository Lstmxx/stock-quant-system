import { ApiCode, type ApiErrorCode } from '@stock-quant/api/contracts';

export function successResponse<T>(data: T) {
  return {
    data: { success: true as const, code: ApiCode.SUCCESS, message: '操作成功', data },
    error: null,
    status: 200,
  };
}

export function failureResponse(message: string, code: ApiErrorCode = ApiCode.INTERNAL_ERROR, status = 500) {
  return {
    data: null,
    error: { status, value: { success: false as const, code, message, data: null } },
    status,
  };
}

export function jsonSuccessResponse<T>(data: T) {
  return new Response(JSON.stringify(successResponse(data).data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
