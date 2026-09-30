import type { ZodError } from 'zod'
import type { ApiErrorBody } from '@git-nest/core'

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly issues?: ApiErrorBody['issues'],
  ) {
    super(message)
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what}不存在`)

export const badRequest = (message: string) => new HttpError(400, 'bad_request', message)

export const conflict = (message: string) => new HttpError(409, 'conflict', message)

export function fromZodError(err: ZodError): HttpError {
  return new HttpError(
    422,
    'validation_failed',
    '提交的内容有误',
    err.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
  )
}

export function toErrorBody(err: HttpError): ApiErrorBody {
  return { code: err.code, message: err.message, ...(err.issues ? { issues: err.issues } : {}) }
}
