export const inquiryDetailFields = [
  ["Received", "receivedAt", true],
  ["Status", "status"],
  ["Priority", "priority"],
  ["Client email", "email"],
  ["Client phone", "phone"],
  ["Preferred contact", "contactMethod"],
  ["Service", "service"],
  ["Specific service of interest", "serviceOption"],
  ["Services requested", "multipleServicesDetail"],
  ["Other service requested", "otherServiceDetail"],
  ["Event type", "celebrationType"],
  ["First event date", "celebrationDate"],
  ["First event location / address", "location"],
  ["First event guest count", "guestCount"],
  ["First event start time", "startTime"],
  ["First event end time", "endTime"],
  ["First event vendor exit time", "vendorExitTime"],
  ["Second event date", "secondDate"],
  ["Second event location / address", "secondLocation"],
  ["Second event guest count", "secondGuestCount"],
  ["Second event start time", "secondStartTime"],
  ["Second event end time", "secondEndTime"],
  ["Second event vendor exit time", "secondVendorExitTime"],
  ["Parking fee", "parkingFee"],
  ["Referral source", "referralSource"],
  ["Referral detail", "sourceDetail"],
  ["Follow-up date", "followUpDate"],
  ["Owner", "owner"],
  ["Source", "source"],
  ["Submission ID", "id"],
];

export function inquiryDetailsHTML(item, {formatDate, escapeHTML}) {
  return inquiryDetailFields
    .filter(([, key]) => item[key] !== "" && item[key] !== null && item[key] !== undefined)
    .map(([label, key, includeTime]) => {
      const value = key.toLowerCase().includes("date") || key === "receivedAt"
        ? formatDate(item[key], includeTime) : item[key];
      return `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`;
    }).join("");
}
