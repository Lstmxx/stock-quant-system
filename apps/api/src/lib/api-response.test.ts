import { describe, expect, it } from "bun:test";
import { ApiCode } from "../contracts/api-response";
import { ApiDomainError, apiFailure, apiSuccess } from "./api-response";

describe("API response contract", () => {
	it("registers unique integer errors and reserves zero for success", () => {
		const codes = Object.values(ApiCode);
		expect(new Set(codes).size).toBe(codes.length);
		expect(codes.every((code) => Number.isInteger(code) && code >= 0)).toBe(true);
		expect(ApiCode.SUCCESS).toBe(0);
	});

	it.each([{ data: null }, { data: false }, { data: 0 }, { data: "" }, { data: [] }])("preserves a legitimate falsy or empty payload: %j", ({ data }) => {
		expect(apiSuccess(data)).toEqual({ success: true, code: 0, message: "操作成功", data });
	});

	it("associates the failure body with its HTTP status", () => {
		expect(apiFailure(409, "ACTIVE_TASK", "已有任务正在执行")).toMatchObject({
			code: 409,
			response: { success: false, code: ApiCode.ACTIVE_TASK, message: "已有任务正在执行", data: null },
		});
	});

	it("keeps domain failure context without exposing it in the envelope", () => {
		const cause = new Error("private details");
		const error = new ApiDomainError("INTERNAL_ERROR", "操作失败", 500, { cause });
		expect(error.cause).toBe(cause);
		expect(error.code).toBe(ApiCode.INTERNAL_ERROR);
		expect(apiFailure(error.status, error.code, error.message).response).not.toHaveProperty("cause");
	});
});
