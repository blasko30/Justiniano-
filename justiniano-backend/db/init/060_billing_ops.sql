-- 060_billing_ops.sql — Suscripciones, créditos, pagos, auditoría e incidentes (§3, §13, §14, §17).
-- Requiere 005 (plans, plan_versions) y 010 (users).

CREATE TABLE subscriptions (
    id                     text        PRIMARY KEY,
    user_id                text        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    plan_id                text        NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    plan_version_id        text        REFERENCES plan_versions(id) ON DELETE SET NULL,
    billing_cycle          varchar(10) NOT NULL DEFAULT 'monthly',
    status                 varchar(20) NOT NULL DEFAULT 'active',
    stripe_subscription_id varchar(64),
    current_period_end     timestamptz,
    cancel_at_period_end   boolean     NOT NULL DEFAULT false,
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT subscriptions_billing_cycle_chk CHECK (billing_cycle IN ('monthly', 'annual'))
);

CREATE TABLE credit_transactions (
    id           text        PRIMARY KEY,
    user_id      text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta        integer     NOT NULL,
    reason       varchar(20) NOT NULL,
    reference_id text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT credit_transactions_reason_chk CHECK (reason IN ('gift', 'purchase', 'review_spend', 'plan_bonus'))
);

CREATE TABLE payments (
    id              text         PRIMARY KEY,
    user_id         text         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_event_id varchar(64)  UNIQUE,
    description     varchar(200) NOT NULL,
    amount_clp      integer      NOT NULL,
    status          varchar(20)  NOT NULL,
    invoice_url     text,
    created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
    id         text        PRIMARY KEY,
    user_id    text        REFERENCES users(id) ON DELETE SET NULL,
    event      varchar(30) NOT NULL,
    detail     jsonb,
    ip         varchar(45),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_incidents (
    id          text         PRIMARY KEY,
    service     varchar(60)  NOT NULL,
    summary     varchar(300) NOT NULL,
    started_at  timestamptz  NOT NULL,
    resolved_at timestamptz,
    severity    varchar(10)  NOT NULL DEFAULT 'warn'
);

-- Índices
CREATE INDEX idx_subscriptions_plan_id         ON subscriptions (plan_id);
CREATE INDEX idx_subscriptions_plan_version_id ON subscriptions (plan_version_id);
CREATE INDEX idx_credit_transactions_user      ON credit_transactions (user_id, created_at DESC);
CREATE INDEX idx_payments_user                 ON payments (user_id, created_at DESC);
CREATE INDEX idx_audit_events_user_event       ON audit_events (user_id, event, created_at);
CREATE INDEX idx_audit_events_event_created    ON audit_events (event, created_at);
CREATE INDEX idx_service_incidents_started     ON service_incidents (started_at DESC);
CREATE INDEX idx_service_incidents_open        ON service_incidents (service)
    WHERE resolved_at IS NULL;
