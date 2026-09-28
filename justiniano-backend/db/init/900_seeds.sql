-- 900_seeds.sql — Datos de ejemplo coherentes con los wireframes (dev/demo).
-- Todos los usuarios tienen la contraseña 'demo1234' (hash Argon2id fijo).

-- ── Planes (§4) ─────────────────────────────────────────────────────────
INSERT INTO plans (id, name, color, price_monthly_clp, price_annual_clp, corporate, active, limits) VALUES
('p_free', 'Gratuito',    '#9AA0A6', 0,     0,      false, true,
 '{"documents_month": 2,   "support_hours": 0,  "agents": 2, "questions_month": 30,   "seats": 1,  "history_months": 1}'::jsonb),
('p_bas',  'Básico',      '#4C8BF5', 29900, 299000, false, true,
 '{"documents_month": 10,  "support_hours": 1,  "agents": 4, "questions_month": 200,  "seats": 3,  "history_months": 6}'::jsonb),
('p_int',  'Intermedio',  '#FF6B35', 59900, 599000, false, true,
 '{"documents_month": 30,  "support_hours": 3,  "agents": 6, "questions_month": 600,  "seats": 10, "history_months": 12}'::jsonb),
('p_adv',  'Avanzado',    '#7B4CF5', 99900, 999000, false, true,
 '{"documents_month": 100, "support_hours": 8,  "agents": 8, "questions_month": 2000, "seats": 25, "history_months": 24}'::jsonb),
('p_corp', 'Corporativo', '#1E2A3A', NULL,  NULL,   true,  true,
 '{"documents_month": -1,  "support_hours": 20, "agents": 8, "questions_month": -1,   "seats": -1, "history_months": 36}'::jsonb);

INSERT INTO plan_versions (id, plan_id, version, price_monthly_clp, price_annual_clp, limits)
SELECT 'plv_' || substr(id, 3) || '1', id, 1, price_monthly_clp, price_annual_clp, limits FROM plans;

-- ── Agentes IA (§8) ─────────────────────────────────────────────────────
INSERT INTO agents (id, icon, color, name_i18n, description_i18n, legal_basis, premium, sort) VALUES
('lab',  '⚖️', '#FF6B35', '{"es": "Laboral", "en": "Labor"}',
 '{"es": "Contratos de trabajo, despidos, finiquitos y fiscalización.", "en": "Employment contracts, dismissals and settlements."}',
 'Código del Trabajo; DFL 1/2002', false, 1),
('con',  '📝', '#4C8BF5', '{"es": "Contratos", "en": "Contracts"}',
 '{"es": "Redacción y revisión de contratos civiles y comerciales.", "en": "Drafting and review of civil and commercial contracts."}',
 'Código Civil, arts. 1438 y ss.', false, 2),
('trib', '🧾', '#2BA84A', '{"es": "Tributario", "en": "Tax"}',
 '{"es": "IVA, renta, boletas y obligaciones ante el SII.", "en": "VAT, income tax and SII obligations."}',
 'Código Tributario; DL 824; DL 825', false, 3),
('civ',  '🏛️', '#8A6D3B', '{"es": "Civil", "en": "Civil"}',
 '{"es": "Obligaciones, responsabilidad y bienes.", "en": "Obligations, liability and property."}',
 'Código Civil', false, 4),
('soc',  '🏢', '#7B4CF5', '{"es": "Societario", "en": "Corporate"}',
 '{"es": "Constitución de sociedades, pactos y gobiernos corporativos.", "en": "Company formation, shareholder agreements and governance."}',
 'Ley 18.046; Ley 20.659', true, 5),
('pi',   '💡', '#E8B10D', '{"es": "Propiedad intelectual", "en": "Intellectual property"}',
 '{"es": "Marcas, patentes y derechos de autor.", "en": "Trademarks, patents and copyright."}',
 'Ley 19.039; Ley 17.336', true, 6),
('pd',   '🔐', '#D9534F', '{"es": "Protección de datos", "en": "Data protection"}',
 '{"es": "Tratamiento de datos personales y deberes del responsable.", "en": "Personal data processing and controller duties."}',
 'Ley 19.628; Ley 21.719', true, 7),
('arr',  '🏠', '#20B2AA', '{"es": "Arriendos", "en": "Leases"}',
 '{"es": "Contratos de arrendamiento y término de arriendo.", "en": "Lease agreements and termination."}',
 'Ley 18.101', false, 8);

-- ── Áreas y formatos de documento (§8, §11) ─────────────────────────────
INSERT INTO document_areas (id, name_i18n, icon, sort) VALUES
('lab', '{"es": "Laboral", "en": "Labor"}',       '⚖️', 1),
('con', '{"es": "Contratos", "en": "Contracts"}', '📝', 2),
('soc', '{"es": "Societario", "en": "Corporate"}','🏢', 3);

INSERT INTO document_formats (id, area_id, name_i18n, doc_type, notarial_required, fields_schema) VALUES
('fmt_despido',   'lab', '{"es": "Carta de despido por necesidades de la empresa", "en": "Dismissal letter (company needs)"}', 'carta', false,
 '{"fields": [{"name": "empresa", "type": "texto_corto", "required": true, "sensitive": false}, {"name": "trabajador_nombre", "type": "texto_corto", "required": true, "sensitive": true}, {"name": "trabajador_rut", "type": "rut", "required": true, "sensitive": true}, {"name": "fecha_termino", "type": "fecha_iso", "required": true, "sensitive": false}]}'::jsonb),
('fmt_finiquito', 'lab', '{"es": "Finiquito de contrato de trabajo", "en": "Employment settlement"}', 'finiquito', true,
 '{"fields": [{"name": "empresa", "type": "texto_corto", "required": true, "sensitive": false}, {"name": "trabajador_nombre", "type": "texto_corto", "required": true, "sensitive": true}, {"name": "remuneracion", "type": "monto_clp", "required": true, "sensitive": true}]}'::jsonb),
('fmt_servicios', 'con', '{"es": "Contrato de prestación de servicios", "en": "Services agreement"}', 'contrato', false,
 '{"fields": [{"name": "mandante", "type": "texto_corto", "required": true, "sensitive": false}, {"name": "prestador", "type": "texto_corto", "required": true, "sensitive": false}, {"name": "honorarios", "type": "monto_clp", "required": true, "sensitive": false}, {"name": "plazo_meses", "type": "paginacion", "required": false, "sensitive": false}]}'::jsonb),
('fmt_nda',       'con', '{"es": "Acuerdo de confidencialidad (NDA)", "en": "Non-disclosure agreement"}', 'contrato', false,
 '{"fields": [{"name": "parte_reveladora", "type": "texto_corto", "required": true, "sensitive": false}, {"name": "parte_receptora", "type": "texto_corto", "required": true, "sensitive": false}, {"name": "vigencia_meses", "type": "paginacion", "required": true, "sensitive": false}]}'::jsonb),
('fmt_pactosocios', 'soc', '{"es": "Pacto de socios", "en": "Shareholders agreement"}', 'contrato', false,
 '{"fields": [{"name": "sociedad", "type": "texto_corto", "required": true, "sensitive": false}, {"name": "socios", "type": "texto_largo", "required": true, "sensitive": true}]}'::jsonb),
('fmt_estatutos', 'soc', '{"es": "Estatutos de constitución de SpA", "en": "SpA incorporation bylaws"}', 'estatuto', true,
 '{"fields": [{"name": "razon_social", "type": "texto_corto", "required": true, "sensitive": false}, {"name": "capital_clp", "type": "monto_clp", "required": true, "sensitive": false}, {"name": "socios", "type": "texto_largo", "required": true, "sensitive": true}]}'::jsonb);

-- ── Usuarios (contraseña 'demo1234') ────────────────────────────────────
INSERT INTO users (id, name, email, email_verified, phone, phone_verified, password_hash, company,
                   country, plan_id, credits, size, industry, city, contact_role, onboarding_done,
                   role, terms_version, terms_accepted_at)
VALUES
('usr_admin1',  'Ignacio Valdés',        'admin@justiniano.cl',        true, '+56911111111', true,
 '$argon2id$v=19$m=65536,t=3,p=4$NJqpTrv9JfrHjLu0OA5n7w$r6/B/eNA18EFOl8ksGKmMk69XJA5wa1UcxJgZwsCORw',
 NULL, 'CL', NULL, 0, NULL, NULL, 'Santiago', NULL, true, 'admin', '2026-06', '2026-06-15 12:00:00+00'),
('usr_seller1', 'Paula Contreras',       'p.contreras@justiniano.cl',  true, '+56922222222', true,
 '$argon2id$v=19$m=65536,t=3,p=4$NJqpTrv9JfrHjLu0OA5n7w$r6/B/eNA18EFOl8ksGKmMk69XJA5wa1UcxJgZwsCORw',
 NULL, 'CL', NULL, 0, NULL, NULL, 'Santiago', NULL, true, 'seller', '2026-06', '2026-06-15 12:00:00+00'),
('usr_cli1',    'María Fernanda Rojas',  'mf.rojas@constructoraandes.cl', true, '+56981234567', true,
 '$argon2id$v=19$m=65536,t=3,p=4$NJqpTrv9JfrHjLu0OA5n7w$r6/B/eNA18EFOl8ksGKmMk69XJA5wa1UcxJgZwsCORw',
 'Constructora Andes SpA', 'CL', 'p_int', 3, '11-50', 'Construcción', 'Santiago', 'Gerente de Administración',
 true, 'client', '2026-06', '2026-07-01 09:00:00+00'),
('usr_cli2',    'Camila Reyes',          'c.reyes@novatech.cl',        true, '+56987654321', true,
 '$argon2id$v=19$m=65536,t=3,p=4$NJqpTrv9JfrHjLu0OA5n7w$r6/B/eNA18EFOl8ksGKmMk69XJA5wa1UcxJgZwsCORw',
 'NovaTech SpA', 'CL', 'p_bas', 2, '1-10', 'Tecnología', 'Valparaíso', 'CEO',
 true, 'client', '2026-06', '2026-07-10 10:00:00+00'),
('usr_law1',    'Daniela Fuentes Aravena', 'd.fuentes@correo.cl',      true, '+56933333333', true,
 '$argon2id$v=19$m=65536,t=3,p=4$NJqpTrv9JfrHjLu0OA5n7w$r6/B/eNA18EFOl8ksGKmMk69XJA5wa1UcxJgZwsCORw',
 NULL, 'CL', NULL, 0, NULL, NULL, 'Santiago', NULL, true, 'lawyer', '2026-06', '2026-07-05 11:00:00+00'),
('usr_law2',    'Rodrigo Salinas Pérez', 'r.salinas@correo.cl',        true, '+56944444444', false,
 '$argon2id$v=19$m=65536,t=3,p=4$NJqpTrv9JfrHjLu0OA5n7w$r6/B/eNA18EFOl8ksGKmMk69XJA5wa1UcxJgZwsCORw',
 NULL, 'CL', NULL, 0, NULL, NULL, 'Concepción', NULL, true, 'lawyer', '2026-06', '2026-08-01 15:00:00+00');

-- ── Perfiles: vendedor y abogados ───────────────────────────────────────
INSERT INTO sellers (id, user_id, target_monthly_clp, active) VALUES
('sel_1', 'usr_seller1', 1500000, true);

INSERT INTO lawyers (id, user_id, name, rut, birth_date, university, degree_year,
                     verification_status, verified_at, verified_by, specialties, specialties_pending,
                     rating, ratings_count, accepts_urgent, available, promoter, availability)
VALUES
('law_1', 'usr_law1', 'Daniela Fuentes Aravena', '16482913-8', '1988-04-12', 'Universidad de Chile', 2014,
 'verified', '2026-07-06 15:30:00+00', 'usr_admin1', '{lab,con}', '{}', 4.8, 23, true, true, false, '5_15h'),
('law_2', 'usr_law2', 'Rodrigo Salinas Pérez',   '12345678-5', '1990-09-03', 'Universidad de Concepción', 2016,
 'pending', NULL, NULL, '{}', '{trib,civ}', NULL, 0, true, true, false, 'lt_5h');

-- ── CRM del vendedor ────────────────────────────────────────────────────
INSERT INTO clients (id, seller_id, company, contact, email, phone, city, industry, status, linked_user_id, note, projection) VALUES
('cli_1', 'sel_1', 'Constructora Andes SpA', 'María Fernanda Rojas', 'mf.rojas@constructoraandes.cl',
 '+56981234567', 'Santiago', 'Construcción', 'client', 'usr_cli1', 'Cerrado en plan Intermedio.', NULL),
('cli_2', 'sel_1', 'Minera Cordillera',      'Jorge Espinoza',       'j.espinoza@minera-cordillera.cl',
 '+56955555555', 'Antofagasta', 'Minería', 'prospect', NULL, 'Interesados en Corporativo.',
 '{"stage": "proposal", "plan_id": "p_corp", "monthly_amount_clp": 450000, "probability_pct": 60, "expected_close_date": "2026-09-15", "note": "Esperan aprobación de gerencia."}'::jsonb);

INSERT INTO sales_contracts (id, seller_id, client_id, user_id, plan_id, monthly_amount_clp, closed_at) VALUES
('sct_1', 'sel_1', 'cli_1', 'usr_cli1', 'p_int', 59900, '2026-07-01 12:00:00+00');

-- ── Suscripciones ───────────────────────────────────────────────────────
INSERT INTO subscriptions (id, user_id, plan_id, plan_version_id, billing_cycle, status, current_period_end) VALUES
('sub_1', 'usr_cli1', 'p_int', 'plv_int1', 'monthly', 'active', '2026-09-01 00:00:00+00'),
('sub_2', 'usr_cli2', 'p_bas', 'plv_bas1', 'monthly', 'active', '2026-09-10 00:00:00+00');

-- ── Tarifario de honorarios v1 (§21.3) ──────────────────────────────────
INSERT INTO lawyer_fee_rates (id, version, review_std_clp, review_urgent_clp,
                              consultation_std_clp, consultation_urgent_clp,
                              sla_bonus_pct, effective_from, created_by) VALUES
('rate_v1', 1, 18000, 28000, 8000, 12000, 5, '2026-01-01', 'usr_admin1');

-- ── Documentos y revisiones de ejemplo (§4.2) ───────────────────────────
INSERT INTO documents (id, user_id, format_id, name, status, fields, content_html) VALUES
('doc_1', 'usr_cli1', 'fmt_despido', 'Carta de despido por necesidades de la empresa', 'review',
 '{"empresa": "Constructora Andes SpA", "trabajador_nombre": "Pedro Muñoz", "trabajador_rut": "9876543-3", "fecha_termino": "2026-08-31"}'::jsonb,
 '<p>En Santiago, a 7 de agosto de 2026, Constructora Andes SpA comunica el término del contrato de trabajo…</p><p>La causal invocada es el artículo 161 del Código del Trabajo, necesidades de la empresa.</p>'),
('doc_2', 'usr_cli2', 'fmt_servicios', 'Contrato de prestación de servicios', 'review',
 '{"mandante": "NovaTech SpA", "prestador": "Consultora Delta Ltda.", "honorarios": 2500000, "plazo_meses": 6}'::jsonb,
 '<p>Contrato de prestación de servicios entre NovaTech SpA y Consultora Delta Ltda.…</p><p>El presente contrato podrá terminarse sin expresión de causa, mediante aviso escrito con 5 días de anticipación.</p>');

-- Revisión en la bolsa: estado 1, source=pool, área laboral, urgente (2 créditos)
INSERT INTO reviews (id, user_id, target_type, document_id, urgency, assignment_mode, source, area,
                     state, notes, cost_credits, created_at) VALUES
('rev_pool1', 'usr_cli1', 'document', 'doc_1', 'fast', 'auto', 'pool', 'lab',
 1, 'Necesitamos validar la causal antes de notificar al trabajador.', 2, '2026-08-07 10:48:00+00');

-- Revisión asignada en curso: estado 3, abogado verificado, SLA 48 h hábiles
INSERT INTO reviews (id, user_id, target_type, document_id, urgency, assignment_mode, source, area,
                     lawyer_id, state, assigned_at, accepted_at, sla_due_at, notes, fee_amount_clp,
                     cost_credits, created_at) VALUES
('rev_act1', 'usr_cli2', 'document', 'doc_2', 'std', 'pick', 'direct', 'con',
 'law_1', 3, '2026-08-06 09:00:00+00', '2026-08-06 09:40:00+00', '2026-08-12 09:40:00+00',
 'Lo más importante es la cláusula de término anticipado.', 18000, 1, '2026-08-06 08:55:00+00');

INSERT INTO review_state_history (id, review_id, state, actor_role, actor_user_id, reason, created_at) VALUES
('rsh_1', 'rev_pool1', 1, 'system', NULL,       'Solicitud publicada en la bolsa (sin abogado directo disponible).', '2026-08-07 10:48:00+00'),
('rsh_2', 'rev_act1',  1, 'system', NULL,       'Solicitud enviada.',                    '2026-08-06 08:55:00+00'),
('rsh_3', 'rev_act1',  2, 'system', NULL,       'Asignación directa a abogado frecuente.', '2026-08-06 09:00:00+00'),
('rsh_4', 'rev_act1',  3, 'lawyer', 'usr_law1', 'Caso aceptado por el abogado.',          '2026-08-06 09:40:00+00');

-- ── Créditos iniciales (coherentes con users.credits) ───────────────────
INSERT INTO credit_transactions (id, user_id, delta, reason, reference_id, created_at) VALUES
('ctx_1', 'usr_cli1',  5, 'plan_bonus',   'p_int',     '2026-07-01 12:00:00+00'),
('ctx_2', 'usr_cli1', -2, 'review_spend', 'rev_pool1', '2026-08-07 10:48:00+00'),
('ctx_3', 'usr_cli2',  3, 'gift',         NULL,        '2026-07-10 10:05:00+00'),
('ctx_4', 'usr_cli2', -1, 'review_spend', 'rev_act1',  '2026-08-06 08:55:00+00');

-- ── Auditoría de ejemplo ────────────────────────────────────────────────
INSERT INTO audit_events (id, user_id, event, detail, ip) VALUES
('aud_1', 'usr_cli1', 'audit_tyc',   '{"terms_version": "2026-06"}'::jsonb, '190.100.10.1'),
('aud_2', 'usr_law1', 'audit_sworn', '{"declaration": true}'::jsonb,        '190.100.10.2');
