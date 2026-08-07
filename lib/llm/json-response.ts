/**
 * Defensive JSON extraction from a raw LLM text response
 * (docs/ARCHITECTURE_SPECIFICATION_V1.md §3: "require strict structured
 * JSON output... add real parsing/validation... rather than assuming a
 * clean parse always succeeds"). Models occasionally wrap JSON in prose
 * ("Here's the JSON you asked for: ...") or markdown fences (```json ...
 * ```) even when explicitly instructed to return only JSON — this strips
 * both before parsing. Provider-agnostic: used identically regardless of
 * which LlmProvider produced the raw text.
 */
export function extractJsonFromLlmResponse(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();

  // If there's still leading/trailing prose around a JSON object/array,
  // narrow to the outermost {...} or [...] span rather than failing
  // outright on the first parse attempt.
  const firstBrace = candidate.search(/[{[]/);
  const lastBrace = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  const jsonSlice =
    firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
      ? candidate.slice(firstBrace, lastBrace + 1)
      : candidate;

  try {
    return JSON.parse(jsonSlice);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown parse error";
    throw new Error(`Failed to parse JSON from LLM response (${reason}). Raw response: ${raw.slice(0, 500)}`);
  }
}
