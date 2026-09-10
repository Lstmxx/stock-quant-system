import { status } from "elysia";
import {
	ApiCode,
	type ApiErrorCode,
	type ApiErrorName,
	type ApiFailure,
	type ApiSuccess,
} from "../contracts/api-response";

export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504;

export class ApiDomainError extends Error {
	readonly code: ApiErrorCode;
	readonly status: ApiErrorStatus;

	constructor(code: ApiErrorCode | ApiErrorName, message: string, httpStatus: ApiErrorStatus, options?: ErrorOptions) {
		super(message, options);
		this.name = "ApiDomainError";
		this.code = typeof code === "string" ? ApiCode[code] : code;
		this.status = httpStatus;
	}
}

export function apiSuccess<T>(data: T, message = "操作成功"): ApiSuccess<T> {
	if (data === undefined) throw new ApiDomainError("INTERNAL_ERROR", "服务器内部错误", 500);
	return { success: true, code: ApiCode.SUCCESS, message, data };
}

export function apiFailure<const Status extends ApiErrorStatus>(
	httpStatus: Status,
	code: ApiErrorCode | ApiErrorName,
	message: string,
) {
	const body: ApiFailure = {
		success: false,
		code: typeof code === "string" ? ApiCode[code] : code,
		message,
		data: null,
	};
	return status(httpStatus, body);
}
