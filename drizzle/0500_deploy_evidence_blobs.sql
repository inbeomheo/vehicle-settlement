CREATE TABLE "evidence_blobs" (
  "storage_key" text PRIMARY KEY,
  "bytes" bytea NOT NULL,
  "size" integer NOT NULL,
  "sha256" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "evidence_blobs_size_check" CHECK ("size" >= 0 AND octet_length("bytes") = "size"),
  CONSTRAINT "evidence_blobs_hash_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$')
);
