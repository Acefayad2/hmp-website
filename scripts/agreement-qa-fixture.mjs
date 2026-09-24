// Generates synthetic, local-only browser fixtures. Never copied by the production build.
import { writeFileSync } from "node:fs";
import { agreementTemplates } from "../agreement-schema.mjs";
import { snapshotFor, signingConsent } from "../netlify/functions/_agreement-forms.mts";
const values = fields => Object.fromEntries(fields.map(f => [f.id, f.options?.[0] || ({date:"2026-12-01", time:"17:00", "datetime-local":"2026-12-01T17:00", money:"100", number:"2", email:"client@example.test"}[f.type] || (f.type === "textarea" ? "Example package\nSetup and event support" : "Test Client"))]));
writeFileSync("dist/__agreement-fixtures.json", JSON.stringify({signingConsent, forms:agreementTemplates.map(t=> {
  const snapshot=snapshotFor(t.id);
  return {id:crypto.randomUUID(), snapshot, clientName:"Test Client", clientEmail:"client@example.test", status:"Sent", adminAnswers:values(t.adminFields), clientAnswers:values(t.clientFields), updatedAt:new Date().toISOString()};
})}));
