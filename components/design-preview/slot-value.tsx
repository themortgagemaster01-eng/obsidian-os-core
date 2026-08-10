import type { ComponentSlot } from "@/lib/services/design-generation-service";

/**
 * Renders one ComponentSlot (lib/services/design-generation-service.ts)
 * honestly: a "real" slot shows its actual value. A "placeholder" slot
 * (evidence this business's crawl never captured) renders nothing at all —
 * §8's zero-fabrication rule applied to the customer-facing surface, per
 * the Product Surface Pass's explicit instruction that internal placeholder
 * syntax (`[Field — placeholder]`) must never reach a customer. Call sites
 * are responsible for not rendering an empty wrapper (label, box, section)
 * around a slot that renders nothing — see design-preview.tsx's per-section
 * real-only filtering.
 */
export function SlotValue({ slot }: { slot: ComponentSlot }) {
  if (slot.source === "real" && slot.value) {
    return <span>{slot.value}</span>;
  }
  return null;
}

/** True only for a slot with an actual, real, non-empty value — the one condition under which a slot (and anything wrapping it) should render at all. */
export function isRealSlot(slot: ComponentSlot): boolean {
  return slot.source === "real" && !!slot.value;
}
