import { t } from "elysia";

export const strategyModel = {
	recommendFactorsBody: t.Object({
		style: t.String({ description: "Investment style e.g. Momentum, Value, Volatility" }),
	}),
	simulateBody: t.Object({
		factorId: t.String(),
		constraints: t.Optional(t.Any()),
	}),
	generateReportBody: t.Object({
		style: t.String(),
		factorId: t.String(),
		constraints: t.Optional(t.Any()),
		simulationResult: t.Any(),
	}),
};
