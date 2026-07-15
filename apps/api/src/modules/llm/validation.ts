import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type {
	ApiKeyAction,
	CreateLlmInput,
	LlmProvider,
	UpdateLlmInput,
} from "./model";

const HOSTED_PROVIDERS = new Set<LlmProvider>(["openai", "anthropic"]);
const KEY_REQUIRED_PROVIDERS = new Set<LlmProvider>([
	"openai",
	"anthropic",
	"openai_compatible",
]);

export class LlmValidationError extends Error {
	readonly code = "LLM_CONFIG_INVALID";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "LlmValidationError";
	}
}

export interface NormalizedLlmConfig {
	name: string;
	provider: LlmProvider;
	modelName: string;
	baseUrl: string | null;
	apiKey: string | null;
	isDefault: boolean;
}

export interface NormalizedLlmUpdate {
	name?: string;
	provider?: LlmProvider;
	modelName?: string;
	baseUrl?: string | null;
	isDefault?: boolean;
	apiKeyAction?: ApiKeyAction;
	apiKey?: string;
}

export type AddressResolver = (
	hostname: string,
) => Promise<readonly { address: string }[]>;

function requiredTrimmed(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized) throw new LlmValidationError(`${label} 不能为空`);
	return normalized;
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
	if (value == null || value.trim() === "") return null;
	const normalized = value.trim().replace(/\/+$/, "");
	let url: URL;
	try {
		url = new URL(normalized);
	} catch {
		throw new LlmValidationError("Base URL 必须是有效 URL");
	}
	if (!["http:", "https:"].includes(url.protocol)) {
		throw new LlmValidationError("Base URL 只允许 http 或 https");
	}
	if (url.username || url.password || url.hash) {
		throw new LlmValidationError("Base URL 不能包含凭据或 fragment");
	}
	return normalized;
}

function isNonPublicIpv4(address: string): boolean {
	const octets = address.split(".").map(Number);
	if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
		return true;
	}
	const [a, b, c] = octets;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0 && (c === 0 || c === 2)) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113) ||
		a >= 224
	);
}

function isNonPublicAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) return isNonPublicIpv4(address);
	if (family !== 6) return true;
	const normalized = address.toLowerCase();
	return (
		normalized === "::" ||
		normalized === "::1" ||
		normalized.startsWith("fc") ||
		normalized.startsWith("fd") ||
		normalized.startsWith("fe8") ||
		normalized.startsWith("fe9") ||
		normalized.startsWith("fea") ||
		normalized.startsWith("feb") ||
		normalized.startsWith("ff") ||
		normalized.startsWith("2001:db8")
	);
}

const resolveAddresses: AddressResolver = async (hostname) =>
	lookup(hostname, { all: true, verbatim: true });

export async function validateBaseUrlNetworkBoundary(
	config: Pick<NormalizedLlmConfig, "provider" | "baseUrl">,
	resolver: AddressResolver = resolveAddresses,
): Promise<void> {
	if (
		!config.baseUrl ||
		process.env.LLM_ALLOW_PRIVATE_BASE_URLS?.toLowerCase() === "true"
	) {
		return;
	}
	if (config.provider !== "ollama" && config.provider !== "openai_compatible") {
		return;
	}

	const hostname = new URL(config.baseUrl).hostname;
	if (hostname.toLowerCase() === "localhost") {
		throw new LlmValidationError("Base URL 不允许访问私网或保留地址");
	}

	let addresses: readonly { address: string }[];
	try {
		addresses = await resolver(hostname);
	} catch (error) {
		throw new LlmValidationError("Base URL 主机无法解析", { cause: error });
	}
	if (addresses.length === 0 || addresses.some(({ address }) => isNonPublicAddress(address))) {
		throw new LlmValidationError("Base URL 不允许访问私网或保留地址");
	}
}

export function validateResolvedLlmConfig(config: NormalizedLlmConfig): void {
	if (HOSTED_PROVIDERS.has(config.provider) && config.baseUrl) {
		throw new LlmValidationError("OpenAI 和 Anthropic 不允许自定义 Base URL");
	}
	if (config.provider === "openai_compatible" && !config.baseUrl) {
		throw new LlmValidationError("OpenAI-compatible Provider 必须配置 Base URL");
	}
	if (KEY_REQUIRED_PROVIDERS.has(config.provider) && !config.apiKey) {
		throw new LlmValidationError(`${config.provider} 必须配置 API Key`);
	}
}

export function normalizeCreateLlmInput(
	input: CreateLlmInput,
): NormalizedLlmConfig {
	const normalized: NormalizedLlmConfig = {
		name: requiredTrimmed(input.name, "配置名称"),
		provider: input.provider,
		modelName: requiredTrimmed(input.modelName, "模型名称"),
		baseUrl: normalizeBaseUrl(input.baseUrl),
		apiKey: input.apiKey ? requiredTrimmed(input.apiKey, "API Key") : null,
		isDefault: input.isDefault ?? false,
	};
	validateResolvedLlmConfig(normalized);
	return normalized;
}

export function normalizeUpdateLlmInput(
	input: UpdateLlmInput,
): NormalizedLlmUpdate {
	const normalized: NormalizedLlmUpdate = {};
	if (input.name !== undefined) normalized.name = requiredTrimmed(input.name, "配置名称");
	if (input.provider !== undefined) normalized.provider = input.provider;
	if (input.modelName !== undefined) {
		normalized.modelName = requiredTrimmed(input.modelName, "模型名称");
	}
	if (input.baseUrl !== undefined) normalized.baseUrl = normalizeBaseUrl(input.baseUrl);
	if (input.isDefault !== undefined) normalized.isDefault = input.isDefault;

	const action = input.apiKeyAction ?? "keep";
	if (action === "replace") {
		if (input.apiKey === undefined) {
			throw new LlmValidationError("替换密钥时必须提供 apiKey");
		}
		normalized.apiKeyAction = action;
		normalized.apiKey = requiredTrimmed(input.apiKey, "apiKey");
	} else {
		if (input.apiKey !== undefined) {
			throw new LlmValidationError(`${action} 密钥时不能提供 apiKey`);
		}
		normalized.apiKeyAction = action;
	}
	return normalized;
}
