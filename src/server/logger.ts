/** Server-side log sink. Never log request bodies (NFR-9). */
export interface Logger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: unknown): void;
}

export const consoleLogger: Logger = {
  warn: (message, meta) => console.warn(`[warn] ${message}`, meta ?? ''),
  error: (message, error) => console.error(`[error] ${message}`, error ?? ''),
};

export const silentLogger: Logger = { warn: () => {}, error: () => {} };
