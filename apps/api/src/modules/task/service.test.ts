import { describe, expect, it, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { TaskService } from "./service";

// Mock the DB
mock.module("@stock-quant/database", () => ({
	db: {
		insert: mock().mockReturnValue({
			values: mock().mockReturnValue({
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
	userConfigs: { id: "userConfigs.id", userId: "userConfigs.userId", key: "userConfigs.key", value: "userConfigs.value" },
}));

import Redis from "ioredis";
import { db } from "@stock-quant/database";

describe("TaskService", () => {
	let origSetex: any;
	let origLpush: any;
	let origQuit: any;

	beforeEach(() => {
		mock.restore();
		
		origSetex = Redis.prototype.setex;
		origLpush = Redis.prototype.lpush;
		origQuit = Redis.prototype.quit;

		Redis.prototype.setex = mock().mockResolvedValue("OK");
		Redis.prototype.lpush = mock().mockResolvedValue(1);
		Redis.prototype.quit = mock().mockResolvedValue("OK");
	});

	afterEach(() => {
		Redis.prototype.setex = origSetex;
		Redis.prototype.lpush = origLpush;
		Redis.prototype.quit = origQuit;
	});

	describe("getDataCollectionConfig", () => {
		it("should return default lookbackDays if config is not found", async () => {
			// Mock db select to return empty array
			const selectMock = db.select() as any;
			selectMock.from().where.mockResolvedValue([]);

			const config = await TaskService.getDataCollectionConfig("user-1");
			expect(config).toEqual({ lookbackDays: 250 });
		});

		it("should return parsed config if found", async () => {
			const selectMock = db.select() as any;
			selectMock.from().where.mockResolvedValue([{ value: '{"lookbackDays": 100}' }]);

			const config = await TaskService.getDataCollectionConfig("user-1");
			expect(config).toEqual({ lookbackDays: 100 });
		});
	});

	describe("setDataCollectionConfig", () => {
		it("should insert new config if it does not exist", async () => {
			const selectMock = db.select() as any;
			selectMock.from().where.mockResolvedValue([]);
			
			const insertSpy = spyOn(db, "insert");

			const result = await TaskService.setDataCollectionConfig("user-1", 150);
			
			expect(insertSpy).toHaveBeenCalled();
			expect(result).toEqual({ success: true });
		});

		it("should update config if it exists", async () => {
			const selectMock = db.select() as any;
			// Return mock config for both getDataCollectionConfig and setDataCollectionConfig checks
			selectMock.from().where.mockResolvedValue([{ id: "config-1", value: '{"lookbackDays": 100}' }]);
			
			const updateSpy = spyOn(db, "update");

			const result = await TaskService.setDataCollectionConfig("user-1", 150);
			
			expect(updateSpy).toHaveBeenCalled();
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
				return Promise.resolve([{ value: '{"lookbackDays": 120}' }]);
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
			expect(Redis.prototype.lpush).toHaveBeenCalled();
			expect(Redis.prototype.lpush).toHaveBeenCalledWith("stock:tasks:queue", expect.stringContaining("DATA_COLLECTION"));
			expect(Redis.prototype.lpush).toHaveBeenCalledWith("stock:tasks:queue", expect.stringContaining('"days":120'));

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
});
