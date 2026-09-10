import { treaty } from "@elysiajs/eden";
import type { App } from "@stock-quant/api";
import { API_BASE_URL } from "../constant/config";

const rpc = treaty<App>(API_BASE_URL, {
  fetch: {
    credentials: "include",
  },
});

export const api = rpc.api;
