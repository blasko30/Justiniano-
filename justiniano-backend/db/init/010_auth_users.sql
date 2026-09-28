-- 010_auth_users.sql — Cuentas, sesiones y OTP (§3, §6).
-- Requiere 005_billing_plans.sql (users.plan_id → plans).

CREATE TABLE users (
    id                 text         PRIMARY KEY,
    name               varchar(120) NOT NULL,
    email              varchar(254) NOT NULL UNIQUE,
    email_verified     boolean      NOT NULL DEFAULT false,
    phone              varchar(20),
    phone_verified     boolean      NOT NULL DEFAULT false,
    password_hash      text         NOT NULL,
    company            varchar(120),
    country            varchar(2)   NOT NULL DEFAULT 'CL',
    lang               varchar(2)   NOT NULL DEFAULT 'es',
    theme              varchar(10)  NOT NULL DEFAULT 'light',
    plan_id            text         REFERENCES plans(id) ON DELETE SET NULL,
    credits            integer      NOT NULL DEFAULT 0,
    size               varchar(30),
    industry           varchar(60),
    city               varchar(80),
    contact_role       varchar(60),
    onboarding_done    boolean      NOT NULL DEFAULT false,
    role               varchar(10)  NOT NULL DEFAULT 'client',
    mfa_enabled        boolean      NOT NULL DEFAULT false,
    notif_email        boolean      NOT NULL DEFAULT true,
    notif_sms          boolean      NOT NULL DEFAULT false,
    terms_version      varchar(7),
    terms_accepted_at  timestamptz,
    stripe_customer_id varchar(64),
    billing_cycle      varchar(10)  NOT NULL DEFAULT 'monthly',
    last_activity_at   timestamptz,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    deleted_at         timestamptz,
    CONSTRAINT users_role_chk          CHECK (role IN ('client', 'seller', 'lawyer', 'admin')),
    CONSTRAINT users_billing_cycle_chk CHECK (billing_cycle IN ('monthly', 'annual')),
    CONSTRAINT users_credits_chk       CHECK (credits >= 0)
);

CREATE TABLE refresh_tokens (
    id         text        PRIMARY KEY,
    user_id    text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash varchar(64) NOT NULL UNIQUE,
    family_id  text        NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
    id          text        PRIMARY KEY,
    user_id     text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel     varchar(10) NOT NULL,
    code_hash   varchar(64) NOT NULL,
    purpose     varchar(20) NOT NULL,
    attempts    integer     NOT NULL DEFAULT 0,
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT otp_codes_channel_chk CHECK (channel IN ('email', 'sms')),
    CONSTRAINT otp_codes_purpose_chk CHECK (purpose IN ('verify_email', 'verify_phone', 'mfa', 'reset')),
    CONSTRAINT otp_codes_attempts_chk CHECK (attempts >= 0)
);

-- FK diferida desde 005 (plan_versions.created_by → users)
ALTER TABLE plan_versions
    ADD CONSTRAINT plan_versions_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- Índices
CREATE INDEX idx_users_role_deleted_at      ON users (role, deleted_at);
CREATE INDEX idx_users_plan_id              ON users (plan_id);
CREATE INDEX idx_refresh_tokens_user_id     ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_family_id   ON refresh_tokens (family_id);
CREATE INDEX idx_otp_codes_user_id          ON otp_codes (user_id);
CREATE INDEX idx_otp_codes_pending          ON otp_codes (user_id, purpose)
    WHERE consumed_at IS NULL;
CREATE INDEX idx_plan_versions_created_by   ON plan_versions (created_by);
