import { pgTable, text, timestamp, boolean, uuid, jsonb } from "drizzle-orm/pg-core";

// --- Better Auth Core Tables ---

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("emailVerified").notNull(),
	image: text("image"),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull()
});

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expiresAt").notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull(),
	ipAddress: text("ipAddress"),
	userAgent: text("userAgent"),
	userId: text("userId").notNull().references(() => user.id)
});

export const account = pgTable("account", {
	id: text("id").primaryKey(),
	accountId: text("accountId").notNull(),
	providerId: text("providerId").notNull(),
	userId: text("userId").notNull().references(() => user.id),
	accessToken: text("accessToken"),
	refreshToken: text("refreshToken"),
	idToken: text("idToken"),
	accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
	refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull()
});

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expiresAt").notNull(),
	createdAt: timestamp("createdAt"),
	updatedAt: timestamp("updatedAt")
});

// --- Business Tables ---

export const watchlists = pgTable("watchlists", {
	id: uuid("id").defaultRandom().primaryKey(),
	userId: text("userId").notNull().references(() => user.id),
	symbol: text("symbol").notNull(), // e.g. sh.600000
	name: text("name"), // optional custom name
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().notNull()
});

export const userConfigs = pgTable("user_configs", {
	id: uuid("id").defaultRandom().primaryKey(),
	userId: text("userId").notNull().references(() => user.id),
	key: text("key").notNull(), // e.g. "LLM_API_KEY", "LLM_MODEL_NAME"
	value: text("value").notNull(), // encrypted or plain depending on impl
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().notNull()
});

export const alphaTasks = pgTable("alpha_tasks", {
	id: uuid("id").defaultRandom().primaryKey(),
	userId: text("userId").notNull().references(() => user.id),
	status: text("status").notNull(), // "PENDING", "RUNNING", "COMPLETED", "FAILED"
	type: text("type").notNull(), // "FACTOR_MINING", "LLM_ANALYSIS"
	params: jsonb("params"), // JSON params for the task
	result: jsonb("result"), // JSON results
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().notNull()
});
