/**
 * scripts/run-scheduled-batch.ts — Phase 10's thin CLI adapter around the
 * existing, unmodified mission-batch orchestrator
 * (lib/services/mission-batch-service.ts). This file contains no
 * orchestration logic of its own: it reads configuration, builds the same
 * deps the existing HTTP route already builds, calls the exact same
 * `runMissionBatch`, and translates the result into a process exit code.
 * Everything that decides what "successful," "failed," "pool exhausted,"
 * or "already running" means lives in mission-batch-service.ts alone —
 * this file must never grow a second copy of any of that.
 *
 * Intended caller: a GitHub Actions job (scheduled or manually dispatched),
 * via `npm run build:scripts && node --require ./scripts/register-path-alias.js .scripts-build/scripts/run-scheduled-batch.js`
 * with PATH_ALIAS_BUILD_ROOT=.scripts-build set. Not intended to be run
 * against the local dev Supabase instance for routine local testing — that
 * remains the existing dashboard's "Prepare N packages" action
 * (POST /api/mission-batches), untouched by this file.
 *
 * Configuration is exactly the four values docs/PHASE_10_IMPLEMENTATION_PLAN.md
 * §3 specifies, read directly from process.env (no .env.local parsing — a
 * real CI environment already injects these as real environment variables):
 *
 *   BATCH_OWNER_PROFILE_ID  — a real profiles.id; organizationId is derived
 *                             from this profile's own default_organization_id,
 *                             never a second, independently-configured value.
 *   BATCH_LOCATION          — the founder's own target area (never hardcoded).
 *   BATCH_REQUESTED_COUNT   — how many approval-ready packages to target.
 *   BATCH_MAX_ATTEMPTS      — optional; runMissionBatch's own default
 *                             (requestedCount * 3) applies if unset.
 *
 * Exit codes (deliberately distinct, so a GitHub Actions job can tell these
 * apart in its own logs without parsing prose):
 *   0  — the batch reached a real terminal status of any business outcome
 *        (complete, whatever its stop_reason — including a pool-exhausted
 *        night with zero successes, which is correct behavior, not a bug),
 *        OR the overlap guard safely skipped this invocation because a
 *        batch was already running. Neither case is a failure worth a red
 *        workflow run.
 *   1  — the run itself reached status "failed" (a genuine systemic
 *        problem — a real, existing outcome mission-batch-service.ts
 *        already produces, not new here).
 *   78 — configuration is missing or invalid (the traditional sysexits.h
 *        EX_CONFIG code). Distinct from 1 on purpose: a workflow step can
 *        treat this as "not configured yet, skip quietly" rather than an
 *        alarming failure, which matters for a schedule that may be merged
 *        before real secrets/variables are ever supplied.
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { profileRepository } from "@/lib/repositories/profile-repository";
import { runMissionBatch, createMissionBatchServiceDeps } from "@/lib/services/mission-batch-service";

const EXIT_SUCCESS = 0;
const EXIT_BATCH_FAILED = 1;
const EXIT_CONFIG_INVALID = 78;

interface ScheduledBatchConfig {
  ownerId: string;
  location: string;
  requestedCount: number;
  maxAttempts?: number;
}

/**
 * Pure — no I/O, no env access. Directly unit-testable against hand-built
 * env-var maps, matching this codebase's own established "pure decision,
 * separately testable" pattern (decideBatchStop, decideOverlapGuardAction).
 * Returns a list of human-legible problems rather than throwing on the
 * first one, so a misconfigured environment reports everything wrong with
 * it at once, not one frustrating error at a time.
 */
export function parseScheduledBatchConfig(env: NodeJS.ProcessEnv): { config: ScheduledBatchConfig; errors: [] } | { config: null; errors: string[] } {
  const errors: string[] = [];

  const ownerId = env.BATCH_OWNER_PROFILE_ID?.trim();
  if (!ownerId) {
    errors.push("BATCH_OWNER_PROFILE_ID is required — a real profiles.id to run this batch on behalf of.");
  }

  const location = env.BATCH_LOCATION?.trim();
  if (!location) {
    errors.push("BATCH_LOCATION is required — the target area, never hardcoded.");
  }

  const requestedCountRaw = env.BATCH_REQUESTED_COUNT?.trim();
  let requestedCount: number | undefined;
  if (!requestedCountRaw) {
    errors.push("BATCH_REQUESTED_COUNT is required — how many approval-ready packages to target.");
  } else {
    const parsed = Number(requestedCountRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.push(`BATCH_REQUESTED_COUNT must be a positive integer (got: "${requestedCountRaw}").`);
    } else {
      requestedCount = parsed;
    }
  }

  let maxAttempts: number | undefined;
  const maxAttemptsRaw = env.BATCH_MAX_ATTEMPTS?.trim();
  if (maxAttemptsRaw) {
    const parsed = Number(maxAttemptsRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.push(`BATCH_MAX_ATTEMPTS must be a positive integer when set (got: "${maxAttemptsRaw}").`);
    } else {
      maxAttempts = parsed;
    }
  }

  if (errors.length > 0 || !ownerId || !location || requestedCount === undefined) {
    return { config: null, errors };
  }

  return { config: { ownerId, location, requestedCount, maxAttempts }, errors: [] };
}

async function main(): Promise<number> {
  const { config, errors } = parseScheduledBatchConfig(process.env);
  if (!config) {
    console.error("[run-scheduled-batch] Configuration invalid — refusing to start a batch:");
    for (const error of errors) console.error(`  - ${error}`);
    return EXIT_CONFIG_INVALID;
  }

  const client = createServiceRoleClient();

  const profile = await profileRepository.findById(client, config.ownerId);
  const organizationId = profile?.default_organization_id;
  if (!organizationId) {
    console.error(
      `[run-scheduled-batch] BATCH_OWNER_PROFILE_ID "${config.ownerId}" has no profile, or no default organization, in this database. ` +
        "This is a real, existing profile requirement (the founder must have signed in at least once), not something this script can fix by guessing."
    );
    return EXIT_CONFIG_INVALID;
  }

  console.log(
    `[run-scheduled-batch] Starting: organization ${organizationId}, location "${config.location}", target ${config.requestedCount}` +
      (config.maxAttempts ? `, max attempts ${config.maxAttempts}` : ", default max attempts (requestedCount * 3)")
  );

  const deps = createMissionBatchServiceDeps(client);
  const run = await runMissionBatch(deps, {
    organizationId,
    location: config.location,
    requestedCount: config.requestedCount,
    maxAttempts: config.maxAttempts,
    ownerId: config.ownerId,
  });

  console.log(
    `[run-scheduled-batch] Finished: status=${run.status} stop_reason=${run.stop_reason ?? "n/a"} ` +
      `attempted=${run.attempted_count} succeeded=${run.succeeded_count} failed=${run.failed_count}` +
      (run.error_message ? ` error_message="${run.error_message}"` : "")
  );

  if (run.status === "running") {
    console.log("[run-scheduled-batch] A batch was already running for this organization — this invocation was safely skipped, not a failure.");
    return EXIT_SUCCESS;
  }

  return run.status === "failed" ? EXIT_BATCH_FAILED : EXIT_SUCCESS;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error("[run-scheduled-batch] Unexpected, unhandled error:", err);
    process.exitCode = EXIT_BATCH_FAILED;
  });
