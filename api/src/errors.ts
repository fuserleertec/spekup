export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string> | null,
  ) {
    super(message);
  }
}

export function httpError(err: unknown) {
  if (err instanceof HttpError) {
    return {
      status: err.status as 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 501,
      body: { error: { code: err.code, message: err.message, fields: err.fields ?? null } },
    };
  }
  return null;
}
