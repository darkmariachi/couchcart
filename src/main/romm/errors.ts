export class RommApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'RommApiError';
  }
}

export class NetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super('Not logged in to RomM.');
    this.name = 'NotAuthenticatedError';
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super('Your RomM session expired. Please log in again.');
    this.name = 'SessionExpiredError';
  }
}

/** FastAPI reports errors as `{ detail: string | ValidationError[] }`. */
export function describeErrorBody(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'detail' in body) {
    const { detail } = body;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item: unknown) =>
          typeof item === 'object' && item !== null && 'msg' in item ? String(item.msg) : null,
        )
        .filter((msg) => msg !== null);
      if (messages.length > 0) return messages.join('; ');
    }
  }
  return fallback;
}
