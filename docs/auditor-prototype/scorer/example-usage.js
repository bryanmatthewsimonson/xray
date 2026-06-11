// Example: programmatic use of the scorer.
//
// Run with:  ANTHROPIC_API_KEY=sk-ant-... node example-usage.js

import { scoreArticle, formatSummary } from "./scorer.js";
import { writeFile } from "node:fs/promises";

const SAMPLE_ARTICLE = `# Fed officials signal patience as inflation eases

WASHINGTON — Federal Reserve officials indicated Tuesday that they are
prepared to hold interest rates steady for an extended period, even as
new data showed consumer prices rose at their slowest pace in three years.

The Consumer Price Index climbed 0.2% in April, bringing the annual
inflation rate to 2.8%, the Labor Department reported. That is down
from 3.1% in March and the lowest reading since early 2021.

"We have made significant progress," one senior Fed official said,
speaking on condition of anonymity to discuss internal deliberations.
"But we want to see sustained evidence before we declare victory."

Critics, however, argue that the central bank's caution risks a
recession. Many economists worry that holding rates too high for too
long could push unemployment above 5%.

Treasury Secretary Janet Williams said the administration was
"encouraged" by the data. Analysts expect the Fed to begin cutting
rates by the end of the year.
`;

const SAMPLE_METADATA = {
  source_url: "https://example.com/fed-inflation-2026-05-06",
  headline: "Fed officials signal patience as inflation eases",
  byline: "Sample Reporter",
  publication_id: "example-publication",
  publication_date: "2026-05-06",
  language: "en",
  capture_method: "manual_paste",
};

async function main() {
  console.log("Scoring sample article...\n");

  const result = await scoreArticle({
    markdown: SAMPLE_ARTICLE,
    metadata: SAMPLE_METADATA,
  });

  // Pretty summary to stdout.
  console.log(formatSummary(result));

  // Full structured result to disk.
  await writeFile("sample-audit.json", JSON.stringify(result, null, 2), "utf8");
  console.log("\nFull structured audit written to sample-audit.json");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
