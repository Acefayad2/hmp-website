// Import source PDFs without paraphrasing legal terms. The source directory is
// local-only; generated text and fingerprints are committed, not the PDFs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sourceDir = process.argv[2];
if (!sourceDir) throw new Error("Usage: node scripts/import-agreement-terms.mjs <source-pdf-directory>");
const sources = [
  ["guest-seating", "gse-agreement.pdf"],
  ["accessories", "accessories-rental-agreement.pdf"],
  ["welcome-sign", "led-welcome-sign-agreement.pdf"],
  ["led-customization", "led-customization-addendum.pdf"],
  ["customization-approval", "customization-approval.pdf"],
  ["money-collecting", "money-collecting-agreement.pdf"],
  ["money-collecting-changing", "money-collecting-changing-agreement.pdf"],
  ["money-bank-verification", "money-bank-verification.pdf"],
];

const records = Object.fromEntries(sources.map(([id, filename]) => {
  const path = join(sourceDir, filename);
  let sourceText = execFileSync("pdftotext", ["-layout", path, "-"], {encoding:"utf8"});
  const optionalClauses = {};
  if (id === "led-customization") {
    // HMP previously approved four included revisions; the PDF contradicts itself.
    sourceText = sourceText.replaceAll("six (6) included revisions", "four (4) included revisions")
      .replaceAll("six (6) revisions", "four (4) revisions");
  }
  if (["money-collecting", "money-collecting-changing"].includes(id)) {
    // These are reusable templates: old prices, dates and preparer's notes must
    // not appear as fixed terms in a new client's copy.
    const takeClause = (key, start, end) => {
      const match = sourceText.match(new RegExp(`${start}[\\s\\S]*?(?=${end})`, "m"));
      if (!match) throw new Error(`Missing ${key} clause in ${filename}`);
      optionalClauses[key] = match[0].replace(/\( IF NOT NEEDED REMOVE\)|\( remove if not NEEDED\)/g, "").trim();
      sourceText = sourceText.replace(match[0], `{{${key}}}\n${"\f".repeat((match[0].match(/\f/g) || []).length)}`);
    };
    takeClause("commissionClause", "^[ \\t]*Commission on Large Collections \\( IF NOT NEEDED REMOVE\\)", "^[ \\t]*Independent Contractor Status");
    takeClause("travelClause", "^[ \\t]*Travel Fee \\( remove if not NEEDED\\)", "^[ \\t]*Trust & Responsibility Clause");
    sourceText = sourceText.replace("(INSERT DATE )", "{{agreementDate}}")
      .replace(/HMP Service Fee: \$[\d,.]+/, "HMP Service Fee: {{serviceFee}}")
      .replace(/\b\d+(?:\.\d+)? Service Hours\b/, "{{serviceHours}} Service Hours")
      .replace(/30% Non-Refundable Retainer due by[^\n]*/, "30% Non-Refundable Retainer due by: {{retainerDue}}")
      .replace(/Final Payment due by[^\n]*/, "Final Payment due by: {{finalPaymentDue}}")
      .replace("(INSERT TIME)", "{{serviceEndTime}}")
      .replace(/\[10\/06\/2025\]/g, "{{cancellationDeadline}}")
      .replace("($409.50)", "({{cancellationRefundAmount}})")
      .replace("(The final total will be presented to the Client at the\nconclusion of the service.) ONLY KEEP THIS PART THEY BOOKED GRAND TOTAL\nSERVICE IF NOT REMOVE IT!!!!!", "{{grandTotalClause}}");
  }
  return [id, {
    version:"2026-10-12.1",
    sourceFile:filename,
    sourceSha256:createHash("sha256").update(readFileSync(path)).digest("hex"),
    ...(["money-collecting", "money-collecting-changing"].includes(id) ? {optionalClauses} : {}),
    pages:sourceText.split("\f").map(page => page.replaceAll("\u200b", "").trim()).filter(Boolean),
  }];
}));
writeFileSync("data/agreement-terms.json", JSON.stringify(records, null, 2) + "\n");
