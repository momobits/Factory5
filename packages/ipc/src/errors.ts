/**
 * IPC error class. Thrown by the client when a request fails (network or
 * non-2xx response). Server-side handlers throw plain `Error`; the route
 * registration layer converts to the {@link IpcError} envelope.
 */

import type { IpcError } from './schemas.js';

export class IpcRequestError extends Error {
  override readonly name = 'IpcRequestError';
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  toEnvelope(): IpcError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}
