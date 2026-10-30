import { test, expect } from "@playwright/test";

async function fillTime(page, name, value) {
  const [hourText, minute] = value.split(":");
  const hour24 = Number(hourText);
  const hour = String(hour24 % 12 || 12).padStart(2, "0");
  const period = hour24 >= 12 ? "PM" : "AM";
  const selects = page.locator(`[name="${name}"] + .time-select-group select`);
  await selects.nth(0).selectOption(hour);
  await selects.nth(1).selectOption(minute);
  await selects.nth(2).selectOption(period);
}

async function fillInquiry(page, suffix) {
  await page.locator('[name="name"]').fill(`Synthetic Client ${suffix}`);
  await page.locator('[name="email"]').fill(`qa-${suffix}@example.test`);
  await page.locator('[name="phone"]').fill("+13015550100");
  await page.locator('[name="service"]').selectOption({ label: "Guest Seating Experience" });
  const notice = page.locator("dialog[open]");
  await expect(notice).toBeVisible();
  await notice.locator(".dialog-confirm").click();
  await page.locator('[name="service-option"]').selectOption({ label: "Guest Arrival" });
  await page.locator('[name="guest-count"]').fill("120");
  await page.locator('[name="parking-fee"]').fill("No");
  await page.locator('[name="celebration-type"]').selectOption("Wedding");
  await page.locator('[name="celebration-date"]').evaluate(input => {
    input.value = "12 / 12 / 2026";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.locator('[name="location"]').fill("Synthetic Venue\n123 Test Lane");
  await fillTime(page, "start-time", "17:00");
  await fillTime(page, "end-time", "22:00");
  await fillTime(page, "vendor-exit-time", "22:30");
}

test("required service schedule validates, submits twice, and keeps second event optional", async ({ page }, testInfo) => {
  const submissions = [];
  await page.route("**/api/hmp-inquiry", async route => {
    submissions.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  await page.goto("/inquiry.html", { waitUntil: "domcontentloaded" });
  await fillInquiry(page, "one");
  const form = page.locator("#inquiry-form");
  expect(await form.evaluate(element => element.checkValidity())).toBe(false);
  await page.getByRole("button", { name: /Request my personalized quote/ }).click();
  expect(submissions).toHaveLength(0);
  expect(await page.locator('[name="service-start-time"] + .time-select-group select').first()
    .evaluate(select => select.validationMessage)).not.toBe("");

  await fillTime(page, "service-start-time", "16:30");
  await fillTime(page, "service-end-time", "22:30");
  await page.locator('[name="total-service-hours"]').fill("6");
  expect(await form.evaluate(element => element.checkValidity())).toBe(true);
  await page.getByRole("button", { name: /Request my personalized quote/ }).click();
  await expect(page.locator("#form-status")).toContainText("inquiry has been received");
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({
    "service-start-time": "16:30",
    "service-end-time": "22:30",
    "total-service-hours": "6",
    "second-service-start-time": "",
    "second-service-end-time": "",
  });

  await fillInquiry(page, "two");
  await fillTime(page, "service-start-time", "18:00");
  await fillTime(page, "service-end-time", "22:00");
  await page.locator('[name="total-service-hours"]').fill("4");
  await page.getByRole("button", { name: /Request my personalized quote/ }).click();
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1]["submission-id"]).not.toBe(submissions[0]["submission-id"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("service-time-inquiry.png"), fullPage: true });
});

test("proposal Service Time Frame is optional and renders only when entered", async ({ page }, testInfo) => {
  await page.goto("/conversation.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const { renderProposalCard } = await import("/proposal-ui.js?service-time-smoke");
    const root = document.createElement("main");
    root.id = "synthetic-proposals";
    root.append(
      renderProposalCard({ clientName: "Synthetic Client", serviceHours: 4, serviceFee: 900 }, { showActions: false }),
      renderProposalCard({ clientName: "Synthetic Client", serviceHours: 6, serviceTimeFrame: "6:30 PM–10:30 PM", serviceFee: 1200 }, { showActions: false }),
    );
    document.body.replaceChildren(root);
  });
  const cards = page.locator(".portal-proposal");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).not.toContainText("Service Time Frame");
  await expect(cards.nth(1)).toContainText("Service Time Frame");
  await expect(cards.nth(1)).toContainText("6:30 PM–10:30 PM");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("proposal-service-time-frame.png"), fullPage: true });
});
