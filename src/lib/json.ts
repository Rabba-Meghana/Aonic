import { Prisma } from '@prisma/client'

/**
 * Converts a plain, JSON-serializable TypeScript value into a value Prisma's
 * `InputJsonValue` type accepts, without reaching for a blind `as unknown as`
 * at the call site.
 *
 * Why this is safe where `as unknown as Prisma.InputJsonValue` was not:
 * round-tripping through JSON.stringify/JSON.parse guarantees the result is
 * *actually* structurally JSON (no functions, no Dates, no undefined, no
 * class instances with getters) — the round trip is the proof, not an
 * assertion. `Prisma.InputJsonValue` itself can't be expressed as a subtype
 * of an arbitrary interface like `MemberSignals`, so TypeScript will never
 * accept a direct assignment here even though the values are compatible;
 * that's a structural-typing limitation, not a real type-safety gap, and
 * confining the workaround to one audited helper (rather than five ad-hoc
 * casts scattered across routes) is what keeps it reviewable.
 *
 * If `value` contains something that does NOT survive a JSON round-trip
 * (undefined fields, Dates, BigInt, circular refs) this will silently drop
 * or coerce it — same as it always would going into a JSON column — so only
 * pass values that are meant to be stored as plain JSON.
 */
export function toInputJson<T extends object>(
  value: T
): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
