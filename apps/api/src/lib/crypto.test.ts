import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { decrypt, encrypt } from "./crypto";

const TEST_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const KNOWN_CIPHERTEXT =
	"v1:AAECAwQFBgcICQoL:wjZy1MWVtBDV-SwoAj2UDA:NGn7b6CWtjbsMf6m2owB";

describe("LLM API key encryption", () => {
	const originalKey = process.env.ENCRYPTION_KEY;

	beforeEach(() => {
		process.env.ENCRYPTION_KEY = TEST_KEY;
	});

	afterEach(() => {
		if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
		else process.env.ENCRYPTION_KEY = originalKey;
	});

	test("decrypts the cross-language v1 fixed vector", () => {
		expect(decrypt(KNOWN_CIPHERTEXT)).toBe("sk-test-api-key");
	});

	test("round-trips only the v1 format", () => {
		const ciphertext = encrypt("sk-live-secret");

		expect(ciphertext.startsWith("v1:")).toBe(true);
		expect(ciphertext.split(":")).toHaveLength(4);
		expect(decrypt(ciphertext)).toBe("sk-live-secret");
	});

	test("rejects a missing or malformed encryption key", () => {
		delete process.env.ENCRYPTION_KEY;
		expect(() => encrypt("secret")).toThrow("ENCRYPTION_KEY");

		process.env.ENCRYPTION_KEY = "not-a-32-byte-key";
		expect(() => encrypt("secret")).toThrow("ENCRYPTION_KEY");
	});

	test("rejects plaintext and legacy three-part ciphertext", () => {
		expect(() => decrypt("plain-secret")).toThrow("ciphertext");
		expect(() => decrypt("00:11:22")).toThrow("ciphertext");
	});

	test("fails closed with the wrong key", () => {
		process.env.ENCRYPTION_KEY =
			"HyRS6kM7x9jAK9-fH_pFYltZBM0fDZJvgM6zCahDvkM";
		expect(() => decrypt(KNOWN_CIPHERTEXT)).toThrow("decrypt");
	});
});
