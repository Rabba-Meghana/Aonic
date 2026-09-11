import { PrismaClient } from '@prisma/client'
import { logger } from './logger'

// Prevent multiple Prisma instances in dev (Next.js hot reload)
declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { level: 'query', emit: 'event' },
      { level: 'error', emit: 'event' },
      { level: 'warn', emit: 'event' },
    ],
  })

  client.$on('error' as never, (e: { message: string }) => {
    logger.error('Prisma error', { message: e.message })
  })

  client.$on('warn' as never, (e: { message: string }) => {
    logger.warn('Prisma warning', { message: e.message })
  })

  return client
}

export const db: PrismaClient =
  globalThis.prismaGlobal ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaGlobal = db
}
