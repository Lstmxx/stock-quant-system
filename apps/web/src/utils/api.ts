import { treaty } from "@elysiajs/eden";
import type { App } from "@stock-quant/api";

export const api = treaty<App>("http://localhost:3000");
