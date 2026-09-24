import { createHash } from "node:crypto";
import { clientConversationUrl, conversationToken, newNonce, tokenHash } from "./_conversation-security.mts";
import { manualInquiryRecord } from "./_manual-inquiry.mts";

const stableId = (value: string) => {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
};

export const documentSnapshot = (kind: "invoice" | "contract", record: Record<string, any>) => {
  const fields = kind === "invoice"
    ? ["client_name", "issue_date", "due_date", "event_name", "event_date", "event_address", "subtotal", "discount_amount", "tax_rate", "tax_amount", "total", "notes", "payment_terms"]
    : ["client_name", "effective_date", "event_name", "event_date", "event_location", "services", "scope_of_work", "total_amount", "retainer_amount", "payment_terms", "cancellation_terms", "additional_terms", "hmp_signature_name", "hmp_signed_at", "client_signature_name", "client_signed_at"];
  return {
    kind, id: record.id, number: record[`${kind}_number`],
    ...Object.fromEntries(fields.map(field => [field, record[field] ?? null])),
    ...(kind === "invoice" ? {items: (record.items || []).map((item: any) => ({description:item.description, quantity:item.quantity, rate:item.rate, amount:item.amount}))} : {}),
  };
};

// Resolve the exact inquiry, never share a private document by matching a name.
export async function prepareDocumentConversation(client: any, kind: "invoice" | "contract", record: any, recipient: string, owner: string) {
  if (recipient !== String(record.client_email).trim().toLowerCase()) {
    throw new Error("Save the client's email on the document before sending it.");
  }
  let inquiryId = record.inquiry_id;
  if (!inquiryId) {
    const {data: matches, error} = await client.from("hmp_admin_inquiries").select("submission_id,celebration_date").eq("email",recipient);
    if (error) throw new Error("Client conversation could not be checked. No email was sent.");
    const matching = (matches || []).filter((row: any) => (row.celebration_date || "") === (record.event_date || ""));
    inquiryId = matching.length === 1 ? matching[0].submission_id : stableId(`document-inquiry/${kind}/${record.id}`);
    if (matching.length !== 1) {
      const row = manualInquiryRecord({id:inquiryId,name:record.client_name,email:recipient,eventDate:record.event_date || "",service:record.services || "Invoice",location:record.event_location || record.event_address},owner);
      const {error: createError} = await client.from("hmp_admin_inquiries").upsert(row,{onConflict:"submission_id",ignoreDuplicates:true});
      if (createError) throw new Error("Client conversation could not be created. No email was sent.");
    }
    const {error: linkError} = await client.from(`hmp_admin_${kind}s`).update({inquiry_id:inquiryId}).eq("id",record.id);
    if (linkError) throw new Error("Document could not be linked to the client. No email was sent.");
  }
  const {data: inquiry, error: inquiryError} = await client.from("hmp_admin_inquiries").select("email").eq("submission_id",inquiryId).maybeSingle();
  if (inquiryError || !inquiry || String(inquiry.email).trim().toLowerCase() !== recipient) {
    throw new Error("The document's linked inquiry belongs to a different client or is unavailable. Correct the inquiry before sending.");
  }
  let {data: conversation, error} = await client.from("hmp_client_conversations").select("*").eq("inquiry_id",inquiryId).maybeSingle();
  if (error) throw new Error("Client conversation could not be checked. No email was sent.");
  if (!conversation) {
    const id = crypto.randomUUID(), nonce = newNonce();
    const {error: createError} = await client.from("hmp_client_conversations").upsert({id,inquiry_id:inquiryId,token_nonce:nonce,access_token_hash:tokenHash(conversationToken(id,nonce)),token_expires_at:new Date(Date.now()+365*86400000).toISOString()},{onConflict:"inquiry_id",ignoreDuplicates:true});
    if (createError) throw new Error("Client conversation could not be created. No email was sent.");
    ({data:conversation,error} = await client.from("hmp_client_conversations").select("*").eq("inquiry_id",inquiryId).maybeSingle());
  }
  if (error || !conversation || conversation.revoked_at || !conversation.token_nonce || !(Date.parse(conversation.token_expires_at)>Date.now())) {
    throw new Error("The client's conversation link is inactive. Use Send new link in Messages, then send the document.");
  }
  return {conversation, clientUrl:clientConversationUrl(conversation.id,conversation.token_nonce)};
}

export async function recordSentDocument(client: any, kind: "invoice" | "contract", record: any, conversation: any, requestId: string, recipient: string, emailId: string | null, owner: string) {
  const {error} = await client.rpc("hmp_record_sent_document", {
    p_kind:kind, p_document_id:record.id, p_conversation_id:conversation.id,
    p_message_id:stableId(`sent-document/${kind}/${record.id}/${requestId}`),
    p_snapshot:documentSnapshot(kind,record), p_recipient:recipient, p_email_id:emailId, p_sender:owner,
  });
  if (error) throw new Error("Email sent, but its conversation copy could not be saved. Retry this send without changing the document.");
}
