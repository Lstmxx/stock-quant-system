import { Elysia } from "elysia";
import { ApiDomainError, apiFailure } from "../lib/api-response";
import { EngineClientError } from "../lib/engine-client";
import { logger } from "../lib/logger";

export function mapEngineError(error: EngineClientError): ApiDomainError {
	if (error.status === 401 || error.status === 403) {
		return new ApiDomainError("UPSTREAM_AUTH_ERROR", "内部服务认证失败，请联系管理员", 502, { cause: error });
	}
	switch (error.code) {
		case "LLM_CONFIG_NOT_FOUND":
			return new ApiDomainError(error.code, "大模型配置不存在或无权访问", 404, { cause: error });
		case "LLM_CONFIG_INVALID":
		case "LLM_SECRET_INVALID":
			return new ApiDomainError(error.code, "大模型配置或密钥无效，请检查模型配置", 422, { cause: error });
		case "LLM_AUTH_FAILED":
			return new ApiDomainError(error.code, "模型认证失败，请检查 API Key", 502, { cause: error });
		case "LLM_RATE_LIMITED":
			return new ApiDomainError(error.code, "模型服务请求过于频繁，请稍后重试", 502, { cause: error });
		case "LLM_TIMEOUT":
			return new ApiDomainError(error.code, "模型请求超时，请稍后重试", 504, { cause: error });
		case "LLM_RESPONSE_INVALID":
			return new ApiDomainError(error.code, "模型返回内容无效，请重试", 502, { cause: error });
		default:
			return new ApiDomainError("LLM_PROVIDER_UNAVAILABLE", "模型服务暂时不可用，请稍后重试", error.status === 503 ? 503 : 502, { cause: error });
	}
}

export const apiErrors = new Elysia({ name: "api-errors" })
	.onError({ as: "global" }, ({ code, error, request, set }) => {
		logger.error({
			requestId: set.headers["x-request-id"] ?? request.headers.get("x-request-id"),
			method: request.method,
			path: new URL(request.url).pathname,
			code,
			error,
		}, "request failed");

		const domainError = error instanceof EngineClientError ? mapEngineError(error) : error;
		if (domainError instanceof ApiDomainError) {
			return apiFailure(domainError.status, domainError.code, domainError.message);
		}
		if (code === "VALIDATION" || code === "PARSE") {
			return apiFailure(400, "VALIDATION_ERROR", "请求参数无效");
		}
		if (code === "NOT_FOUND") {
			return apiFailure(404, "NOT_FOUND", "资源不存在");
		}
		return apiFailure(500, "INTERNAL_ERROR", "服务器内部错误");
	});
