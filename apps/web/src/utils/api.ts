import { treaty } from "@elysiajs/eden";
import type { App } from "@stock-quant/api";
import { API_BASE_URL } from "../constant/config";

const customFetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
  try {
    const response = await fetch(input, init);
    if (!response.ok) {
      let message = `API Error: ${response.statusText}`;
      try {
        const errData = await response.clone().json();
        message = errData.message || errData.error || message;
      } catch (e) {}
      window.dispatchEvent(new CustomEvent('api-error', { detail: message }));
    }
    return response;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Network Error';
    window.dispatchEvent(new CustomEvent('api-error', { detail: msg }));
    throw error;
  }
};

const rpc = treaty<App>(API_BASE_URL, {
  fetcher: customFetcher,
  fetch: {
    credentials: "include",
  },
});

export const api = rpc.api;
