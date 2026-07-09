import { Elysia } from "elysia";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, user, session, account, verification, dataCollectionConfigs } from "@stock-quant/database";

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: {
			user,
			session,
			account,
			verification,
		},
	}),
	emailAndPassword: { enabled: true },
	trustedOrigins: [process.env.CORS_ORIGIN || "http://localhost:5173"],
	databaseHooks: {
		user: {
			create: {
				after: async (user) => {
					await db.insert(dataCollectionConfigs).values({
						userId: user.id,
						lookbackDays: 250,
						workerCount: 4,
					});
				},
			},
		},
	},
});

export const betterAuthPlugin = new Elysia({ name: "better-auth" })
	.mount(auth.handler)
	.macro({
		auth: {
			async resolve({ status, request: { headers } }) {
				const session = await auth.api.getSession({ headers });
				if (!session) return status(401);
				return {
					user: session.user,
					session: session.session,
				};
			},
		},
	});
