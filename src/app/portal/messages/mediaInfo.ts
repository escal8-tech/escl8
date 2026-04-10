function asMetaRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function readMediaInfo(message: {
  messageType: string | null;
  textBody: string | null;
  meta: unknown;
}) {
  const meta = asMetaRecord(message.meta);
  const nestedMedia = asMetaRecord(meta.message_media);
  const explicitType = String(message.messageType || "").trim().toLowerCase();
  const nestedType = typeof nestedMedia.mediaType === "string" ? nestedMedia.mediaType.trim().toLowerCase() : "";
  const imageUrl =
    (typeof meta.imageUrl === "string" && meta.imageUrl.trim() ? meta.imageUrl : null) ||
    (nestedType === "image" && typeof nestedMedia.mediaUrl === "string" && nestedMedia.mediaUrl.trim()
      ? nestedMedia.mediaUrl
      : null);
  const documentUrl =
    (typeof meta.documentUrl === "string" && meta.documentUrl.trim() ? meta.documentUrl : null) ||
    (nestedType === "document" && typeof nestedMedia.mediaUrl === "string" && nestedMedia.mediaUrl.trim()
      ? nestedMedia.mediaUrl
      : null);
  const messageType = explicitType || (imageUrl ? "image" : documentUrl ? "document" : nestedType || "text");
  const caption =
    (typeof meta.caption === "string" && meta.caption.trim() ? meta.caption : null) ||
    (typeof nestedMedia.caption === "string" && nestedMedia.caption.trim() ? nestedMedia.caption : null) ||
    message.textBody;
  const filename =
    (typeof meta.filename === "string" && meta.filename.trim() ? meta.filename : null) ||
    (typeof nestedMedia.fileName === "string" && nestedMedia.fileName.trim() ? nestedMedia.fileName : null);
  return { messageType, imageUrl, documentUrl, caption, filename };
}
