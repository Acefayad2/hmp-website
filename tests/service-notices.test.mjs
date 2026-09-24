import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("inquiry selectors show the money table minimum without changing submitted values", () => {
  const html = readFileSync(new URL("../inquiry.html", import.meta.url), "utf8");
  assert.match(html, /<option value="Money Table Services">Money Table Services — 4-hour minimum<\/option>/);
  const source = readFileSync(new URL("../script.js", import.meta.url), "utf8");
  const code = source.match(/const inquiryServiceOptions = \{[\s\S]*?\n\};/)[0];
  const config = runInNewContext(`${code}\ninquiryServiceOptions`);
  assert.equal(config["Money Table Services"].label, "Money table service of interest — 4-hour minimum");
  assert.deepEqual(Array.from(config["Money Table Services"].options), ["Changing + Collecting", "Money Changing", "Money Collecting"]);
});

test("money table pricing introduction states the four-hour minimum", () => {
  const html = readFileSync(new URL("../money-table.html", import.meta.url), "utf8");
  const introduction = html.match(/<div class="price-header">[\s\S]*?<div class="price-grid">/)?.[0];
  assert.ok(introduction);
  assert.match(introduction, /complete support\. A minimum of 4 hours of service is required\./);
});

test("money table notice states the four-hour minimum and has accessible controls", () => {
  const html = readFileSync(new URL("../inquiry.html", import.meta.url), "utf8");
  const notice = html.match(/<dialog id="money-table-dialog"[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(notice);
  assert.match(notice, /minimum of 4 hours of service/);
  assert.match(notice, /aria-labelledby="money-table-notice-title"/);
  assert.match(notice, /dialog-close/);
  assert.match(notice, /Yes, continue my inquiry/);
});

test("each service notice is acknowledged independently and never opens twice", () => {
  const source = readFileSync(new URL("../script.js", import.meta.url), "utf8");
  const code = source.match(/const showServiceNotice = \(\) => \{[\s\S]*?\n\};/)[0];
  const makeNotice = () => ({ acknowledged: false, dialog: { open: false, count: 0, showModal() { this.open = true; this.count++; } } });
  const money = makeNotice();
  const seating = makeNotice();
  const select = { value: "Money Table Services" };
  const show = runInNewContext(`${code}\nshowServiceNotice`, {
    serviceNotices: { "Money Table Services": money, "Guest Seating Experience": seating }, serviceSelect: select,
  });
  assert.equal(show(), true);
  assert.equal(show(), true);
  assert.equal(money.dialog.count, 1);
  money.acknowledged = true;
  money.dialog.open = false;
  assert.equal(show(), false);
  select.value = "Guest Seating Experience";
  assert.equal(show(), true);
  select.value = "Event Accessories";
  assert.equal(show(), false);
});
