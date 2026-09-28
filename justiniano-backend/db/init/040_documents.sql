-- 040_documents.sql — Documentos generados (§3, §11).
-- Requiere 010 (users), 020 (document_formats) y 030 (consultations).

CREATE TABLE documents (
    id                    text         PRIMARY KEY,
    user_id               text         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    format_id             text         NOT NULL REFERENCES document_formats(id) ON DELETE RESTRICT,
    consultation_id       text         REFERENCES consultations(id) ON DELETE SET NULL,
    name                  varchar(200) NOT NULL,
    status                varchar(10)  NOT NULL DEFAULT 'draft',
    fields                jsonb        NOT NULL DEFAULT '{}'::jsonb,
    content_html          text,
    missing_fields        jsonb,
    disclaimer_removed    boolean      NOT NULL DEFAULT false,
    disclaimer_removed_at timestamptz,
    created_at            timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT documents_status_chk CHECK (status IN ('draft', 'pending', 'review', 'ready'))
);

-- Índices
CREATE INDEX idx_documents_user_created  ON documents (user_id, created_at DESC);
CREATE INDEX idx_documents_user_status   ON documents (user_id, status);
CREATE INDEX idx_documents_format_id     ON documents (format_id);
CREATE INDEX idx_documents_consultation  ON documents (consultation_id);
