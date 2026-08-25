import { refineMotion, type MotionRefinement } from "@/lib/services/design-refinement-service";
import type { Wireframe } from "@/lib/services/design-generation-service";
import type {
  CapabilityAdapter,
  CapabilityExecutionResult,
  CapabilityFailureReason,
  CapabilityQaContract,
} from "@/lib/design-intelligence/capability-adapter";

/**
 * lib/design-intelligence/basic-motion-adapter.ts — the ONE real capability
 * adapter this phase builds (docs/PHASE_6.5_CAPABILITY_AUDIT.md item 37's
 * approved smallest next build). Wraps the EXISTING CSS transform/opacity +
 * IntersectionObserver motion system (lib/services/design-refinement-
 * service.ts's refineMotion, lib/design-render/scroll-reveal.ts) rather than
 * reimplementing it — this file adds zero new execution technology and zero
 * new runtime behavior; it only formalizes what already exists behind the
 * CapabilityAdapter port so a future Execution Runtime can request it
 * uniformly alongside future adapters, and so a future Rendered QA pass can
 * verify it the same way every other capability will be verified.
 *
 * reducedMotionStrategy is declared as "gate-initialization" because that is
 * already exactly what the wrapped system does: scroll-reveal.ts's own
 * REDUCED_MOTION_QUERY check happens in the runtime JS before the
 * IntersectionObserver ever engages — never hidden-but-still-computing. This
 * file does not add that behavior; it names a real, already-existing fact
 * about the system it wraps.
 */

export interface BasicMotionAdapterInput {
  wireframe: Wireframe;
  motionIntensity: "restrained" | "energetic";
}

function emptyMotionRefinement(motionIntensity: "restrained" | "energetic"): MotionRefinement {
  return { intensity: motionIntensity, motions: [], hover: [], violations: [] };
}

/**
 * requirementsMet: the same real prerequisite refineMotion itself already
 * needs — a wireframe with a real, non-empty sections array. Defensive, not
 * redundant: this adapter is only ever called for a token the Selector
 * already granted (which itself required a resolved, non-"none"
 * ExperiencePlan), but per capability-adapter.ts's own doc comment, an
 * adapter never trusts an upstream input blindly.
 */
function requirementsMet(input: BasicMotionAdapterInput): boolean {
  return Array.isArray(input.wireframe?.sections) && input.wireframe.sections.length > 0;
}

function execute(input: BasicMotionAdapterInput): CapabilityExecutionResult<MotionRefinement> {
  const motion = refineMotion(input.wireframe, input.motionIntensity);
  return { token: "basic-motion", status: "active", payload: motion };
}

/**
 * Safe degrade: a genuinely empty MotionRefinement — the exact same
 * zero-motion shape refineMotionFromExperiencePlan's own "none" budget
 * branch already produces (design-refinement-service.ts). Never a crash,
 * never a broken page; the page renders with no motion, which is always a
 * valid, honest state for this adapter (basic-motion's own "none" budget
 * case already proves the same shape is a real, ship-able render).
 */
function fallback(
  input: BasicMotionAdapterInput,
  failureReason: CapabilityFailureReason
): CapabilityExecutionResult<MotionRefinement> {
  return {
    token: "basic-motion",
    status: "fallback-active",
    failureReason,
    payload: emptyMotionRefinement(input.motionIntensity),
  };
}

function qaContract(result: CapabilityExecutionResult<MotionRefinement>): CapabilityQaContract {
  return {
    expected: "basic-motion",
    actual: result.status === "active" ? "basic-motion" : "static-fallback",
    status: result.status === "active" ? "active" : "degraded-but-valid",
  };
}

export const basicMotionAdapter: CapabilityAdapter<BasicMotionAdapterInput, MotionRefinement> = {
  token: "basic-motion",
  requirementsMet,
  execute,
  fallback,
  reducedMotionStrategy: "gate-initialization",
  possibleFailureReasons: ["requirements-not-met", "runtime-error"],
  qaContract,
};
