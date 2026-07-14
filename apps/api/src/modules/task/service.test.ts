import { describe, expect, it, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { TaskService } from "./service";

// Mock the DB
mock.module("@stock-quant/database", () => ({
	db: {
		insert: mock().mockReturnValue({
			values: mock().mockReturnValue({
				onConflictDoUpdate: mock().mockResolvedValue(true),
				returning: mock().mockResolvedValue([{ id: "task-999" }]),
			}),
		}),
		update: mock().mockReturnValue({
			set: mock().mockReturnValue({
				where: mock().mockResolvedValue(true),
			}),
		}),
		select: mock().mockReturnValue({
			from: mock().mockReturnValue({
				where: mock().mockReturnValue({
					orderBy: mock().mockReturnValue({
						limit: mock().mockResolvedValue([]),
					}),
					// For alphaTasks / userConfigs
					mockResolvedValue: [],
				}),
			}),
		}),
	},
	alphaTasks: { id: "alphaTasks.id", userId: "alphaTasks.userId", type: "alphaTasks.type", status: "alphaTasks.status" },
	dataCollectionConfigs: { userId: "dataCollectionConfigs.userId" },
	userConfigs: { id: "userConfigs.id", userId: "userConfigs.userId", key: "userConfigs.key", value: "userConfigs.value" },
	llmModels: { id: "llmModels.id", userId: "llmModels.userId" },
}));

import Redis from "ioredis";
import { db } from "@stock-quant/database";

describe("TaskService", () => {
	let origSetex: any;
	let origLpush: any;
	let origRpush: any;
	let origQuit: any;

	beforeEach(() => {
		mock.restore();
		
		origSetex = Redis.prototype.setex;
		origLpush = Redis.prototype.lpush;
		origRpush = Redis.prototype.rpush;
		origQuit = Redis.prototype.quit;

		Redis.prototype.setex = mock().mockResolvedValue("OK");
		Redis.prototype.lpush = mock().mockResolvedValue(1);
		Redis.prototype.rpush = mock().mockResolvedValue(1);
		Redis.prototype.quit = mock().mockResolvedValue("OK");
	});

	afterEach(() => {
		Redis.prototype.setex = origSetex;
		Redis.prototype.lpush = origLpush;
		Redis.prototype.rpush = origRpush;
		Redis.prototype.quit = origQuit;
	});

	describe("getDataCollectionConfig", () => {
		it("should return default lookbackDays if config is not found", async () => {
			// Mock db select to return empty array
			const selectMock = db.select() as any;
			selectMock.from().where.mockResolvedValue([]);

			const config = await TaskService.getDataCollectionConfig("user-1");
			expect(config).toEqual({ lookbackDays: 250, workerCount: 4 });
		});

		it("should return parsed config if found", async () => {
			const selectMock = db.select() as any;
			selectMock.from().where.mockResolvedValue([{ lookbackDays: 100, workerCount: 4 }]);

			const config = await TaskService.getDataCollectionConfig("user-1");
			expect(config).toEqual({ lookbackDays: 100, workerCount: 4 });
		});
	});

	describe("setDataCollectionConfig", () => {
		it("should upsert the config", async () => {
			const insertSpy = spyOn(db, "insert");

			const result = await TaskService.setDataCollectionConfig("user-1", 150, 2);
			
			expect(insertSpy).toHaveBeenCalled();
			expect(result).toEqual({ success: true });
		});

	});

	describe("runDataCollectionTask", () => {
		it("should cancel active tasks and create a new one", async () => {
			const selectMock = db.select() as any;
			
			// Mock db.select().from().where() to return active tasks for the first call
			// and return config for the second call
			let callCount = 0;
			selectMock.from().where.mockImplementation(() => {
				if (callCount === 0) {
					callCount++;
					return Promise.resolve([
						{ id: "task-1", status: "RUNNING" },
						{ id: "task-2", status: "PENDING" },
						{ id: "task-3", status: "COMPLETED" },
					]);
				}
				return Promise.resolve([{ lookbackDays: 120, workerCount: 4 }]);
			});

			const updateSpy = spyOn(db, "update");
			updateSpy.mockClear();
			const insertSpy = spyOn(db, "insert");

			const result = await TaskService.runDataCollectionTask("user-1");

			// Should have cancelled task-1 and task-2
			expect(Redis.prototype.setex).toHaveBeenCalledTimes(2);
			expect(Redis.prototype.setex).toHaveBeenCalledWith("task_cancelled:task-1", 3600, "1");
			expect(Redis.prototype.setex).toHaveBeenCalledWith("task_cancelled:task-2", 3600, "1");
			expect(updateSpy).toHaveBeenCalledTimes(2);

			// Should have inserted a new task
			expect(insertSpy).toHaveBeenCalled();
			expect(Redis.prototype.rpush).toHaveBeenCalled();
			expect(Redis.prototype.rpush).toHaveBeenCalledWith("stock:tasks:queue", expect.stringContaining("DATA_COLLECTION"));
			expect(Redis.prototype.rpush).toHaveBeenCalledWith("stock:tasks:queue", expect.stringContaining('"days":120'));

			expect(result).toEqual({ success: true, taskId: "task-999" });
		});
	});

	describe("getTaskLogs", () => {
		it("should fetch logs from redis list with lrange", async () => {
			const lrangeSpy = mock().mockResolvedValue([
				'{"message": "log1"}',
				'{"message": "log2"}',
			]);
			Redis.prototype.lrange = lrangeSpy;

			const result = await TaskService.getTaskLogs("user-1", "task-abc", 0);
			expect(lrangeSpy).toHaveBeenCalledWith("task_log_list:task-abc", 0, -1);
			
			// The next offset is start_offset + length_of_fetched_logs
			expect(result).toEqual({
				logs: ['{"message": "log1"}', '{"message": "log2"}'],
				nextOffset: 2,
			});
		});
	});

	describe("createMiningTask", () => {
		it("should return failure when no LLM model is configured", async () => {
			const selectMock = db.select() as any;
			// userConfigs returns empty — no FACTOR_TASK_LLM_MODEL key
			selectMock.from().where.mockResolvedValue([]);

			const result = await TaskService.createMiningTask("user-1", {
				researchDirection: "动量反转",
			});

			expect(result.success).toBe(false);
			expect((result as any).error).toContain("未选择");
		});

		it("should return failure when the configured LLM model has been deleted", async () => {
			const selectMock = db.select() as any;
			let callCount = 0;
			selectMock.from().where.mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					// First call: userConfigs — FACTOR_TASK_LLM_MODEL exists
					return Promise.resolve([{ value: "model-uuid-123" }]);
				}
				// Second call: llmModels — model has been deleted
				return Promise.resolve([]);
			});

			const result = await TaskService.createMiningTask("user-1", {
				researchDirection: "动量反转",
			});

			expect(result.success).toBe(false);
			expect((result as any).error).toContain("已不存在");
		});

		it("should push llmModelId into Redis queue params when model is configured", async () => {
			const selectMock = db.select() as any;
			let callCount = 0;
			selectMock.from().where.mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					// First call: userConfigs — FACTOR_TASK_LLM_MODEL exists
					return Promise.resolve([{ value: "model-uuid-123" }]);
				}
				// Second call: llmModels — model exists
				return Promise.resolve([{ id: "model-uuid-123" }]);
			});

			const result = await TaskService.createMiningTask("user-1", {
				researchDirection: "动量反转",
			});

			expect(result.success).toBe(true);
			// llmModelId should be present in the Redis payload
			expect(Redis.prototype.rpush).toHaveBeenCalledWith(
				"stock:tasks:queue",
				expect.stringContaining('"researchDirection":"动量反转"')
			);
			expect(Redis.prototype.rpush).toHaveBeenCalledWith(
				"stock:tasks:queue",
				expect.stringContaining('"llmModelId":"model-uuid-123"'),
			);
		});

		it("marks the task failed when Redis enqueue fails", async () => {
			const selectMock = db.select() as any;
			let callCount = 0;
			selectMock.from().where.mockImplementation(() => {
				callCount++;
				return Promise.resolve(
					callCount === 1
						? [{ value: "model-uuid-123" }]
						: [{ id: "model-uuid-123" }],
				);
			});
			Redis.prototype.rpush = mock().mockRejectedValue(
				new Error("redis unavailable"),
			);

			const result = await TaskService.createMiningTask("user-1", {
				researchDirection: "量价关系",
			});

			expect(result).toEqual({
				success: false,
				error: "任务入队失败，请稍后重试",
				taskId: "task-999",
			});
			expect(db.update).toHaveBeenCalled();
		});
	});
});
