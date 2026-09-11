/**
 * Fix B (Design Intelligence Gap Map) — a real production incident (Video
 * Game Plus mission, 2026-09-11) found that a genuinely malformed LLM JSON
 * response failed the entire call outright, with zero recovery attempt.
 * This walks the text once, tracking JSON string-literal state (respecting
 * `\"` escapes), and re-classifies a `"` that appears to close a string
 * early — i.e. the next non-whitespace character isn't a valid JSON
 * continuation (`,`, `}`, `]`, `:`, or end of input) — as a literal,
 * unescaped quote INSIDE that string instead, escaping it rather than
 * ending the string there. This is the single most likely real cause of
 * the observed error class ("Expected double-quoted property name..."):
 * the model echoing real, evidence-sourced text (a business's own scraped
 * copy) that itself contains a literal `"` without escaping it when
 * producing its own JSON output. Never invents or alters actual content —
 * only reinterprets which existing character is a string terminator versus
 * a string member.
 */
function escapeStrayQuotesInStrings(text: string): string {
  let result = "";
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') {
        inString = true;
        result += ch;
        i++;
        continue;
      }
      result += ch;
      i++;
      continue;
    }
    if (ch === "\\") {
      // Preserve the existing escape sequence (backslash + the char it
      // escapes) as-is — never re-interpret an already-valid escape.
      result += ch;
      if (i + 1 < text.length) {
        result += text[i + 1];
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      const next = text[j];
      const validAfterString = next === undefined || next === "," || next === "}" || next === "]" || next === ":";
      if (validAfterString) {
        inString = false;
        result += ch;
        i++;
        continue;
      }
      // Not a valid string terminator here — a stray, unescaped quote
      // embedded in real echoed text. Escape it and keep scanning inside
      // the same string.
      result += '\\"';
      i++;
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}

/**
 * Fix B — the remaining two repairs are smaller, well-known, purely
 * syntax-level LLM JSON mistakes: a trailing comma before a closing brace/
 * bracket, and an unquoted (bare-identifier) object key. Neither invents or
 * alters content, only structure. Order matters: quote-escaping runs first
 * since it's the most likely real cause and the other two regexes assume
 * string contents are already well-formed.
 */
function attemptJsonRepair(text: string): string | null {
  let repaired = text;
  let changed = false;

  const quoteEscaped = escapeStrayQuotesInStrings(repaired);
  if (quoteEscaped !== repaired) {
    repaired = quoteEscaped;
    changed = true;
  }

  const noTrailingCommas = repaired.replace(/,(\s*[}\]])/g, "$1");
  if (noTrailingCommas !== repaired) {
    repaired = noTrailingCommas;
    changed = true;
  }

  const quotedKeys = repaired.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
  if (quotedKeys !== repaired) {
    repaired = quotedKeys;
    changed = true;
  }

  return changed ? repaired : null;
}

/**
 * Defensive JSON extraction from a raw LLM text response
 * (docs/ARCHITECTURE_SPECIFICATION_V1.md §3: "require strict structured
 * JSON output... add real parsing/validation... rather than assuming a
 * clean parse always succeeds"). Models occasionally wrap JSON in prose
 * ("Here's the JSON you asked for: ...") or markdown fences (```json ...
 * ```) even when explicitly instructed to return only JSON — this strips
 * both before parsing. Provider-agnostic: used identically regardless of
 * which LlmProvider produced the raw text.
 *
 * Fix B: if the strict parse still fails, attempts ONE bounded repair pass
 * (attemptJsonRepair above) before giving up — never a second LLM call,
 * never a new outer retry loop, never invented content. If the repaired
 * text still doesn't parse, the ORIGINAL parse error is what's thrown, not
 * a confusing error about the repair attempt itself — repair is strictly a
 * best-effort rescue, never the source of truth for what went wrong.
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
  } catch (originalErr) {
    const repaired = attemptJsonRepair(jsonSlice);
    if (repaired !== null) {
      try {
        return JSON.parse(repaired);
      } catch {
        // Repair didn't produce valid JSON either — fall through and
        // report the ORIGINAL failure below, not this second one.
      }
    }
    const reason = originalErr instanceof Error ? originalErr.message : "unknown parse error";
    throw new Error(`Failed to parse JSON from LLM response (${reason}). Raw response: ${raw.slice(0, 500)}`);
  }
}
