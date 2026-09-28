-- 080_lawyer_fees.sql — Tarifario, liquidaciones y honorarios devengados (§3, §20.21-§20.24, §21.3-§21.4).
-- Requiere 010 (users) y 050 (lawyers, reviews).
-- Orden interno: lawyer_fee_rates y lawyer_settlements antes que lawyer_fee_entries
-- (rate_version_id y settlement_id las referencian).

CREATE TABLE lawyer_fee_rates (
    id                      text        PRIMARY KEY,
    version                 integer     NOT NULL UNIQUE,
    review_std_clp          integer     NOT NULL,
    review_urgent_clp       integer     NOT NULL,
    consultation_std_clp    integer     NOT NULL,
    consultation_urgent_clp integer     NOT NULL,
    sla_bonus_pct           integer     NOT NULL DEFAULT 5,
    effective_from          date        NOT NULL,
    created_by              text        REFERENCES users(id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT lawyer_fee_rates_review_chk       CHECK (review_std_clp > 0 AND review_urgent_clp >= review_std_clp),
    CONSTRAINT lawyer_fee_rates_consultation_chk CHECK (consultation_std_clp > 0 AND consultation_urgent_clp >= consultation_std_clp),
    CONSTRAINT lawyer_fee_rates_bonus_chk        CHECK (sla_bonus_pct BETWEEN 0 AND 50)
);

CREATE TABLE lawyer_settlements (
    id                  text        PRIMARY KEY,
    lawyer_id           text        NOT NULL REFERENCES lawyers(id) ON DELETE RESTRICT,
    period              varchar(7)  NOT NULL,   -- YYYY-MM
    reviews_count       integer     NOT NULL DEFAULT 0,
    consultations_count integer     NOT NULL DEFAULT 0,
    sla_bonus_pct       integer     NOT NULL DEFAULT 0,
    total_clp           integer     NOT NULL DEFAULT 0,
    status              varchar(12) NOT NULL DEFAULT 'open',
    paid_at             timestamptz,
    receipt_blob        text,
    CONSTRAINT lawyer_settlements_lawyer_period_uq UNIQUE (lawyer_id, period),
    CONSTRAINT lawyer_settlements_status_chk CHECK (status IN ('open', 'processing', 'paid'))
);

CREATE TABLE lawyer_fee_entries (
    id              text        PRIMARY KEY,
    lawyer_id       text        NOT NULL REFERENCES lawyers(id) ON DELETE RESTRICT,
    review_id       text        NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE RESTRICT,
    kind            varchar(15) NOT NULL,
    urgency         varchar(5)  NOT NULL,
    amount_clp      integer     NOT NULL,
    rate_version_id text        REFERENCES lawyer_fee_rates(id) ON DELETE RESTRICT,
    accrued_at      timestamptz NOT NULL DEFAULT now(),
    settlement_id   text        REFERENCES lawyer_settlements(id) ON DELETE SET NULL,
    CONSTRAINT lawyer_fee_entries_kind_chk    CHECK (kind IN ('review', 'consultation')),
    CONSTRAINT lawyer_fee_entries_urgency_chk CHECK (urgency IN ('std', 'fast')),
    CONSTRAINT lawyer_fee_entries_amount_chk  CHECK (amount_clp >= 0)
);

-- Índices
CREATE INDEX idx_lawyer_fee_rates_effective   ON lawyer_fee_rates (effective_from DESC);
CREATE INDEX idx_lawyer_fee_entries_lawyer    ON lawyer_fee_entries (lawyer_id, accrued_at DESC);
CREATE INDEX idx_lawyer_fee_entries_settle    ON lawyer_fee_entries (settlement_id);
CREATE INDEX idx_lawyer_fee_entries_rate      ON lawyer_fee_entries (rate_version_id);
CREATE INDEX idx_lawyer_fee_entries_pending   ON lawyer_fee_entries (lawyer_id)
    WHERE settlement_id IS NULL;   -- devengos aún no liquidados
