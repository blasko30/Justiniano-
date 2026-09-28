-- 030_consultations.sql — Consultas IA, mensajes y adjuntos (§3, §9, §10).
-- Requiere 010 (users) y 020 (agents).

CREATE TABLE consultations (
    id                text         PRIMARY KEY,
    user_id           text         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id          text         NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    title             varchar(200) NOT NULL,
    interactions_used integer      NOT NULL DEFAULT 0,
    created_at        timestamptz  NOT NULL DEFAULT now(),
    last_message_at   timestamptz,
    CONSTRAINT consultations_interactions_chk CHECK (interactions_used >= 0)
);

CREATE TABLE messages (
    id                  text        PRIMARY KEY,
    consultation_id     text        NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
    role                varchar(10) NOT NULL,
    content             text        NOT NULL,
    legal_basis         jsonb,
    suggestions         jsonb,
    suggested_format_id text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT messages_role_chk CHECK (role IN ('user', 'assistant'))
);

CREATE TABLE attachments (
    id           text         PRIMARY KEY,
    user_id      text         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id   text         REFERENCES messages(id) ON DELETE SET NULL,
    blob_path    text         NOT NULL,
    name         varchar(255) NOT NULL,
    size_bytes   bigint       NOT NULL,
    content_type varchar(100) NOT NULL,
    sensitive    boolean      NOT NULL DEFAULT false,
    purge_at     timestamptz,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT attachments_size_chk CHECK (size_bytes >= 0)
);

-- Índices
CREATE INDEX idx_consultations_user_last   ON consultations (user_id, last_message_at DESC);
CREATE INDEX idx_consultations_agent_id    ON consultations (agent_id);
CREATE INDEX idx_messages_consultation     ON messages (consultation_id, created_at);
CREATE INDEX idx_attachments_user_id       ON attachments (user_id);
CREATE INDEX idx_attachments_message_id    ON attachments (message_id);
CREATE INDEX idx_attachments_purge_at      ON attachments (purge_at)
    WHERE purge_at IS NOT NULL;   -- job de purga del plan Free (§4.3)
