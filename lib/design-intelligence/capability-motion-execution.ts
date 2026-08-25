import type { Wireframe } from "@/lib/services/design-generation-service";
import { refineMotion, type MotionRefinement } from "@/lib/services/design-refinement-service";
import { resolveExperienceCapabilities, type CapabilityDecision } from "@/lib/design-intelligence/capability-selector";
import { requestCapabilityExecution } from "@/lib/design-intelligence/capability-adapter-registry";
import type { BasicMotionAdapterInput } from "@/lib/design-intelligence/basic-motion-adapter";
import type { IndustryBucket } from "@/lib/design-references/reference-library";
import type { ExperiencePlanEvidenceDensity } from "@/lib/design-intelligence/experience-planner";

/**
 * lib/design-intelligence/capability-motion-execution.ts — the live
 * integration point (Robert's Phase 6.5 integration follow-up): the first
 * real seam where the generation pipeline actually traverses
 * Resolved Experience Plan -> Capability Selector -> Capability Adapter
 * Registry -> Granted Adapter -> Existing Motion Execution, rather than
 * calling refineMotion directly. design-generation-service.ts's
 * generateWebsiteStructure calls resolveMotionThroughCapabilities below in
 * place of relying solely on refineDesign's own internal refineMotion call.
 *
 * Deliberately its OWN file, not added inside design-refinement-service.ts.
 * basic-motion-adapter.ts already imports refineMotion FROM design-
 * refinement-service.ts; putting this glue INSIDE that same file (which
 * capability-adapter-registry.ts -> basic-motion-adapter.ts would then
 * import back into) would create a real import cycle. Living here instead —
 * downstream of BOTH the capability layer and design-refinement-service.ts —
 * keeps the dependency graph a clean DAG:
 *
 *   design-generation-service.ts
 *     -> capability-motion-execution.ts (this file)
 *          -> capability-selector.ts
 *          -> capability-adapter-registry.ts -> basic-motion-adapter.ts
 *               -> design-refinement-service.ts (real import: refineMotion)
 *
 * design-refinement-service.ts's own `import type { Wireframe }` back to
 * design-generation-service.ts is a type-only import, erased at compile
 * time, never a runtime edge — so this graph has no cycle.
 *
 * Adds ZERO new motion logic. refineMotion (design-refinement-service.ts)
 * is called here with the SAME inputs design-generation-service.ts already
 * passed it before this integration existed, and is used both to compute
 * the pre-capability value AND, unconditionally, as the fail-closed safe
 * fallback for every anomaly (a legacy wireframe with no ExperiencePlan,
 * a capability that isn't granted, no adapter registered, unmet adapter
 * requirements, or a thrown execute()). The capability seam only ever
 * decides WHICH already-correct MotionRefinement is returned — it never
 * computes a different one, per the founder's "must continue wrapping/
 * reusing the current motion implementation rather than reimplementing it."
 */

export interface ResolveMotionThroughCapabilitiesInput {
  wireframe: Wireframe;
  motionIntensity: "restrained" | "energetic";
  /** Real evidence-density counts — genuinely available at generateWebsiteStructure's own call site (built via buildExperiencePlanInputs, the same construction generateWireframe's own experiencePlan resolution already used). Passed through to resolveExperienceCapabilities for forward compatibility with a future evidence-gated token; unused by basic-motion's own gate today. */
  evidence?: ExperiencePlanEvidenceDensity;
  industryBucket?: IndustryBucket;
}

export interface CapabilityIntegratedMotionResult {
  motion: MotionRefinement;
  /**
   * Real, always-populated capability decisions for observability/
   * explainability (docs/PHASE_6.5_CAPABILITY_AUDIT.md's own "capability
   * selection and adapter resolution remain explainable" requirement).
   * Empty only for a legacy wireframe (no ExperiencePlan) — there is no
   * capability decision to make when there was never an ExperiencePlan to
   * gate on. Not persisted anywhere by this integration (Robert's "do not
   * persist capability data unless absolutely necessary" instruction) —
   * callers that want it can read it; generateWebsiteStructure does not
   * thread it onto WebsiteStructure/Wireframe today.
   */
  capabilityDecisions: CapabilityDecision[];
}

/**
 * The existing computation, defensively wrapped. refineMotion has never
 * been required to survive a genuinely corrupted/malformed persisted
 * wireframe (not something the real pipeline can produce) — this wrapper
 * adds that guarantee at the integration boundary specifically, so
 * resolveMotionThroughCapabilities below can promise "no crash, no broken
 * page" as an absolute, not merely "safe under the failure modes the
 * capability layer itself introduces." For any real, pipeline-produced
 * wireframe this is a pure passthrough — the try/catch is never entered.
 */
function safeExistingMotion(wireframe: Wireframe, motionIntensity: "restrained" | "energetic"): MotionRefinement {
  try {
    return refineMotion(wireframe, motionIntensity);
  } catch {
    return { intensity: motionIntensity, motions: [], hover: [], violations: [] };
  }
}

/**
 * resolveMotionThroughCapabilities — the one entry point
 * design-generation-service.ts's generateWebsiteStructure calls. Always
 * returns a real, valid MotionRefinement — never partial, never throws,
 * matching resolveExperiencePlan/resolveCompositionVariant's own "always a
 * real answer" contract, extended here to "and never a crash."
 */
export function resolveMotionThroughCapabilities(
  input: ResolveMotionThroughCapabilitiesInput
): CapabilityIntegratedMotionResult {
  const { wireframe, motionIntensity } = input;

  // The existing, already-tested computation — computed first, used
  // unconditionally as the fail-closed safe fallback in every branch below.
  const existingMotion = safeExistingMotion(wireframe, motionIntensity);

  if (!wireframe.experiencePlan) {
    // A legacy wireframe was never eligible for capability selection in the
    // first place (Phase 6.1's ExperiencePlan didn't exist yet for it) — the
    // capability layer is never consulted, matching refineMotion's own
    // pre-existing legacy/no-plan behavior exactly.
    return { motion: existingMotion, capabilityDecisions: [] };
  }

  const capabilityDecisions = resolveExperienceCapabilities({
    experiencePlan: wireframe.experiencePlan,
    evidence: input.evidence,
    industryBucket: input.industryBucket,
    heroPattern: wireframe.compositionVariant?.heroPattern,
  });

  const basicMotionDecision = capabilityDecisions.find((d) => d.token === "basic-motion");
  if (!basicMotionDecision?.granted) {
    // Not granted — today this means the resolved motion budget is "none".
    // refineMotion's own "none" branch already produced the true
    // zero-motion result inside existingMotion above; that IS the correct
    // output here, not a failure requiring a different fallback shape.
    return { motion: existingMotion, capabilityDecisions };
  }

  const executionResult = requestCapabilityExecution<BasicMotionAdapterInput, MotionRefinement>("basic-motion", {
    wireframe,
    motionIntensity,
  });

  // Fail closed: no adapter registered for a granted token (executionResult
  // === null), or the adapter itself degraded to its own fallback (unmet
  // requirements or a thrown execute(), executionResult.status ===
  // "fallback-active") — either way, existingMotion (the real,
  // already-verified computation, not the adapter's own generic empty-
  // shape fallback) is the safe result. Never a crash, never a silently
  // different render from what this business would have gotten before this
  // integration existed.
  if (!executionResult || executionResult.status !== "active") {
    return { motion: existingMotion, capabilityDecisions };
  }

  return { motion: executionResult.payload, capabilityDecisions };
}
