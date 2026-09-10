import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  resolveAnalysisErrorMessage,
  decideAnalysisOverlapGuardAction,
  checkAnalysisOverlap,
  type AnalysisServiceDeps,
} from "@/lib/services/analysis-service";
import type { WebsiteAnalysisRow } from "@/lib/repositories/website-analysis-repository";

// Phase 5.4: the "before" screenshot silently failed for 2 of 3 real Phase
// 5.3 businesses (J&B, Canadian Tire) despite their analyses reporting
// status "complete" with no error_message — traced to runScreenshotAdapter
// returning a real, structured `fetchError` on failure that analysis-
// service.ts never read. This tests the small, extracted, pure function
// that fix lives in, without needing to mock the full adapter-heavy
// runAnalysis pipeline.
describe("analysis-service: resolveAnalysisErrorMessage", () => {
  test("returns null when the screenshot captured successfully — no regression to a normal analysis", () => {
    assert.equal(resolveAnalysisErrorMessage({ fetchError: undefined }), null);
  });

  test("surfaces the real fetchError when screenshot capture failed, never silently discarding it", () => {
    assert.equal(
      resolveAnalysisErrorMessage({ fetchError: "Navigation timeout of 20000 ms exceeded" }),
      "Navigation timeout of 20000 ms exceeded"
    );
  });
});

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

function fakeAnalysisRun(overrides: Partial<WebsiteAnalysisRow> = {}): WebsiteAnalysisRow {
  const now = new Date().toISOString();
  return {
    id: "analysis-1",
    mission_id: "mission-1",
    organization_id: "org-1",
    company_id: null,
    status: "running",
    crawl_result: null,
    mobile_result: null,
    seo_result: null,
    accessibility_result: null,
    lighthouse_result: null,
    tech_detection_result: null,
    mobile_score: null,
    mobile_findings: null,
    seo_score: null,
    seo_findings: null,
    accessibility_score: null,
    accessibility_findings: null,
    lighthouse_performance: null,
    lighthouse_accessibility: null,
    lighthouse_best_practices: null,
    lighthouse_seo: null,
    technology_stack: null,
    opportunity_score: null,
    screenshot_url: null,
    above_fold_screenshot_url: null,
    error_message: null,
    started_at: now,
    completed_at: null,
    created_at: now,
    ...overrides,
  } as unknown as WebsiteAnalysisRow;
}

describe("analysis-service: decideAnalysisOverlapGuardAction (overlap protection, mirrors mission-batch-service's own guard)", () => {
  test("no in-flight analysis for this mission — proceed", () => {
    assert.deepEqual(decideAnalysisOverlapGuardAction(null, Date.now(), FIFTEEN_MIN_MS), { kind: "proceed" });
  });

  test("the mission's latest analysis already reached a terminal status — proceed, regardless of which one", () => {
    const now = Date.now();
    assert.deepEqual(decideAnalysisOverlapGuardAction(fakeAnalysisRun({ status: "complete" }), now, FIFTEEN_MIN_MS), { kind: "proceed" });
    assert.deepEqual(decideAnalysisOverlapGuardAction(fakeAnalysisRun({ status: "failed" }), now, FIFTEEN_MIN_MS), { kind: "proceed" });
  });

  test("a 'pending' row (not yet flipped to running) counts as in-flight too — already_running, not proceed", () => {
    const now = Date.now();
    const pendingRun = fakeAnalysisRun({ status: "pending", started_at: null, created_at: new Date(now - 60_000).toISOString() });
    const result = decideAnalysisOverlapGuardAction(pendingRun, now, FIFTEEN_MIN_MS);
    assert.deepEqual(result, { kind: "already_running", runningRun: pendingRun });
  });

  test("a fresh running analysis (well within the duration bound) — already_running, never a duplicate", () => {
    const now = Date.now();
    const freshRun = fakeAnalysisRun({ status: "running", started_at: new Date(now - 60_000).toISOString() });
    const result = decideAnalysisOverlapGuardAction(freshRun, now, FIFTEEN_MIN_MS);
    assert.deepEqual(result, { kind: "already_running", runningRun: freshRun });
  });

  test("a running analysis older than the max duration bound — reap it, then allow a new one to proceed", () => {
    const now = Date.now();
    const staleRun = fakeAnalysisRun({ id: "stale-analysis-1", status: "running", started_at: new Date(now - 20 * 60 * 1000).toISOString() });
    const result = decideAnalysisOverlapGuardAction(staleRun, now, FIFTEEN_MIN_MS);
    assert.deepEqual(result, { kind: "reap_stale_then_proceed", staleRunId: "stale-analysis-1" });
  });

  test("a stale 'pending' row is reaped using created_at, since it has no started_at yet", () => {
    const now = Date.now();
    const stalePending = fakeAnalysisRun({
      id: "stale-pending-1",
      status: "pending",
      started_at: null,
      created_at: new Date(now - 20 * 60 * 1000).toISOString(),
    });
    const result = decideAnalysisOverlapGuardAction(stalePending, now, FIFTEEN_MIN_MS);
    assert.deepEqual(result, { kind: "reap_stale_then_proceed", staleRunId: "stale-pending-1" });
  });

  test("exactly at the boundary is treated as still-fresh, not stale (age must exceed, not merely equal, the bound)", () => {
    const now = Date.now();
    const boundaryRun = fakeAnalysisRun({ status: "running", started_at: new Date(now - FIFTEEN_MIN_MS).toISOString() });
    assert.equal(decideAnalysisOverlapGuardAction(boundaryRun, now, FIFTEEN_MIN_MS).kind, "already_running");
  });

  test("one millisecond past the bound is stale", () => {
    const now = Date.now();
    const justPastRun = fakeAnalysisRun({ status: "running", started_at: new Date(now - FIFTEEN_MIN_MS - 1).toISOString() });
    assert.equal(decideAnalysisOverlapGuardAction(justPastRun, now, FIFTEEN_MIN_MS).kind, "reap_stale_then_proceed");
  });
});

describe("analysis-service: checkAnalysisOverlap (the route-facing guard)", () => {
  function fakeOverlapDeps(runs: WebsiteAnalysisRow[]) {
    const updated: { id: string; values: unknown }[] = [];
    const websiteAnalysisRepository = {
      async findInFlightByMission(_client: unknown, missionId: string) {
        return runs.find((r) => r.mission_id === missionId && (r.status === "pending" || r.status === "running")) ?? null;
      },
      async update(_client: unknown, id: string, values: Record<string, unknown>) {
        updated.push({ id, values });
        const index = runs.findIndex((r) => r.id === id);
        runs[index] = { ...runs[index], ...values } as WebsiteAnalysisRow;
        return runs[index];
      },
    };
    return {
      deps: { client: {}, websiteAnalysisRepository } as unknown as Pick<AnalysisServiceDeps, "client" | "websiteAnalysisRepository">,
      updated,
      runs,
    };
  }

  test("no in-flight analysis — proceed, nothing reaped", async () => {
    const { deps, updated } = fakeOverlapDeps([]);
    const result = await checkAnalysisOverlap(deps, "mission-1");
    assert.deepEqual(result, { kind: "proceed" });
    assert.equal(updated.length, 0);
  });

  test("a fresh in-flight analysis for the same mission — already_running, the real row is returned", async () => {
    const freshRun = fakeAnalysisRun({ mission_id: "mission-1", started_at: new Date().toISOString() });
    const { deps } = fakeOverlapDeps([freshRun]);
    const result = await checkAnalysisOverlap(deps, "mission-1");
    assert.deepEqual(result, { kind: "already_running", runningRun: freshRun });
  });

  test("an in-flight analysis for a DIFFERENT mission never blocks this one", async () => {
    const otherMissionRun = fakeAnalysisRun({ mission_id: "mission-2", started_at: new Date().toISOString() });
    const { deps } = fakeOverlapDeps([otherMissionRun]);
    const result = await checkAnalysisOverlap(deps, "mission-1");
    assert.deepEqual(result, { kind: "proceed" });
  });

  test("a stale in-flight analysis is actually reaped (marked failed, real error_message, completed_at set) before proceeding", async () => {
    const staleRun = fakeAnalysisRun({
      id: "stale-analysis-2",
      mission_id: "mission-1",
      started_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });
    const { deps, updated, runs } = fakeOverlapDeps([staleRun]);
    const result = await checkAnalysisOverlap(deps, "mission-1");
    assert.deepEqual(result, { kind: "proceed" });
    assert.equal(updated.length, 1);
    assert.equal(updated[0].id, "stale-analysis-2");
    assert.equal(runs[0].status, "failed");
    assert.ok(runs[0].completed_at);
    assert.match(runs[0].error_message ?? "", /abandoned/);
  });
});
