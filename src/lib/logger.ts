import winston from 'winston'

const { combine, timestamp, json, errors } = winston.format

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: combine(
    errors({ stack: true }),
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
