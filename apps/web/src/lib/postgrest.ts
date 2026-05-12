// Helpers for taming PostgREST's array-vs-object cardinality quirks.
//
// PostgREST infers the cardinality of a nested relation from the foreign
// key metadata. When the FK looks one-to-one (e.g. there's a unique index)
// the embedded relation comes back as a single object instead of an array
// — even when the calling code expected an array. This is the most common
// runtime crash family in the app: `(_.reservation_pets ?? []).map is
// not a function`.
//
// The `?? []` pattern only handles `null` / `undefined`. It doesn't catch
// the case where the value is a non-array object. Use `toArray` at every
// boundary where the data is read out of a Supabase query and consumed
// by code that expects `.map`, `for...of`, spread, etc.

export function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
