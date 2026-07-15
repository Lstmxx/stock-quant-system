export function getApiErrorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === 'object') {
    const fields = value as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) {
      if (typeof fields[key] === 'string' && fields[key]) return fields[key];
    }
  }
  if (typeof value === 'string' && value) return value;
  return fallback;
}
