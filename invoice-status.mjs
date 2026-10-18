export const invoiceStatuses = ["Draft", "Sent", "Partially paid", "Paid", "Void"];
export const invoiceStatusLabel = status => status === "Paid" ? "Paid in full" : status;
export const receiptableStatuses = ["Sent", "Partially paid", "Paid"];
