import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const AAD = Buffer.from("stock-quant:llm-api-key:v1", "utf8");
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function decodeBase64Url(value: string, label: string): Buffer {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) {
		throw new Error(`${label} must be unpadded base64url`);
	}
	const padding = "=".repeat((4 - (value.length % 4)) % 4);
	return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/") + padding, "base64");
}

function encodeBase64Url(value: Buffer): string {
	return value.toString("base64url");
}

function getSecretKey(): Buffer {
	const encoded = process.env.ENCRYPTION_KEY;
	if (!encoded) {
		throw new Error("ENCRYPTION_KEY is required");
	}
	const key = decodeBase64Url(encoded, "ENCRYPTION_KEY");
	if (key.length !== 32) {
		throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
	}
	return key;
}

export function encrypt(text: string): string {
	if (!text) throw new Error("Cannot encrypt an empty secret");

	const iv = crypto.randomBytes(IV_LENGTH);
	const cipher = crypto.createCipheriv(ALGORITHM, getSecretKey(), iv, {
		authTagLength: AUTH_TAG_LENGTH,
	});
	cipher.setAAD(AAD);
	const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();

	return [VERSION, encodeBase64Url(iv), encodeBase64Url(authTag), encodeBase64Url(ciphertext)].join(":");
}

export function decrypt(value: string): string {
	const parts = value.split(":");
	if (parts.length !== 4 || parts[0] !== VERSION) {
		throw new Error("Invalid LLM API key ciphertext format");
	}

	const iv = decodeBase64Url(parts[1], "ciphertext IV");
	const authTag = decodeBase64Url(parts[2], "ciphertext auth tag");
	const ciphertext = decodeBase64Url(parts[3], "ciphertext payload");
	if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH || ciphertext.length === 0) {
		throw new Error("Invalid LLM API key ciphertext lengths");
	}

	try {
		const decipher = crypto.createDecipheriv(ALGORITHM, getSecretKey(), iv, {
			authTagLength: AUTH_TAG_LENGTH,
		});
		decipher.setAAD(AAD);
		decipher.setAuthTag(authTag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
	} catch (error) {
		throw new Error("Failed to decrypt LLM API key", { cause: error });
	}
}
