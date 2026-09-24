// One-time source import. No legal language is rewritten except the approved revision count.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const sources = [
  ["guest-seating", "/Users/ace/Library/Messages/Attachments/03/03/E1EF2E12-8744-468A-8C95-115534500DA0/GUEST SEATING EXPERIENCE SERVICES AGREEMENT.pdf"],
  ["accessories", "/Users/ace/Library/Messages/Attachments/76/06/2D1BF900-3F94-4A6C-BDA1-42A3B545C1F6/CELEBRATION ACCESSORIES RENTAL AGREEMENT.pdf"],
  ["welcome-sign", "/Users/ace/Library/Messages/Attachments/88/08/17BAA769-776D-47B5-A895-072DD860BC36/WELCOME SIGN SERVICES AGREEMENT.pdf"],
  ["led-customization", "/Users/ace/Library/Messages/Attachments/65/05/BF81FDA1-CAA6-4631-A484-E71D46036E94/LED SIGNAGE CUSTOMIZATION & APPROVAL AGREEMENT.pdf"],
];
mkdirSync("data", {recursive:true});
const records = Object.fromEntries(sources.map(([id, path]) => {
  let text = execFileSync("pdftotext", ["-layout", path, "-"], {encoding:"utf8"});
  if (id === "led-customization") text = text.replaceAll("six (6)", "four (4)").replaceAll("six\n(6)", "four\n(4)");
  return [id, {version:"2026-09-23.1", sourceFile:path.split("/").pop(), sourceSha256:createHash("sha256").update(readFileSync(path)).digest("hex"), pages:text.split("\f").map(p => p.replaceAll("\u200b", "").trim()).filter(Boolean)}];
}));
writeFileSync("data/agreement-terms.json", JSON.stringify(records, null, 2) + "\n");
