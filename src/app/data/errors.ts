export const APP_ERROR_CODES = [
  'UNAUTHENTICATED',
  'UNAVAILABLE',
  'FORBIDDEN',
  'VALIDATION',
  'CONFLICT',
  'PREVIEW_EXPIRED',
  'LIMIT_EXCEEDED',
] as const

export type AppErrorCode = (typeof APP_ERROR_CODES)[number]

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly fields: Record<string, string>
  readonly retryable: boolean

  constructor(code: AppErrorCode, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.fields = fields
    this.retryable = code === 'UNAVAILABLE'
  }
}

function isAppErrorCode(value: string): value is AppErrorCode {
  return (APP_ERROR_CODES as readonly string[]).includes(value)
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error && typeof error === 'object') {
    const record = error as {
      message?: string
      details?: string
      hint?: string
      code?: string
    }
    if (record.message && isAppErrorCode(record.message)) {
      let fields: Record<string, string> = {}
      if (record.hint) {
        try {
          const parsed = JSON.parse(record.hint) as unknown
          if (parsed && typeof parsed === 'object') {
            fields = Object.fromEntries(
              Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
                key,
                String(value),
              ]),
            )
          }
        } catch {
          fields = {}
        }
      }
      return new AppError(record.message, record.details || record.message, fields)
    }
    if (record.message) {
      return new AppError('UNAVAILABLE', record.message)
    }
  }
  return new AppError('UNAVAILABLE', 'Something went wrong. Try again.')
}

export function requireSession(): AppError {
  return new AppError('UNAUTHENTICATED', 'Sign in to continue.')
}
