const MAX_FILES = 4;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/ogg",
  "video/x-msvideo",
  "video/mpeg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

const allowedType = (type) =>
  allowedTypes.has(type);

// Some mobile file pickers omit the MIME type. Only infer known supported types.
const extensionTypes = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", heic: "image/heic", heif: "image/heif", avif: "image/avif",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", ogv: "video/ogg",
  avi: "video/x-msvideo", mpeg: "video/mpeg", mpg: "video/mpeg",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv",
};
export const attachmentType = (file) => (file.type || "").toLowerCase()
  || extensionTypes[file.name.split(".").pop().toLowerCase()] || "";

const previewUrls = new WeakMap();
// Files stay on this device until the composer explicitly calls uploadAttachments.
// Keep a separate queue so opening the picker again adds files instead of replacing them.
const attachmentDrafts = new WeakMap();
export const pendingFiles = input => [...(attachmentDrafts.get(input) || Array.from(input.files || []))];
export const stageAttachments = input => {
  if (input.disabled) return;
  const files = [...(attachmentDrafts.get(input) || [])];
  for (const file of Array.from(input.files || [])) {
    if (!files.some(existing => existing.name === file.name && existing.size === file.size
      && existing.lastModified === file.lastModified && existing.type === file.type)) files.push(file);
  }
  attachmentDrafts.set(input, files);
  input.value = "";
};
export const clearStagedAttachments = input => {
  attachmentDrafts.set(input, []);
  input.value = "";
};
export const removeStagedAttachment = (input, index) => {
  if (input.disabled) return;
  attachmentDrafts.set(input, pendingFiles(input).filter((_, candidateIndex) => candidateIndex !== index));
  input.value = "";
};

const clearPreviewUrls = (container) => {
  (previewUrls.get(container) || []).forEach((url) => URL.revokeObjectURL(url));
  previewUrls.delete(container);
};

export const formatFileSize = (bytes) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

export const selectedFiles = (input) => {
  const files = pendingFiles(input);
  if (files.length > MAX_FILES) throw new Error("Attach up to 4 files at a time.");
  if (files.some((file) => file.size > MAX_FILE_BYTES)) throw new Error("Each attachment must be 25 MB or smaller.");
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) throw new Error("Attachments must total 50 MB or less.");
  if (files.some((file) => !allowedType(attachmentType(file)))) throw new Error("One of these file types is not supported. Remove it using its X button.");
  return files;
};

export const updateAttachmentSummary = (input, summary) => {
  try {
    const files = selectedFiles(input);
    summary.textContent = files.length
      ? `${files.length} file${files.length === 1 ? "" : "s"} ready · ${formatFileSize(files.reduce((sum, file) => sum + file.size, 0))} · Not uploaded yet. Click Send when ready.`
      : "Up to 4 files · 25 MB each";
    summary.classList.remove("error");
  } catch (error) {
    summary.textContent = error.message;
    summary.classList.add("error");
  }
};

export const renderAttachmentPreviews = (input, container, summary) => {
  clearPreviewUrls(container);
  container.replaceChildren();

  // Invalid selections must remain visible so individual files can be removed.
  const files = pendingFiles(input);
  updateAttachmentSummary(input, summary);

  if (!files.length) {
    container.hidden = true;
    return;
  }

  const urls = [];
  files.forEach((file, index) => {
    const card = document.createElement("article");
    card.className = "attachment-preview";
    const type = attachmentType(file);
    const supported = allowedType(type);
    const fallback = document.createElement("span");
    fallback.className = "attachment-preview__icon";
    fallback.textContent = supported ? "Preview unavailable in this browser. You can still open or remove this file." : "Unsupported file — please remove";
    const url = supported ? URL.createObjectURL(new Blob([file], { type })) : "";
    if (url) urls.push(url);

    if (!supported) {
      card.append(fallback);
    } else if (type.startsWith("video/") || type.startsWith("audio/")) {
      const video = document.createElement(type.startsWith("video/") ? "video" : "audio");
      video.src = url;
      video.controls = true;
      video.preload = "metadata";
      video.setAttribute("playsinline", "");
      video.setAttribute("aria-label", `Preview ${file.name}`);
      video.addEventListener("error", () => video.replaceWith(fallback), { once: true });
      card.append(video);
    } else if (type.startsWith("image/")) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = `Preview of ${file.name}`;
      image.addEventListener("error", () => image.replaceWith(fallback), { once: true });
      card.append(image);
    } else if (type === "application/pdf") {
      const preview = document.createElement("iframe");
      preview.src = url;
      preview.title = `Preview of ${file.name}`;
      card.append(preview);
    } else {
      if (supported) fallback.textContent = "Document · Open to review";
      card.append(fallback);
    }

    const details = document.createElement("div");
    details.className = "attachment-preview__details";
    const name = document.createElement("strong");
    name.textContent = file.name;
    const size = document.createElement("span");
    size.textContent = formatFileSize(file.size);
    details.append(name, size);
    if (url) {
      const open = document.createElement("a");
      open.href = url;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.textContent = "Open file preview";
      open.setAttribute("aria-label", `Open preview of ${file.name}`);
      details.append(open);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-preview__remove";
    remove.textContent = "×";
    remove.title = `Remove ${file.name}`;
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.addEventListener("click", () => {
      if (input.disabled) return;
      removeStagedAttachment(input, index);
      updateAttachmentSummary(input, summary);
      renderAttachmentPreviews(input, container, summary);
    });

    card.append(details, remove);
    container.append(card);
  });

  previewUrls.set(container, urls);
  container.hidden = false;
};

export const setAttachmentBusy = (input, container, busy) => {
  input.disabled = busy;
  container.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
};

export const uploadAttachments = async ({ files, messageId, prepare }) => {
  const attachments = [];
  for (const file of files) {
    const prepared = await prepare({
      action: "prepare-upload",
      messageId,
      name: file.name,
      type: attachmentType(file),
      size: file.size,
    });
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", new Blob([file], { type: attachmentType(file) }), file.name);
    const upload = await fetch(prepared.signedUrl, {
      method: "PUT",
      headers: { "x-upsert": "false" },
      body: form,
    });
    if (!upload.ok) throw new Error(`${file.name} could not be uploaded.`);
    attachments.push(prepared.attachment);
  }
  return attachments;
};

export const appendAttachments = (article, attachments = []) => {
  if (!attachments.length) return;
  const gallery = document.createElement("div");
  gallery.className = "message-attachments";
  attachments.forEach((attachment) => {
    if (!attachment.url) return;
    const type = attachment.type || "";
    if (type.startsWith("image/")) {
      const link = document.createElement("a");
      link.href = attachment.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.ariaLabel = `Open ${attachment.name}`;
      const image = document.createElement("img");
      image.src = attachment.url;
      image.alt = attachment.name;
      image.loading = "lazy";
      link.append(image);
      gallery.append(link);
      return;
    }
    if (type.startsWith("video/")) {
      const video = document.createElement("video");
      video.src = attachment.url;
      video.controls = true;
      video.preload = "metadata";
      video.setAttribute("playsinline", "");
      gallery.append(video);
      return;
    }
    if (type.startsWith("audio/")) {
      const audio = document.createElement("audio");
      audio.src = attachment.url;
      audio.controls = true;
      audio.preload = "metadata";
      gallery.append(audio);
      return;
    }
    const link = document.createElement("a");
    link.className = "file-attachment";
    link.href = attachment.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const title = document.createElement("strong");
    title.textContent = attachment.name;
    const size = document.createElement("span");
    size.textContent = `${formatFileSize(attachment.size || 0)} · Open file`;
    link.append(title, size);
    gallery.append(link);
  });
  if (gallery.childElementCount) article.append(gallery);
};
