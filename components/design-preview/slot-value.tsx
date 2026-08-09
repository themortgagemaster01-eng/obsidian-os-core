import type { ComponentSlot } from "@/lib/services/design-generation-service";
import { MUTED_TEXT_OPACITY } from "@/lib/design-render/safe-css";

/**
 * Renders one ComponentSlot (lib/services/design-generation-service.ts)
 * honestly: a "real" slot shows its actual value; a "placeholder" slot shows
 * a visibly-marked placeholder, never invented text standing in for it
 * (§8's zero-fabrication rule, same discipline Trust QA §4.8 will enforce
 * later — this renderer holds itself to it now, at display time).
 */
export function SlotValue({ slot, textColor }: { slot: ComponentSlot; textColor: string }) {
  if (slot.source === "real" && slot.value) {
    return <span>{slot.value}</span>;
  }

  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.25em 0.6em",
        border: `1px dashed ${textColor}`,
        borderRadius: "0.375rem",
        opacity: MUTED_TEXT_OPACITY,
        fontStyle: "italic",
        fontSize: "0.85em",
      }}
    >
      [{humanizeSlotName(slot.name)} — placeholder]
    </span>
  );
}

function humanizeSlotName(name: string): string {
  return name
    .replace(/-\d+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
