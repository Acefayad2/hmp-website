import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {hmpSender, hmpReplyTo, hmpAlertRecipient} from "../netlify/functions/_email-contact.mts";
import {sendReplyNotification} from "../netlify/functions/hmp-messages.mts";

test("shared correspondence mailbox overrides old mail settings, not Admin login", async () => {
  const settings = {HMP_COMMUNICATION_EMAIL:"eventsconcierge@hmpeds.com", HMP_INVOICE_FROM_EMAIL:"old@example.test", HMP_INQUIRY_FROM_EMAIL:"old@example.test", HMP_INVOICE_REPLY_TO:"old@example.test", HMP_CONTRACT_REPLY_TO:"old@example.test", HMP_INQUIRY_ADMIN_EMAIL:"old@example.test", HMP_ADMIN_EMAILS:"admin@example.test", RESEND_API_KEY:"test-only", SUPABASE_SERVICE_ROLE_KEY:"test-only"};
  globalThis.Netlify = {env:{get:key=>settings[key]}};
  for(const kind of ["inquiry","invoice","contract"]) assert.equal(hmpSender(kind), "HMP Event Concierge <eventsconcierge@hmpeds.com>");
  assert.equal(hmpReplyTo(), settings.HMP_COMMUNICATION_EMAIL);
  assert.equal(hmpAlertRecipient(), settings.HMP_COMMUNICATION_EMAIL);
  let mail;
  const result = await sendReplyNotification({email:"client@example.test",client_name:"Test"}, {id:"11111111-1111-4111-8111-111111111111",token_nonce:"test",token_expires_at:"2099-01-01T00:00:00Z"}, "test-message", false, async (url,options)=>{
    assert.equal(url,"https://api.resend.com/emails"); mail=JSON.parse(options.body);return Response.json({id:"test"});
  });
  assert.equal(result,true);
  assert.equal(mail.from,hmpSender());
  assert.equal(mail.reply_to,settings.HMP_COMMUNICATION_EMAIL);
  assert.deepEqual(mail.to,["client@example.test"]);
  assert.equal(settings.HMP_ADMIN_EMAILS,"admin@example.test");
});

test("legacy deployments keep working before the new mailbox is activated", () => {
  const settings={HMP_INVOICE_FROM_EMAIL:"invoices@example.test",HMP_CONTRACT_FROM_EMAIL:"contracts@example.test",HMP_INQUIRY_FROM_EMAIL:"inquiries@example.test",HMP_INQUIRY_ADMIN_EMAIL:"team@example.test"};
  globalThis.Netlify={env:{get:key=>settings[key]}};
  assert.equal(hmpSender("invoice"),settings.HMP_INVOICE_FROM_EMAIL);
  assert.equal(hmpSender("contract"),settings.HMP_CONTRACT_FROM_EMAIL);
  assert.equal(hmpSender(),settings.HMP_INQUIRY_FROM_EMAIL);
  assert.equal(hmpAlertRecipient(),settings.HMP_INQUIRY_ADMIN_EMAIL);
  assert.equal(hmpReplyTo(),"info@hmpeds.com");
});

test("all client email handlers use shared contact settings", () => {
  for(const name of ["hmp-inquiry","hmp-messages","hmp-send-invoice","hmp-send-contract","hmp-agreement-forms","hmp-review-requests"]) {
    const source=readFileSync(new URL(`../netlify/functions/${name}.mts`,import.meta.url),"utf8");
    assert.match(source,/hmpSender\(/,name);
    assert.match(source,/hmpReplyTo\(/,name);
    assert.doesNotMatch(source,/reply_to:\s*"info@hmpeds.com"/,name);
  }
});
