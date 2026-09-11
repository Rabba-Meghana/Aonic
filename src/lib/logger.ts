import winston from 'winston'

const { combine, timestamp, json, errors } = winston.format

/**
 * `errors({ stack: true })` only expands an Error when it IS the top-level
 * logged value. Our call sites almost always log `logger.error('msg', {
 * error: err })` — an Error nested one level down in metadata — which
 * `errors()` does not walk into. Since `message` and `stack` are
 * non-enumerable on Error instances, `JSON.stringify` silently drops them,
 * so every nested error was logging as `{}` (or just whatever enumerable
 * extra fields a subclass like PrismaClientKnownRequestError adds, e.g.
 * `clientVersion`/`name`) with no message and no stack — effectively
 * invisible in production logs. This format walks one level into each
 * top-level field and replaces any Error found there with a plain object
 * carrying its real message/name/stack plus any extra enumerable props.
 */
const expandNestedErrors = winston.format((info) => {
  for (const key of Object.keys(info)) {
    const value = (info as Record<string, unknown>)[key]
    if (value instanceof Error) {
      (info as Record<string, unknown>)[key] = {
        name: value.name,
        message: value.message,
        stack: value.stack,
        ...value,
      }
    } else if (value && typeof value === 'object') {
      for (const nestedKey of Object.keys(value)) {
        const nested = (value as Record<string, unknown>)[nestedKey]
        if (nested instanceof Error) {
          (value as Record<string, unknown>)[nestedKey] = {
            name: nested.name,
            message: nested.message,
            stack: nested.stack,
            ...nested,
          }
        }
      }
    }
  }
  return info
})

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: combine(
    errors({ stack: true }),
    expandNestedErrors(),
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.sssZ' }),
    json(),
  ),
  defaultMeta: { service: 'novamember-api', env: process.env.NODE_ENV },
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? json()
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
          ),
    }),
  ],
})
