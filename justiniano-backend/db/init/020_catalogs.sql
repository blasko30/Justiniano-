-- 020_catalogs.sql — Catálogos: agentes IA, áreas y formatos de documento (§3, §8).

CREATE TABLE agents (
    id               text        PRIMARY KEY,
    icon             varchar(10) NOT NULL,
    color            varchar(7)  NOT NULL,
    name_i18n        jsonb       NOT NULL,
    description_i18n jsonb       NOT NULL,
    legal_basis      text,
    premium          boolean     NOT NULL DEFAULT false,
    sort             integer     NOT NULL DEFAULT 0
);

CREATE TABLE document_areas (
    id        text    PRIMARY KEY,
    name_i18n jsonb   NOT NULL,
    icon      varchar(10),
    sort      integer NOT NULL DEFAULT 0
);

CREATE TABLE document_formats (
    id                text        PRIMARY KEY,
    area_id           text        NOT NULL REFERENCES document_areas(id) ON DELETE RESTRICT,
    name_i18n         jsonb       NOT NULL,
    doc_type          varchar(30) NOT NULL,
    notarial_required boolean     NOT NULL DEFAULT false,
    fields_schema     jsonb       NOT NULL,
    template_body     text
);

-- Índices
CREATE INDEX idx_agents_sort               ON agents (sort);
CREATE INDEX idx_document_formats_area_id  ON document_formats (area_id);
