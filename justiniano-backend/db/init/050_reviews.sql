-- 050_reviews.sql — Abogados revisores y máquina de revisión (§3, §12, §20, §21).
-- Requiere 010 (users), 030 (messages) y 040 (documents).

CREATE TABLE lawyers (
    id                      text         PRIMARY KEY,
    user_id                 text         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name                    varchar(120) NOT NULL,
    rut                     varchar(12)  NOT NULL UNIQUE,
    bar                     varchar(80)  NOT NULL DEFAULT 'Colegio de Abogados de Chile',
    birth_date              date         NOT NULL,
    university              varchar(120),
    degree_year             integer,
    id_document_blob        text,
    degree_certificate_blob text,
    verification_status     varchar(10)  NOT NULL DEFAULT 'pending',
    rejection_reason        text,
    verified_at             timestamptz,
    verified_by             text         REFERENCES users(id) ON DELETE SET NULL,
    specialties             text[]       NOT NULL DEFAULT '{}',
    specialties_pending     text[]       NOT NULL DEFAULT '{}',
    rating                  double precision,
    ratings_count           integer      NOT NULL DEFAULT 0,
    sla_hours               integer      NOT NULL DEFAULT 48,
    accepts_urgent          boolean      NOT NULL DEFAULT true,
    available               boolean      NOT NULL DEFAULT true,   -- preferencia del abogado (§20.4)
    paused                  boolean      NOT NULL DEFAULT false,  -- decisión del admin (§21.10)
    max_concurrent_cases    integer      NOT NULL DEFAULT 5,
    suspended_at            timestamptz,
    suspension_reason       text,
    promoter                boolean      NOT NULL DEFAULT false,
    active                  boolean      NOT NULL DEFAULT true,
    availability            varchar(10),
    created_at              timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT lawyers_verification_status_chk CHECK (verification_status IN ('pending', 'verified', 'rejected')),
    CONSTRAINT lawyers_availability_chk        CHECK (availability IS NULL OR availability IN ('lt_5h', '5_15h', 'gt_15h')),
    CONSTRAINT lawyers_max_cases_chk           CHECK (max_concurrent_cases >= 1)
);

CREATE TABLE reviews (
    id                      text        PRIMARY KEY,
    user_id                 text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type             varchar(10) NOT NULL,
    document_id             text        REFERENCES documents(id) ON DELETE SET NULL,
    message_id              text        REFERENCES messages(id) ON DELETE SET NULL,
    urgency                 varchar(5)  NOT NULL,
    assignment_mode         varchar(10) NOT NULL,
    source                  varchar(10) NOT NULL DEFAULT 'direct',
    area                    varchar(10),
    lawyer_id               text        REFERENCES lawyers(id) ON DELETE SET NULL,
    assigned_by             text        REFERENCES users(id) ON DELETE SET NULL,
    state                   integer     NOT NULL DEFAULT 1,
    assigned_at             timestamptz,
    accepted_at             timestamptz,
    sla_due_at              timestamptz,
    rejected_reason         text,
    draft                   text,
    notes                   text,        -- nota del cliente
    observations            text,        -- compat cliente (=final)
    final_observations      text,
    response_text           text,        -- consultas
    declaration_accepted_at timestamptz,
    delivered_at            timestamptz,
    late                    boolean     NOT NULL DEFAULT false,
    fee_amount_clp          integer,
    cost_credits            integer     NOT NULL DEFAULT 0,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT reviews_target_type_chk     CHECK (target_type IN ('document', 'message')),
    CONSTRAINT reviews_urgency_chk         CHECK (urgency IN ('std', 'fast')),
    CONSTRAINT reviews_assignment_mode_chk CHECK (assignment_mode IN ('auto', 'frequent', 'pick')),
    CONSTRAINT reviews_source_chk          CHECK (source IN ('direct', 'pool', 'admin')),
    CONSTRAINT reviews_state_chk           CHECK (state BETWEEN 1 AND 4),
    CONSTRAINT reviews_cost_credits_chk    CHECK (cost_credits >= 0)
);

CREATE TABLE review_state_history (
    id            text        PRIMARY KEY,
    review_id     text        NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    state         integer     NOT NULL,
    actor_role    varchar(10) NOT NULL DEFAULT 'system',
    actor_user_id text        REFERENCES users(id) ON DELETE SET NULL,
    reason        text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT review_state_history_state_chk CHECK (state BETWEEN 1 AND 4),
    CONSTRAINT review_state_history_actor_chk CHECK (actor_role IN ('system', 'lawyer', 'admin'))
);

CREATE TABLE review_annotations (
    id                text        PRIMARY KEY,
    review_id         text        NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    lawyer_id         text        NOT NULL REFERENCES lawyers(id) ON DELETE CASCADE,
    paragraph_index   integer     NOT NULL,
    kind              varchar(10) NOT NULL,
    comment_text      text,
    original_text     text,
    proposed_text     text,
    client_resolution varchar(10) NOT NULL DEFAULT 'pending',
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz,
    CONSTRAINT review_annotations_paragraph_chk  CHECK (paragraph_index >= 0),
    CONSTRAINT review_annotations_kind_chk       CHECK (kind IN ('comment', 'change', 'highlight')),
    CONSTRAINT review_annotations_resolution_chk CHECK (client_resolution IN ('pending', 'accepted', 'rejected'))
);

CREATE TABLE review_messages (
    id             text        PRIMARY KEY,
    review_id      text        NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    sender_role    varchar(10) NOT NULL,
    sender_user_id text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content        text        NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    read_at        timestamptz,
    CONSTRAINT review_messages_sender_role_chk CHECK (sender_role IN ('client', 'lawyer'))
);

CREATE TABLE history_access_log (
    id          text        PRIMARY KEY,
    lawyer_id   text        NOT NULL REFERENCES lawyers(id) ON DELETE CASCADE,
    review_id   text        NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    document_id text        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    viewed_at   timestamptz NOT NULL DEFAULT now(),
    ip          varchar(45)
);

-- Índices
CREATE INDEX idx_lawyers_verification_status ON lawyers (verification_status);
CREATE INDEX idx_lawyers_verified_by         ON lawyers (verified_by);
CREATE INDEX idx_reviews_user_created        ON reviews (user_id, created_at DESC);
CREATE INDEX idx_reviews_state_lawyer        ON reviews (state, lawyer_id);
CREATE INDEX idx_reviews_lawyer_id           ON reviews (lawyer_id);
CREATE INDEX idx_reviews_document_id         ON reviews (document_id);
CREATE INDEX idx_reviews_message_id          ON reviews (message_id);
CREATE INDEX idx_reviews_pool                ON reviews (urgency, area, created_at)
    WHERE state = 1 AND lawyer_id IS NULL;   -- bolsa de requerimientos (§20.10)
CREATE INDEX idx_reviews_sla_due             ON reviews (sla_due_at)
    WHERE state IN (2, 3);                   -- vigilancia de SLA en curso
CREATE INDEX idx_review_state_history_review ON review_state_history (review_id, created_at);
CREATE INDEX idx_review_annotations_review   ON review_annotations (review_id, paragraph_index);
CREATE INDEX idx_review_annotations_lawyer   ON review_annotations (lawyer_id);
CREATE INDEX idx_review_messages_review      ON review_messages (review_id, created_at);
CREATE INDEX idx_review_messages_sender      ON review_messages (sender_user_id);
CREATE INDEX idx_history_access_log_lawyer   ON history_access_log (lawyer_id, viewed_at DESC);
CREATE INDEX idx_history_access_log_review   ON history_access_log (review_id);
CREATE INDEX idx_history_access_log_document ON history_access_log (document_id);
