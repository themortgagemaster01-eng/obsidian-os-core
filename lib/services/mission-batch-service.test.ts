import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { decideBatchStop } from "@/lib/services/mission-batch-service";

describe("mission-batch-service: decideBatchStop (Phase 9 — Model C: target OR pool exhaustion OR cap, whichever first)", () => {
  test("returns null (keep going) while below target, below the cap, and a candidate exists", () => {
    const result = decideBatchStop({ succeeded: 2, attempted: 3, requestedCount: 5, maxAttempts: 15, hasNextCandidate: true });
    assert.equal(result, null);
  });

  test("stops with target_reached once succeeded reaches requestedCount", () => {
    const result = decideBatchStop({ succeeded: 5, attempted: 6, requestedCount: 5, maxAttempts: 15, hasNextCandidate: true });
    assert.equal(result, "target_reached");
  });

  test("stops with target_reached even if succeeded exceeds requestedCount (defensive, never an off-by-one miss)", () => {
    const result = decideBatchStop({ succeeded: 6, attempted: 6, requestedCount: 5, maxAttempts: 15, hasNextCandidate: true });
    assert.equal(result, "target_reached");
  });

  test("stops with pool_exhausted when no next candidate exists, even with attempts remaining", () => {
    const result = decideBatchStop({ succeeded: 2, attempted: 3, requestedCount: 5, maxAttempts: 15, hasNextCandidate: false });
    assert.equal(result, "pool_exhausted");
  });

  test("stops with max_attempts_reached once the safety cap is hit, even if the target was never reached", () => {
    const result = decideBatchStop({ succeeded: 2, attempted: 15, requestedCount: 5, maxAttempts: 15, hasNextCandidate: true });
    assert.equal(result, "max_attempts_reached");
  });

  test("target_reached takes priority over max_attempts_reached when both are simultaneously true", () => {
    const result = decideBatchStop({ succeeded: 5, attempted: 15, requestedCount: 5, maxAttempts: 15, hasNextCandidate: true });
    assert.equal(result, "target_reached");
  });

  test("target_reached takes priority over pool_exhausted when both are simultaneously true", () => {
    const result = decideBatchStop({ succeeded: 5, attempted: 5, requestedCount: 5, maxAttempts: 15, hasNextCandidate: false });
    assert.equal(result, "target_reached");
  });

  test("max_attempts_reached takes priority over pool_exhausted when both are simultaneously true and the target was not reached", () => {
    const result = decideBatchStop({ succeeded: 2, attempted: 15, requestedCount: 5, maxAttempts: 15, hasNextCandidate: false });
    assert.equal(result, "max_attempts_reached");
  });

  test("a requestedCount of 1 stops immediately once the first candidate succeeds", () => {
    const result = decideBatchStop({ succeeded: 1, attempted: 1, requestedCount: 1, maxAttempts: 3, hasNextCandidate: true });
    assert.equal(result, "target_reached");
  });
});
