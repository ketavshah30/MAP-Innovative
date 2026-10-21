import test from "node:test";
import assert from "node:assert/strict";
import { profileInput, pagination, sameAccount } from "../src/policy.js";
test("profile validates unknown fields and bounds", () => {
  assert.deepEqual(profileInput({ name: " Alice ", maturity: 12 }), {
    name: "Alice",
    maturity: 12,
  });
  for (const v of [
    { name: "x", maturity: 19 },
    { name: "x", maturity: 1.5 },
    { name: "x", maturity: 12, accountId: "other" },
    { name: "", maturity: 0 },
  ])
    assert.throws(() => profileInput(v));
});
test("pagination refuses unbounded requests", () => {
  assert.deepEqual(pagination({}), { limit: 20, offset: 0 });
  for (const q of [{ limit: 101 }, { offset: -1 }, { limit: "abc" }])
    assert.throws(() => pagination(q));
});
test("PCT cannot be used across accounts", () => {
  sameAccount("a", "a");
  assert.throws(() => sameAccount("a", "b"));
  assert.throws(() => sameAccount(undefined, undefined));
});
