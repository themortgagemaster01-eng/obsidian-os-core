import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveAnalysisErrorMessage } from "@/lib/services/analysis-service";

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
