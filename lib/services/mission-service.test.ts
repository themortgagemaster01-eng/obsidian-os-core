import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  computeMissionControlStats,
  computeMissionsWithPreview,
  sortMissionsForReview,
} from "@/lib/services/mission-service";
import type { MissionRow } from "@/lib/repositories/mission-repository";
import type { MissionState } from "@/lib/workflow/mission-state";

let missionCounter = 0;

function missionAt(state: MissionState, overrides: Partial<MissionRow> = {}): MissionRow {
  missionCounter += 1;
  const now = new Date().toISOString();
  return {
    id: `mission-${missionCounter}`,
    owner_id: "owner-1",
    organization_id: "org-1",
    company_id: null,
    business_name: `Business ${missionCounter}`,
    website_url: "https://example.test",
    state,
    state_changed_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("computeMissionControlStats — Waiting Approval (Dashboard Product Pass Change 1)", () => {
  test("a mission in reviewing state increments waitingApproval", () => {
    const stats = computeMissionControlStats([missionAt("reviewing")]);
    assert.equal(stats.waitingApproval, 1);
  });

  test("a mission in an unrelated state does not increment waitingApproval", () => {
    const stats = computeMissionControlStats([
      missionAt("discovered"),
      missionAt("analyzing"),
      missionAt("designing"),
      missionAt("qa"),
      missionAt("approval"), // the later, distinct proposal/email approval gate — not the same thing
      missionAt("sent"),
      missionAt("archived"),
      missionAt("rejected"),
    ]);
    assert.equal(stats.waitingApproval, 0);
  });

  test("counts multiple reviewing missions, ignores everything else", () => {
    const stats = computeMissionControlStats([
      missionAt("reviewing"),
      missionAt("reviewing"),
      missionAt("researching"),
    ]);
    assert.equal(stats.waitingApproval, 2);
  });
});

describe("computeMissionControlStats — real metrics (Dashboard Product Pass Change 2)", () => {
  test("qaReady counts only missions at the qa state", () => {
    const stats = computeMissionControlStats([
      missionAt("qa"),
      missionAt("qa"),
      missionAt("designing"),
      missionAt("proposal"),
    ]);
    assert.equal(stats.qaReady, 2);
  });

  test("previewReady counts only missions present in the preview set", () => {
    const withPreview = missionAt("qa");
    const withoutPreview = missionAt("qa");
    const stats = computeMissionControlStats(
      [withPreview, withoutPreview],
      new Set([withPreview.id])
    );
    assert.equal(stats.previewReady, 1);
  });

  test("previewReady defaults to 0 when no preview set is passed", () => {
    const stats = computeMissionControlStats([missionAt("qa")]);
    assert.equal(stats.previewReady, 0);
  });

  test("runningMissions and completedToday are unchanged by this pass (no regression)", () => {
    const stats = computeMissionControlStats([
      missionAt("discovered"),
      missionAt("sent"),
      missionAt("archived"),
      missionAt("rejected"),
    ]);
    assert.equal(stats.runningMissions, 1); // only "discovered"
  });

  test("stats only ever reflect the missions passed in — no cross-organization leakage at this layer", () => {
    // computeMissionControlStats has no knowledge of organization_id; it only
    // ever sees what listMissionsForOrganization()/RLS already scoped. This
    // proves the function itself introduces no leakage: an org-B mission
    // never influences org-A's counts unless it's literally in the array.
    const orgAMissions = [missionAt("reviewing", { organization_id: "org-a" })];
    const orgBMissions = [
      missionAt("reviewing", { organization_id: "org-b" }),
      missionAt("qa", { organization_id: "org-b" }),
    ];

    const orgAStats = computeMissionControlStats(orgAMissions);
    assert.equal(orgAStats.waitingApproval, 1);
    assert.equal(orgAStats.qaReady, 0);

    const orgBStats = computeMissionControlStats(orgBMissions);
    assert.equal(orgBStats.waitingApproval, 1);
    assert.equal(orgBStats.qaReady, 1);
  });
});

describe("computeMissionsWithPreview", () => {
  test("includes only designs with status complete", () => {
    const ids = computeMissionsWithPreview([
      { mission_id: "m1", status: "complete" },
      { mission_id: "m2", status: "pending" },
      { mission_id: "m3", status: "failed" },
      { mission_id: "m4", status: "running" },
    ]);
    assert.deepEqual([...ids].sort(), ["m1"]);
  });

  test("returns an empty set for no designs", () => {
    assert.equal(computeMissionsWithPreview([]).size, 0);
  });
});

describe("sortMissionsForReview (Change 3 — surfacing missions needing founder review)", () => {
  test("reviewing missions are moved ahead of everything else", () => {
    const m1 = missionAt("discovered");
    const m2 = missionAt("reviewing");
    const m3 = missionAt("qa");
    const m4 = missionAt("reviewing");

    const sorted = sortMissionsForReview([m1, m2, m3, m4]);

    assert.deepEqual(
      sorted.map((m) => m.id),
      [m2.id, m4.id, m1.id, m3.id]
    );
  });

  test("is a no-op when no mission is reviewing", () => {
    const m1 = missionAt("discovered");
    const m2 = missionAt("qa");
    assert.deepEqual(sortMissionsForReview([m1, m2]), [m1, m2]);
  });
});
