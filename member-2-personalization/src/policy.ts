export class Problem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function profileInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Problem(400, "Expected an object");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !["name", "maturity"].includes(k)))
    throw new Problem(400, "Unknown profile field");
  if (typeof v.name !== "string" || !v.name.trim() || v.name.trim().length > 80)
    throw new Problem(400, "Invalid profile name");
  if (
    !Number.isInteger(v.maturity) ||
    Number(v.maturity) < 0 ||
    Number(v.maturity) > 18
  )
    throw new Problem(400, "Maturity must be 0..18");
  return { name: v.name.trim(), maturity: Number(v.maturity) };
}
export function pagination(query: unknown) {
  const q = query as Record<string, unknown>;
  const limit = Number(q.limit ?? 20),
    offset = Number(q.offset ?? 0);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 10000
  )
    throw new Problem(400, "Invalid pagination");
  return { limit, offset };
}
export function sameAccount(accessSub: unknown, pctSub: unknown) {
  if (typeof accessSub !== "string" || !accessSub || accessSub !== pctSub)
    throw new Problem(401, "Profile token subject mismatch");
}
