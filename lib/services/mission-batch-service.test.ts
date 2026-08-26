import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { decideBatchStop, decideOverlapGuardAction, runMissionBatch, type MissionBatchServiceDeps } from "@/lib/services/mission-batch-service";
import type { MissionBatchRunRow, MissionBatchRunInsert, MissionBatchRunUpdate } from "@/lib/repositories/mission-batch-run-repository";

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

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

function fakeRun(overrides: Partial<MissionBatchRunRow> = {}): MissionBatchRunRow {
  const now = new Date().toISOString();
  return {
    id: "run-1",
    organization_id: "org-1",
    location: "Anywhere",
    requested_count: 5,
    max_attempts: 15,
    status: "running",
    stop_reason: null,
    attempted_count: 0,
    succeeded_count: 0,
    failed_count: 0,
    results: [],
    error_message: null,
    started_at: now,
    completed_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("mission-batch-service: decideOverlapGuardAction (Phase 10 — hard overlap protection)", () => {
  test("no prior run at all for this organization — proceed", () => {
    const result = decideOverlapGuardAction(null, Date.now(), FOUR_HOURS_MS);
    assert.deepEqual(result, { kind: "proceed" });
  });

  test("the organization's latest run already reached a terminal status — proceed, regardless of which one", () => {
    const now = Date.now();
    assert.deepEqual(decideOverlapGuardAction(fakeRun({ status: "complete" }), now, FOUR_HOURS_MS), { kind: "proceed" });
    assert.deepEqual(decideOverlapGuardAction(fakeRun({ status: "failed" }), now, FOUR_HOURS_MS), { kind: "proceed" });
  });

  test("a fresh running run (well within the duration bound) — skip, never a second concurrent run", () => {
    const now = Date.now();
    const freshRun = fakeRun({ status: "running", started_at: new Date(now - 5 * 60 * 1000).toISOString() });
    const result = decideOverlapGuardAction(freshRun, now, FOUR_HOURS_MS);
    assert.deepEqual(result, { kind: "skip_already_running", runningRun: freshRun });
  });

  test("a running run older than the max duration bound — reap it, then allow a new one to proceed", () => {
    const now = Date.now();
    const staleRun = fakeRun({ id: "stale-run-1", status: "running", started_at: new Date(now - 5 * 60 * 60 * 1000).toISOString() });
    const result = decideOverlapGuardAction(staleRun, now, FOUR_HOURS_MS);
    assert.deepEqual(result, { kind: "reap_stale_then_proceed", staleRunId: "stale-run-1" });
  });

  test("exactly at the boundary is treated as still-fresh, not stale (age must exceed, not merely equal, the bound)", () => {
    const now = Date.now();
    const boundaryRun = fakeRun({ status: "running", started_at: new Date(now - FOUR_HOURS_MS).toISOString() });
    const result = decideOverlapGuardAction(boundaryRun, now, FOUR_HOURS_MS);
    assert.equal(result.kind, "skip_already_running");
  });

  test("one millisecond past the bound is stale", () => {
    const now = Date.now();
    const justPastRun = fakeRun({ status: "running", started_at: new Date(now - FOUR_HOURS_MS - 1).toISOString() });
    const result = decideOverlapGuardAction(justPastRun, now, FOUR_HOURS_MS);
    assert.equal(result.kind, "reap_stale_then_proceed");
  });
});

/**
 * In-memory fakes for MissionBatchServiceDeps — no real Supabase client
 * involved. Only exercises the overlap-guard wiring at the very top of
 * runMissionBatch (a no-candidate-pool scenario reaches pool_exhausted
 * immediately without ever entering runOneCandidate, which imports its own
 * pipeline-stage services directly and is only exercisable against a real
 * database, per this codebase's own established unit-vs-real-validation
 * split). Proves the guard is actually wired into the real entry point,
 * not just correct in isolation as a pure function.
 */
function createFakeDeps(initialRuns: MissionBatchRunRow[]): MissionBatchServiceDeps & { insertCalls: MissionBatchRunInsert[]; updateCalls: { id: string; values: MissionBatchRunUpdate }[] } {
  const runs = new Map(initialRuns.map((r) => [r.id, r]));
  const insertCalls: MissionBatchRunInsert[] = [];
  const updateCalls: { id: string; values: MissionBatchRunUpdate }[] = [];
  let nextId = 100;

  return {
    client: {} as MissionBatchServiceDeps["client"],
    insertCalls,
    updateCalls,
    leadRepository: {
      // No eligible candidates — the loop stops at pool_exhausted on its
      // very first check, before ever touching runOneCandidate.
      findNextEligibleCandidate: async () => null,
    },
    missionBatchRunRepository: {
      async insert(_client, values) {
        insertCalls.push(values);
        const now = new Date().toISOString();
        const row = fakeRun({
          id: `new-run-${nextId++}`,
          organization_id: values.organization_id,
          location: values.location,
          requested_count: values.requested_count,
          max_attempts: values.max_attempts,
          status: (values.status as MissionBatchRunRow["status"]) ?? "running",
          started_at: now,
          created_at: now,
          updated_at: now,
        });
        runs.set(row.id, row);
        return row;
      },
      async update(_client, id, values) {
        updateCalls.push({ id, values });
        const existing = runs.get(id);
        if (!existing) throw new Error(`fake run ${id} not found`);
        const updated = { ...existing, ...values } as MissionBatchRunRow;
        runs.set(id, updated);
        return updated;
      },
      async findById(_client, id) {
        return runs.get(id) ?? null;
      },
      async findLatestByOrganization(_client, organizationId) {
        const matches = [...runs.values()].filter((r) => r.organization_id === organizationId);
        if (matches.length === 0) return null;
        matches.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
        return matches[0];
      },
      async findRunningByOrganization(_client, organizationId) {
        const match = [...runs.values()].find((r) => r.organization_id === organizationId && r.status === "running");
        return match ?? null;
      },
    } as MissionBatchServiceDeps["missionBatchRunRepository"],
  };
}

describe("mission-batch-service: runMissionBatch overlap-guard wiring (Phase 10)", () => {
  test("no prior run — proceeds normally, exactly as before this phase (pool_exhausted since the fake pool is always empty)", async () => {
    const deps = createFakeDeps([]);
    const result = await runMissionBatch(deps, { organizationId: "org-1", location: "Anywhere", requestedCount: 5, ownerId: "owner-1" });
    assert.equal(result.status, "complete");
    assert.equal(result.stop_reason, "pool_exhausted");
    assert.equal(deps.insertCalls.length, 1, "exactly one new run row was created");
  });

  test("an already-running, fresh run for the same organization — skipped, no second row ever inserted", async () => {
    const existingRunning = fakeRun({ id: "already-running-1", organization_id: "org-1", started_at: new Date().toISOString() });
    const deps = createFakeDeps([existingRunning]);
    const result = await runMissionBatch(deps, { organizationId: "org-1", location: "Anywhere", requestedCount: 5, ownerId: "owner-1" });
    assert.equal(result.id, "already-running-1");
    assert.equal(result.status, "running", "the caller sees the honest, still-in-progress row back, never a fabricated outcome");
    assert.equal(deps.insertCalls.length, 0, "no new run was ever created — the DB-level unique index is never even asked to reject a duplicate");
  });

  test("a genuinely abandoned (stale) running run — reaped as failed with an honest reason, then a real new run proceeds", async () => {
    const staleRunning = fakeRun({
      id: "stale-1",
      organization_id: "org-1",
      started_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    });
    const deps = createFakeDeps([staleRunning]);
    const result = await runMissionBatch(deps, { organizationId: "org-1", location: "Anywhere", requestedCount: 5, ownerId: "owner-1" });

    assert.equal(deps.updateCalls.length >= 1, true);
    const reapUpdate = deps.updateCalls.find((u) => u.id === "stale-1");
    assert.ok(reapUpdate, "the stale run was updated");
    assert.equal(reapUpdate!.values.status, "failed");
    assert.match(reapUpdate!.values.error_message as string, /abandoned/i);

    assert.equal(deps.insertCalls.length, 1, "a real new run was created after reaping the stale one");
    assert.equal(result.status, "complete");
    assert.equal(result.stop_reason, "pool_exhausted");
    assert.notEqual(result.id, "stale-1", "the new run is a distinct row, never the reused stale one");
  });

  test("two organizations never interfere — an org-2 run proceeds normally while org-1 has its own running run", async () => {
    const org1Running = fakeRun({ id: "org1-running", organization_id: "org-1" });
    const deps = createFakeDeps([org1Running]);
    const result = await runMissionBatch(deps, { organizationId: "org-2", location: "Elsewhere", requestedCount: 3, ownerId: "owner-2" });
    assert.notEqual(result.id, "org1-running");
    assert.equal(result.status, "complete");
    assert.equal(deps.insertCalls.length, 1);
  });
});
