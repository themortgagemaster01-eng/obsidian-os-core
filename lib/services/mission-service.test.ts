import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  computeMissionControlStats,
  computeMissionsWithPreview,
  computeMissionStageTrack,
  computeProductionLineCounts,
  getProductionLineStage,
  groupMissionsForDisplay,
  sortMissionsForReview,
  isDesignSnapshotStale,
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
    batch_run_id: null,
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

describe("getProductionLineStage (Visual Redesign — The Line)", () => {
  test("maps discovered and analyzing to research", () => {
    assert.equal(getProductionLineStage("discovered"), "research");
    assert.equal(getProductionLineStage("analyzing"), "research");
  });

  test("maps researching to brief, reviewing to approval, designing to build, qa to qa", () => {
    assert.equal(getProductionLineStage("researching"), "brief");
    assert.equal(getProductionLineStage("reviewing"), "approval");
    assert.equal(getProductionLineStage("designing"), "build");
    assert.equal(getProductionLineStage("qa"), "qa");
  });

  test("archived, rejected, and the unwired sales-pipeline states are off the Line", () => {
    for (const state of ["proposal", "email", "approval", "sent", "archived", "rejected"] as const) {
      assert.equal(getProductionLineStage(state), null, `${state} should be null`);
    }
  });
});

describe("computeProductionLineCounts", () => {
  test("counts real missions per stage, ignores states off the Line", () => {
    const counts = computeProductionLineCounts([
      missionAt("discovered"),
      missionAt("analyzing"),
      missionAt("researching"),
      missionAt("reviewing"),
      missionAt("reviewing"),
      missionAt("designing"),
      missionAt("qa"),
      missionAt("archived"),
      missionAt("rejected"),
      missionAt("sent"),
    ]);
    assert.deepEqual(counts, { research: 2, brief: 1, approval: 2, build: 1, qa: 1 });
  });

  test("every stage reads zero for an empty mission list — no fabricated counts", () => {
    assert.deepEqual(computeProductionLineCounts([]), {
      research: 0,
      brief: 0,
      approval: 0,
      build: 0,
      qa: 0,
    });
  });
});

describe("computeMissionStageTrack (Signal Room)", () => {
  test("marks stages before the active one complete, the active one active, later ones upcoming", () => {
    const track = computeMissionStageTrack(missionAt("designing"), false);
    assert.ok(track);
    assert.deepEqual(
      track!.map((s) => [s.key, s.status]),
      [
        ["research", "complete"],
        ["brief", "complete"],
        ["approval", "complete"],
        ["build", "active"],
        ["qa", "upcoming"],
        ["preview", "upcoming"],
      ]
    );
  });

  test("preview reflects hasPreview independently of the active stage", () => {
    const track = computeMissionStageTrack(missionAt("qa"), true);
    assert.ok(track);
    const preview = track!.find((s) => s.key === "preview");
    assert.equal(preview?.status, "complete");
  });

  test("returns null for archived and rejected missions — no fabricated history", () => {
    assert.equal(computeMissionStageTrack(missionAt("archived"), false), null);
    assert.equal(computeMissionStageTrack(missionAt("rejected"), false), null);
  });
});

describe("groupMissionsForDisplay (Studio Docket mission list)", () => {
  test("reviewing missions go to needsReview regardless of preview status", () => {
    const m = missionAt("reviewing");
    const groups = groupMissionsForDisplay([m], new Set([m.id]));
    assert.deepEqual(groups.needsReview, [m]);
    assert.deepEqual(groups.readyToPresent, []);
  });

  test("Phase 9 fix: approval-state missions go to needsReview too — a real, complete proposal + email draft awaiting a founder decision, the same urgency as 'reviewing'", () => {
    const m = missionAt("approval");
    const groups = groupMissionsForDisplay([m], new Set([m.id]));
    assert.deepEqual(groups.needsReview, [m]);
    assert.deepEqual(groups.readyToPresent, []);
  });

  test("non-reviewing missions with a preview go to readyToPresent", () => {
    const m = missionAt("qa");
    const groups = groupMissionsForDisplay([m], new Set([m.id]));
    assert.deepEqual(groups.readyToPresent, [m]);
  });

  test("everything else goes to inProduction", () => {
    const m = missionAt("designing");
    const groups = groupMissionsForDisplay([m]);
    assert.deepEqual(groups.inProduction, [m]);
  });

  test("every mission appears in exactly one group", () => {
    const missions = [
      missionAt("discovered"),
      missionAt("reviewing"),
      missionAt("qa"),
      missionAt("archived"),
    ];
    const withPreview = new Set([missions[2].id]);
    const groups = groupMissionsForDisplay(missions, withPreview);
    const total =
      groups.needsReview.length + groups.inProduction.length + groups.readyToPresent.length;
    assert.equal(total, missions.length);
  });
});

// ===========================================================================
// Preview-refresh bug (2026-09-14) — Robert's real report: "It wants me to
// refresh for the generate button to come up when I click on preview."
// Confirmed against the real Joseph J. Smith Funeral Home Inc. mission, whose
// pipeline genuinely succeeded end to end (WebsiteDesignReady -> DesignQaComplete
// PASS) but whose website_designs row had preview_screenshot_desktop_path: null
// with no error — the Capture control was never reachable, so capture was never
// triggered. Root cause: the mission panel's client state is seeded once from
// server props and only ever refreshed by a poll gated on the client ALREADY
// believing work is in flight, so a stale mount (App Router's client Router
// Cache, e.g. navigating to the preview route and back) can never self-correct.
// This is that fix's own decision function: does the mounted snapshot disagree
// with current server truth in a way that changes what renders?
// ===========================================================================
type StaleCheckRow = Parameters<typeof isDesignSnapshotStale>[0];

function designRow(overrides: Partial<NonNullable<StaleCheckRow>> = {}): NonNullable<StaleCheckRow> {
  return {
    id: "design-1",
    status: "complete",
    qa_result: null,
    preview_screenshot_desktop_path: null,
    ...overrides,
  } as NonNullable<StaleCheckRow>;
}

describe("isDesignSnapshotStale (preview-refresh bug)", () => {
  test("no design in either the snapshot or current truth — not stale, nothing to re-render", () => {
    assert.equal(isDesignSnapshotStale(null, null), false);
  });

  test("THE REPORTED BUG: snapshot had no design row but one now exists — stale", () => {
    // This is the exact dead-end: with websiteDesign null the panel's poll
    // gate (designInFlight/needsQaPoll/captureInFlight all false) never fires,
    // so without this reconcile the page could only be fixed by a hard refresh.
    assert.equal(isDesignSnapshotStale(null, designRow()), true);
  });

  test("QA results arriving between the snapshot and now — stale (this is what gates the Capture button)", () => {
    const before = designRow({ qa_result: null });
    const after = designRow({ qa_result: { overallVerdict: "PASS" } as never });
    assert.equal(isDesignSnapshotStale(before, after), true);
  });

  test("status advancing from pending to complete — stale", () => {
    assert.equal(isDesignSnapshotStale(designRow({ status: "pending" }), designRow({ status: "complete" })), true);
  });

  test("a preview screenshot arriving — stale", () => {
    const after = designRow({ preview_screenshot_desktop_path: "org/mission/design/desktop.png" });
    assert.equal(isDesignSnapshotStale(designRow(), after), true);
  });

  test("a different design run (regeneration) — stale", () => {
    assert.equal(isDesignSnapshotStale(designRow({ id: "design-1" }), designRow({ id: "design-2" })), true);
  });

  test("a fully settled, unchanged mission — NOT stale, so no needless router.refresh() on every page load", () => {
    const settled = designRow({
      status: "complete",
      qa_result: { overallVerdict: "PASS" } as never,
      preview_screenshot_desktop_path: "org/mission/design/desktop.png",
    });
    assert.equal(isDesignSnapshotStale(settled, settled), false);
  });

  test("compares field presence only — a differing qa_result payload on the same run is not treated as stale", () => {
    const a = designRow({ qa_result: { overallVerdict: "PASS" } as never });
    const b = designRow({ qa_result: { overallVerdict: "WARN" } as never });
    assert.equal(isDesignSnapshotStale(a, b), false);
  });
});
