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

const previewUrls = new WeakMap();

const clearPreviewUrls = (container) => {
  (previewUrls.get(container) || []).forEach((url) => URL.revokeObjectURL(url));
  previewUrls.delete(container);
};

export const formatFileSize = (bytes) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

export const selectedFiles = (input) => {
  const files = Array.from(input.files || []);
  if (files.length > MAX_FILES) throw new Error("Attach up to 4 files at a time.");
  if (files.some((file) => file.size > MAX_FILE_BYTES)) throw new Error("Each attachment must be 25 MB or smaller.");
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) throw new Error("Attachments must total 50 MB or less.");
  if (files.some((file) => !allowedType((file.type || "").toLowerCase()))) throw new Error("One of these file types is not supported.");
  return files;
};

export const updateAttachmentSummary = (input, summary) => {
  try {
    const files = selectedFiles(input);
    summary.textContent = files.length
      ? `${files.length} file${files.length === 1 ? "" : "s"} ready · ${formatFileSize(files.reduce((sum, file) => sum + file.size, 0))}`
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

  let files;
  try {
    files = selectedFiles(input);
  } catch {
    updateAttachmentSummary(input, summary);
    container.hidden = true;
    return;
  }

  if (!files.length) {
    container.hidden = true;
    return;
  }

  const urls = [];
  files.forEach((file, index) => {
    const card = document.createElement("article");
    card.className = "attachment-preview";

    if (file.type.startsWith("video/")) {
      const video = document.createElement("video");
      const url = URL.createObjectURL(file);
      urls.push(url);
      video.src = url;
      video.controls = true;
      video.preload = "metadata";
      video.setAttribute("playsinline", "");
      video.setAttribute("aria-label", `Preview ${file.name}`);
      card.append(video);
    } else if (file.type.startsWith("image/")) {
      const image = document.createElement("img");
      const url = URL.createObjectURL(file);
      urls.push(url);
      image.src = url;
      image.alt = `Preview of ${file.name}`;
      card.append(image);
    } else {
      const icon = document.createElement("span");
      icon.className = "attachment-preview__icon";
      icon.textContent = "File";
      card.append(icon);
    }

    const details = document.createElement("div");
    details.className = "attachment-preview__details";
    const name = document.createElement("strong");
    name.textContent = file.name;
    const size = document.createElement("span");
    size.textContent = formatFileSize(file.size);
    details.append(name, size);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-preview__remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.addEventListener("click", () => {
      const transfer = new DataTransfer();
      files.forEach((candidate, candidateIndex) => {
        if (candidateIndex !== index) transfer.items.add(candidate);
      });
      input.files = transfer.files;
      updateAttachmentSummary(input, summary);
      renderAttachmentPreviews(input, container, summary);
    });

    card.append(details, remove);
    container.append(card);
  });

  previewUrls.set(container, urls);
  container.hidden = false;
};

export const uploadAttachments = async ({ files, messageId, prepare }) => {
  const attachments = [];
  for (const file of files) {
    const prepared = await prepare({
      action: "prepare-upload",
      messageId,
      name: file.name,
      type: file.type.toLowerCase(),
      size: file.size,
    });
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);
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
