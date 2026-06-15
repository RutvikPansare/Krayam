/** Feature 11 — spec-sheet attachment metadata. */

export interface AttachmentFileMeta {
  file_name: string;
  size_bytes: number;
  content_type: string;
}

export interface Attachment extends AttachmentFileMeta {
  id: string;
  org_id: string;
  pr_id: string | null;
  storage_path: string;        // org/PR-prefixed key in the private bucket
  uploaded_by: string | null;
  checksum_verified: boolean;
  deleted_at: string | null;   // soft delete — file remains in storage
  created_at: string;
}

/** A time-limited signed download URL handed to vendors. */
export interface SignedAttachment extends AttachmentFileMeta {
  id: string;
  signed_url: string;
  /** ISO timestamp when the signed URL expires */
  expires_at: string;
}

/** Presigned direct-to-storage upload grant (browser uploads, not the API). */
export interface UploadGrant {
  id: string;          // staging attachment id
  storage_path: string;
  token: string;       // for supabase uploadToSignedUrl
  signed_url: string;
}
