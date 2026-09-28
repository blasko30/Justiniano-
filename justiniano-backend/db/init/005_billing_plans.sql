-- 005_billing_plans.sql — Planes y su versionado (§3, §16).
-- Se crea antes que users (010) porque users.plan_id referencia plans.
-- plan_versions.created_by se enlaza a users con ALTER TABLE en 010_auth_users.sql.

CREATE TABLE plans (
    id                text        PRIMARY KEY,
    name              varchar(60) NOT NULL,
    color             varchar(7)  NOT NULL DEFAULT '#FF6B35',
    price_monthly_clp integer,
    price_annual_clp  integer,
    corporate         boolean     NOT NULL DEFAULT false,
    active            boolean     NOT NULL DEFAULT true,
    limits            jsonb       NOT NULL,
    stripe_price_ids  jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT plans_price_monthly_chk CHECK (price_monthly_clp IS NULL OR price_monthly_clp >= 0),
    CONSTRAINT plans_price_annual_chk  CHECK (price_annual_clp  IS NULL OR price_annual_clp  >= 0)
);

CREATE TABLE plan_versions (
    id                text        PRIMARY KEY,
    plan_id           text        NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    version           integer     NOT NULL,
    price_monthly_clp integer,
    price_annual_clp  integer,
    limits            jsonb       NOT NULL,
    created_by        text,       -- FK a users(id) agregada en 010_auth_users.sql
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT plan_versions_plan_version_uq UNIQUE (plan_id, version),
    CONSTRAINT plan_versions_version_chk CHECK (version >= 1)
);

-- Índices (la UNIQUE (plan_id, version) ya indexa por plan_id como prefijo)
CREATE INDEX idx_plans_active ON plans (active);
