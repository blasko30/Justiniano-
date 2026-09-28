-- 070_sales.sql — Vendedores, CRM y ventas cerradas (§3, §18, §19).
-- Requiere 005 (plans) y 010 (users).

CREATE TABLE sellers (
    id                 text        PRIMARY KEY,
    user_id            text        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    target_monthly_clp integer     NOT NULL DEFAULT 0,
    active             boolean     NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sellers_target_chk CHECK (target_monthly_clp >= 0)
);

CREATE TABLE clients (
    id             text         PRIMARY KEY,
    seller_id      text         NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
    company        varchar(120) NOT NULL,
    contact        varchar(120) NOT NULL,
    email          varchar(254),
    phone          varchar(20),
    city           varchar(80),
    industry       varchar(60),
    status         varchar(10)  NOT NULL DEFAULT 'prospect',
    linked_user_id text         REFERENCES users(id) ON DELETE SET NULL,
    note           text,
    projection     jsonb,
    created_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT clients_status_chk CHECK (status IN ('client', 'prospect'))
);

CREATE TABLE sales_contracts (
    id                 text        PRIMARY KEY,
    seller_id          text        NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
    client_id          text        REFERENCES clients(id) ON DELETE SET NULL,
    user_id            text        REFERENCES users(id) ON DELETE SET NULL,
    plan_id            text        NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    monthly_amount_clp integer     NOT NULL,
    closed_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sales_contracts_amount_chk CHECK (monthly_amount_clp >= 0)
);

-- Índices
CREATE INDEX idx_clients_seller_id            ON clients (seller_id);
CREATE INDEX idx_clients_seller_status        ON clients (seller_id, status);
CREATE INDEX idx_clients_linked_user_id       ON clients (linked_user_id);
CREATE INDEX idx_sales_contracts_seller       ON sales_contracts (seller_id, closed_at DESC);
CREATE INDEX idx_sales_contracts_client_id    ON sales_contracts (client_id);
CREATE INDEX idx_sales_contracts_user_id      ON sales_contracts (user_id);
CREATE INDEX idx_sales_contracts_plan_id      ON sales_contracts (plan_id);
