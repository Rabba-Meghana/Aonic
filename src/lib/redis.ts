/**
 * NovaMember — Redis Client (Upstash)
 *
 * Single Redis client shared across the application.
 * Uses Upstash Redis REST API — compatible with serverless / edge environments.
 * Falls back to a no-op in-memory shim when UPSTASH_REDIS_REST_URL is absent
 * so local development works without a Redis instance.
 *
 * Usage:
 *   import { redis } from '@/lib/redis'
 *   await redis.set('key', 'value', { ex: 60 })
 *   const val = await redis.get('key')
 *   await redis.incr('counter')
 */

import { logger } from './logger'

// Upstash Redis REST API types (minimal — add as needed)
interface RedisSetOptions {
  ex?:  number   // expire in seconds
  px?:  number   // expire in milliseconds
  nx?:  boolean  // only set if key does not exist
  xx?:  boolean  // only set if key exists
  get?: boolean  // return old value
}

interface IRedis {
  get(key: string): Promise<string | null>
  set(key: string, value: string | number, opts?: RedisSetOptions): Promise<string | null>
  del(...keys: string[]): Promise<number>
  incr(key: string): Promise<number>
  incrby(key: string, increment: number): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  ttl(key: string): Promise<number>
  exists(...keys: string[]): Promise<number>
  hget(key: string, field: string): Promise<string | null>
  hset(key: string, field: string, value: string | number): Promise<number>
  hgetall(key: string): Promise<Record<string, string> | null>
  zadd(key: string, score: number, member: string): Promise<number>
  zrangebyscore(key: string, min: number | string, max: number | string, opts?: { limit?: [number, number] }): Promise<string[]>
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>
  zcard(key: string): Promise<number>
  pipeline(): RedisPipeline
}

interface RedisPipeline {
  incr(key: string): this
  expire(key: string, seconds: number): this
  exec(): Promise<unknown[]>
}

// ── Upstash Redis REST client ─────────────────────────────────────────────────
class UpstashRedis implements IRedis {
  private readonly url:   string
  private readonly token: string

  constructor(url: string, token: string) {
    this.url   = url.replace(/\/$/, '')
    this.token = token
  }

  private async command<T>(...args: (string | number)[]): Promise<T> {
    const response = await fetch(`${this.url}`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Upstash Redis error ${response.status}: ${body}`)
    }

    const { result, error } = await response.json() as { result: T; error?: string }
    if (error) throw new Error(`Redis command error: ${error}`)
    return result
  }

  async get(key: string)                              { return this.command<string | null>('GET', key) }
  async del(...keys: string[])                        { return this.command<number>('DEL', ...keys) }
  async incr(key: string)                             { return this.command<number>('INCR', key) }
  async incrby(key: string, n: number)                { return this.command<number>('INCRBY', key, n) }
  async expire(key: string, seconds: number)          { return this.command<number>('EXPIRE', key, seconds) }
  async ttl(key: string)                              { return this.command<number>('TTL', key) }
  async exists(...keys: string[])                     { return this.command<number>('EXISTS', ...keys) }
  async hget(key: string, field: string)              { return this.command<string | null>('HGET', key, field) }
  async hset(key: string, field: string, value: string | number) { return this.command<number>('HSET', key, field, value) }
  async hgetall(key: string)                          { return this.command<Record<string, string> | null>('HGETALL', key) }
  async zadd(key: string, score: number, member: string) { return this.command<number>('ZADD', key, score, member) }
  async zcard(key: string)                            { return this.command<number>('ZCARD', key) }
  async zremrangebyscore(key: string, min: number | string, max: number | string) {
    return this.command<number>('ZREMRANGEBYSCORE', key, min, max)
  }
  async zrangebyscore(key: string, min: number | string, max: number | string, opts?: { limit?: [number, number] }) {
    const args: (string | number)[] = ['ZRANGEBYSCORE', key, min, max]
    if (opts?.limit) args.push('LIMIT', opts.limit[0], opts.limit[1])
    return this.command<string[]>(...args)
  }

  async set(key: string, value: string | number, opts?: RedisSetOptions): Promise<string | null> {
    const args: (string | number)[] = ['SET', key, value]
    if (opts?.ex)  args.push('EX', opts.ex)
    if (opts?.px)  args.push('PX', opts.px)
    if (opts?.nx)  args.push('NX')
    if (opts?.xx)  args.push('XX')
    if (opts?.get) args.push('GET')
    return this.command<string | null>(...args)
  }

  pipeline(): RedisPipeline {
    const commands: (string | number)[][] = []
    const pipe: RedisPipeline = {
      incr: (key) => { commands.push(['INCR', key]); return pipe },
      expire: (key, s) => { commands.push(['EXPIRE', key, s]); return pipe },
      exec: async () => {
        const response = await fetch(`${this.url}/pipeline`, {
          method: 'POST',
          headers: {
            Authorization:  `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(commands),
        })
        if (!response.ok) throw new Error(`Redis pipeline error ${response.status}`)
        const results = await response.json() as Array<{ result: unknown; error?: string }>
        return results.map(r => {
          if (r.error) throw new Error(`Redis pipeline command error: ${r.error}`)
          return r.result
        })
      },
    }
    return pipe
  }
}

// ── In-memory shim for local dev / CI ────────────────────────────────────────
class MemoryRedis implements IRedis {
  private store = new Map<string, { value: string; expiresAt?: number }>()

  private isExpired(key: string): boolean {
    const entry = this.store.get(key)
    if (!entry || !entry.expiresAt) return false
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return true }
    return false
  }

  private getVal(key: string): string | null {
    if (this.isExpired(key)) return null
    return this.store.get(key)?.value ?? null
  }

  async get(key: string)                   { return this.getVal(key) }
  async del(...keys: string[])             { let n = 0; for (const k of keys) if (this.store.delete(k)) n++; return n }
  async incr(key: string)                  { const v = parseInt(this.getVal(key) ?? '0') + 1; this.store.set(key, { value: String(v), expiresAt: this.store.get(key)?.expiresAt }); return v }
  async incrby(key: string, n: number)     { const v = parseInt(this.getVal(key) ?? '0') + n; this.store.set(key, { value: String(v), expiresAt: this.store.get(key)?.expiresAt }); return v }
  async expire(key: string, s: number)     { const e = this.store.get(key); if (e) { e.expiresAt = Date.now() + s * 1000; return 1 } return 0 }
  async ttl(key: string)                   { const e = this.store.get(key); if (!e?.expiresAt) return -1; return Math.max(0, Math.round((e.expiresAt - Date.now()) / 1000)) }
  async exists(...keys: string[])          { return keys.filter(k => this.getVal(k) !== null).length }
  async hget(key: string, field: string)   { const v = this.getVal(key); if (!v) return null; try { return JSON.parse(v)[field] ?? null } catch { return null } }
  async hset(key: string, field: string, value: string | number) { const existing = (() => { try { return JSON.parse(this.getVal(key) ?? '{}') } catch { return {} } })(); existing[field] = value; this.store.set(key, { value: JSON.stringify(existing) }); return 1 }
  async hgetall(key: string)               { const v = this.getVal(key); if (!v) return null; try { return JSON.parse(v) } catch { return null } }
  async zadd(key: string, score: number, member: string) { const set = (() => { try { return JSON.parse(this.getVal(key) ?? '[]') as Array<[number, string]> } catch { return [] } })(); const idx = set.findIndex(([, m]) => m === member); if (idx >= 0) set[idx] = [score, member]; else set.push([score, member]); set.sort(([a], [b]) => a - b); this.store.set(key, { value: JSON.stringify(set) }); return 1 }
  async zcard(key: string)                 { const v = this.getVal(key); if (!v) return 0; try { return (JSON.parse(v) as unknown[]).length } catch { return 0 } }
  async zremrangebyscore(key: string, min: number | string, max: number | string) { const set = (() => { try { return JSON.parse(this.getVal(key) ?? '[]') as Array<[number, string]> } catch { return [] } })(); const minN = min === '-inf' ? -Infinity : Number(min); const maxN = max === '+inf' ? Infinity : Number(max); const filtered = set.filter(([s]) => s < minN || s > maxN); const removed = set.length - filtered.length; this.store.set(key, { value: JSON.stringify(filtered) }); return removed }
  async zrangebyscore(key: string, min: number | string, max: number | string) { const set = (() => { try { return JSON.parse(this.getVal(key) ?? '[]') as Array<[number, string]> } catch { return [] } })(); const minN = min === '-inf' ? -Infinity : Number(min); const maxN = max === '+inf' ? Infinity : Number(max); return set.filter(([s]) => s >= minN && s <= maxN).map(([, m]) => m) }

  async set(key: string, value: string | number, opts?: RedisSetOptions): Promise<string | null> {
    const strVal = String(value)
    const old = this.getVal(key)
    if (opts?.nx && old !== null) return null
    if (opts?.xx && old === null) return null
    const expiresAt = opts?.ex ? Date.now() + opts.ex * 1000 : opts?.px ? Date.now() + opts.px : undefined
    this.store.set(key, { value: strVal, expiresAt })
    return opts?.get ? old : 'OK'
  }

  pipeline(): RedisPipeline {
    const results: Promise<unknown>[] = []
    const pipe: RedisPipeline = {
      incr:   (k) => { results.push(this.incr(k)); return pipe },
      expire: (k, s) => { results.push(this.expire(k, s)); return pipe },
      exec:   () => Promise.all(results),
    }
    return pipe
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
function createRedisClient(): IRedis {
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (url && token) {
    logger.info('Redis: connecting to Upstash')
    return new UpstashRedis(url, token)
  }

  logger.info('Redis: UPSTASH_REDIS_REST_URL not set — using in-memory shim (dev/CI only)')
  return new MemoryRedis()
}

declare global {
  // eslint-disable-next-line no-var
  var __redis: IRedis | undefined
}

export const redis: IRedis = global.__redis ?? (global.__redis = createRedisClient())
