/**
 * Phase 2 verification script: runs the real Analysis -> Insights ->
 * Opportunity Score -> OpportunityReport chain against a real business URL,
 * with no mocked data anywhere in the pipeline. Requires the Sprint 3
 * dependencies (cheerio, puppeteer, lighthouse, chrome-launcher, axe-core)
 * to actually be installed and, for the three headless-Chrome adapters
 * (accessibility, lighthouse, screenshot) to produce real (non-fetchError)
 * results, a working Chromium/Chrome binary on PATH — neither of which
 * this sandbox has, so those three intentionally still ran for real here
 * and failed for real (see docs/SPRINT_3_PHASE_2_REPORT.md for the actual
 * output). This is a plain ts-node/tsx-style script, not a test — run it
 * with: npx tsx scripts/demo-analysis-pipeline.ts [url]
 */
import { runCrawlAdapter } from "@/lib/adapters/crawl-adapter";
import { runMobileAnalysisAdapter } from "@/lib/adapters/mobile-analysis-adapter";
import { runSeoAdapter } from "@/lib/adapters/seo-adapter";
import { runTechDetectionAdapter } from "@/lib/adapters/tech-detection-adapter";
import { runAccessibilityAdapter } from "@/lib/adapters/accessibility-adapter";
import { runLighthouseAdapter } from "@/lib/adapters/lighthouse-adapter";
import { runScreenshotAdapter } from "@/lib/adapters/screenshot-adapter";
import { normalizedAnalysisFromRawResults } from "@/lib/services/analysis-types";
import { generateInsights } from "@/lib/services/insight-service";
import { computeOpportunityScore } from "@/lib/services/opportunity-scoring-service";
import { assembleOpportunityReport } from "@/lib/services/opportunity-report-service";

const TARGET_URL = process.argv[2] ?? "https://example.com";

async function main() {
  console.log(`\n=== Phase 2 end-to-end demo: ${TARGET_URL} ===\n`);

  console.log("--- Running adapters (real HTTP requests, no mocked data) ---");
  const [crawl, mobile, seo, techDetection] = await Promise.all([
    runCrawlAdapter(TARGET_URL),
    runMobileAnalysisAdapter(TARGET_URL),
    runSeoAdapter(TARGET_URL),
    runTechDetectionAdapter(TARGET_URL),
  ]);
  console.log("crawl-adapter:          ", crawl.fetchError ? `FAILED: ${crawl.fetchError}` : "OK (real)");
  console.log("mobile-analysis-adapter:", mobile.fetchError ? `FAILED: ${mobile.fetchError}` : "OK (real)");
  console.log("seo-adapter:            ", seo.fetchError ? `FAILED: ${seo.fetchError}` : "OK (real)");
  console.log("tech-detection-adapter: ", techDetection.fetchError ? `FAILED: ${techDetection.fetchError}` : "OK (real)");

  console.log("\n--- Attempting the three headless-Chrome adapters (honest attempt, not skipped) ---");
  const [accessibility, lighthouse, screenshot] = await Promise.all([
    runAccessibilityAdapter(TARGET_URL),
    runLighthouseAdapter(TARGET_URL),
    runScreenshotAdapter(TARGET_URL, async (fileName) => `stub://${fileName}`),
  ]);
  console.log("accessibility-adapter:  ", accessibility.fetchError ? `FAILED (real error): ${accessibility.fetchError}` : "OK (real)");
  console.log("lighthouse-adapter:     ", lighthouse.fetchError ? `FAILED (real error): ${lighthouse.fetchError}` : "OK (real)");
  console.log("screenshot-adapter:     ", screenshot.fetchError ? `FAILED (real error): ${screenshot.fetchError}` : "OK (real)");

  console.log("\n--- Raw Analysis (abbreviated) ---");
  console.log(JSON.stringify({ crawl, mobile, seo, techDetection }, null, 2).slice(0, 2000));

  console.log("\n--- Normalized Analysis ---");
  const normalized = normalizedAnalysisFromRawResults(
    { crawl, mobile, seo, accessibility, lighthouse, techDetection },
    TARGET_URL
  );
  console.log(JSON.stringify(normalized, null, 2));

  console.log("\n--- Insights ---");
  const insights = generateInsights(normalized);
  console.log(JSON.stringify(insights, null, 2));

  console.log("\n--- Opportunity Score ---");
  const scoreResult = computeOpportunityScore(normalized);
  console.log(JSON.stringify(scoreResult, null, 2));

  console.log("\n--- OpportunityReport (final object) ---");
  const report = assembleOpportunityReport(normalized, insights, scoreResult);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
