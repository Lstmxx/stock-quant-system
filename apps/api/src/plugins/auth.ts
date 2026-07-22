import { Elysia } from "elysia";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, user, session, account, verification } from "@stock-quant/database";

const authSecret = process.env.BETTER_AUTH_SECRET;
const authBaseUrl = process.env.BETTER_AUTH_URL;
if (process.env.NODE_ENV === "production" && (!authSecret || authSecret.length < 32)) {
	throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters in production");
}

export const auth = betterAuth({
	secret: authSecret,
	baseURL: authBaseUrl,
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
