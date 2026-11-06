import canonicalize from 'canonicalize'

/** RFC 8785 canonical JSON. */
export function canonicalJson(value: unknown): string {
  const text = canonicalize(value)
  if (text === undefined) throw new Error('value has no canonical form')
  return text
}
