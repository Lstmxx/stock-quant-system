type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

type LogContext = Record<string, unknown>;

function normalizeError(error: unknown) {
	if (!(error instanceof Error)) return error;

	return {
		name: error.name,
		message: error.message,
		stack: error.stack,
		cause: error.cause,
	};
}

function write(level: LogLevel, context: LogContext, message: string) {
	const payload = JSON.stringify({
		timestamp: new Date().toISOString(),
		level,
		service: "api",
		message,
		...Object.fromEntries(
			Object.entries(context).map(([key, value]) => [
				key,
				key === "error" ? normalizeError(value) : value,
			]),
		),
	});

	if (level === "error" || level === "fatal") console.error(payload);
	else if (level === "warn") console.warn(payload);
	else console.log(payload);
}

export const logger = {
	debug: (context: LogContext, message: string) => write("debug", context, message),
	info: (context: LogContext, message: string) => write("info", context, message),
	warn: (context: LogContext, message: string) => write("warn", context, message),
	error: (context: LogContext, message: string) => write("error", context, message),
	fatal: (context: LogContext, message: string) => write("fatal", context, message),
};
