"""Modelo de datos (§3, v2.3). Los DDL canónicos viven en db/init/*.sql."""
from datetime import date, datetime

from sqlalchemy import (BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Integer,
                        String, Text, UniqueConstraint, text)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

_now = text("now()")


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    phone_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    password_hash: Mapped[str] = mapped_column(String)
    company: Mapped[str | None] = mapped_column(String(120))
    country: Mapped[str] = mapped_column(String(2), default="CL")
    lang: Mapped[str] = mapped_column(String(2), default="es")
    theme: Mapped[str] = mapped_column(String(10), default="light")
    plan_id: Mapped[str | None] = mapped_column(String, ForeignKey("plans.id"))
    credits: Mapped[int] = mapped_column(Integer, default=0)
    size: Mapped[str | None] = mapped_column(String(30))          # onboarding
    industry: Mapped[str | None] = mapped_column(String(60))
    city: Mapped[str | None] = mapped_column(String(80))
    contact_role: Mapped[str | None] = mapped_column(String(60))
    onboarding_done: Mapped[bool] = mapped_column(Boolean, default=False)
    role: Mapped[str] = mapped_column(String(10), default="client")  # client|seller|lawyer|admin
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    notif_email: Mapped[bool] = mapped_column(Boolean, default=True)
    notif_sms: Mapped[bool] = mapped_column(Boolean, default=False)
    terms_version: Mapped[str | None] = mapped_column(String(7))
    terms_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stripe_customer_id: Mapped[str | None] = mapped_column(String(64))
    billing_cycle: Mapped[str] = mapped_column(String(10), default="monthly")
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    family_id: Mapped[str] = mapped_column(String, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class OtpCode(Base):
    __tablename__ = "otp_codes"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    channel: Mapped[str] = mapped_column(String(10))              # email|sms
    code_hash: Mapped[str] = mapped_column(String(64))
    purpose: Mapped[str] = mapped_column(String(20))              # verify_email|verify_phone|mfa|reset
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class Agent(Base):
    __tablename__ = "agents"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    icon: Mapped[str] = mapped_column(String(10))
    color: Mapped[str] = mapped_column(String(7))
    name_i18n: Mapped[dict] = mapped_column(JSONB)
    description_i18n: Mapped[dict] = mapped_column(JSONB)
    legal_basis: Mapped[str | None] = mapped_column(Text)
    premium: Mapped[bool] = mapped_column(Boolean, default=False)
    sort: Mapped[int] = mapped_column(Integer, default=0)


class Consultation(Base):
    __tablename__ = "consultations"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agents.id"))
    title: Mapped[str] = mapped_column(String(200))
    interactions_used: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    consultation_id: Mapped[str] = mapped_column(String, ForeignKey("consultations.id"), index=True)
    role: Mapped[str] = mapped_column(String(10))                 # user|assistant
    content: Mapped[str] = mapped_column(Text)
    legal_basis: Mapped[list | None] = mapped_column(JSONB)
    suggestions: Mapped[list | None] = mapped_column(JSONB)
    suggested_format_id: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    message_id: Mapped[str | None] = mapped_column(String, ForeignKey("messages.id"))
    blob_path: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    content_type: Mapped[str] = mapped_column(String(100))
    sensitive: Mapped[bool] = mapped_column(Boolean, default=False)
    purge_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class DocumentArea(Base):
    __tablename__ = "document_areas"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name_i18n: Mapped[dict] = mapped_column(JSONB)
    icon: Mapped[str | None] = mapped_column(String(10))
    sort: Mapped[int] = mapped_column(Integer, default=0)


class DocumentFormat(Base):
    __tablename__ = "document_formats"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    area_id: Mapped[str] = mapped_column(String, ForeignKey("document_areas.id"), index=True)
    name_i18n: Mapped[dict] = mapped_column(JSONB)
    doc_type: Mapped[str] = mapped_column(String(30))
    notarial_required: Mapped[bool] = mapped_column(Boolean, default=False)
    fields_schema: Mapped[dict] = mapped_column(JSONB)
    template_body: Mapped[str | None] = mapped_column(Text)


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    format_id: Mapped[str] = mapped_column(String, ForeignKey("document_formats.id"))
    consultation_id: Mapped[str | None] = mapped_column(String, ForeignKey("consultations.id"))
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(10), default="draft")  # draft|pending|review|ready
    fields: Mapped[dict] = mapped_column(JSONB, default=dict)
    content_html: Mapped[str | None] = mapped_column(Text)
    missing_fields: Mapped[list | None] = mapped_column(JSONB)
    disclaimer_removed: Mapped[bool] = mapped_column(Boolean, default=False)
    disclaimer_removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class Lawyer(Base):
    __tablename__ = "lawyers"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    rut: Mapped[str] = mapped_column(String(12), unique=True)
    bar: Mapped[str] = mapped_column(String(80), default="Colegio de Abogados de Chile")
    birth_date: Mapped[date] = mapped_column(Date)
    university: Mapped[str | None] = mapped_column(String(120))
    degree_year: Mapped[int | None] = mapped_column(Integer)
    id_document_blob: Mapped[str | None] = mapped_column(String)
    degree_certificate_blob: Mapped[str | None] = mapped_column(String)
    verification_status: Mapped[str] = mapped_column(String(10), default="pending")  # pending|verified|rejected
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    specialties: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    specialties_pending: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    rating: Mapped[float | None] = mapped_column(Float)
    ratings_count: Mapped[int] = mapped_column(Integer, default=0)
    sla_hours: Mapped[int] = mapped_column(Integer, default=48)
    accepts_urgent: Mapped[bool] = mapped_column(Boolean, default=True)
    available: Mapped[bool] = mapped_column(Boolean, default=True)      # preferencia del abogado (§20.4)
    paused: Mapped[bool] = mapped_column(Boolean, default=False)        # decisión del admin (§21.10)
    max_concurrent_cases: Mapped[int] = mapped_column(Integer, default=5)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    suspension_reason: Mapped[str | None] = mapped_column(Text)
    promoter: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    availability: Mapped[str | None] = mapped_column(String(10))        # lt_5h|5_15h|gt_15h
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class Review(Base):
    __tablename__ = "reviews"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    target_type: Mapped[str] = mapped_column(String(10))               # document|message
    document_id: Mapped[str | None] = mapped_column(String, ForeignKey("documents.id"))
    message_id: Mapped[str | None] = mapped_column(String, ForeignKey("messages.id"))
    urgency: Mapped[str] = mapped_column(String(5))                    # std|fast
    assignment_mode: Mapped[str] = mapped_column(String(10))           # auto|frequent|pick
    source: Mapped[str] = mapped_column(String(10), default="direct")  # direct|pool|admin
    area: Mapped[str | None] = mapped_column(String(10))
    lawyer_id: Mapped[str | None] = mapped_column(String, ForeignKey("lawyers.id"), index=True)
    assigned_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    state: Mapped[int] = mapped_column(Integer, default=1)             # 1..4 (§4.2)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sla_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejected_reason: Mapped[str | None] = mapped_column(Text)
    draft: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)                    # nota del cliente
    observations: Mapped[str | None] = mapped_column(Text)            # compat cliente (=final)
    final_observations: Mapped[str | None] = mapped_column(Text)
    response_text: Mapped[str | None] = mapped_column(Text)           # consultas
    declaration_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    late: Mapped[bool] = mapped_column(Boolean, default=False)
    fee_amount_clp: Mapped[int | None] = mapped_column(Integer)
    cost_credits: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class ReviewStateHistory(Base):
    __tablename__ = "review_state_history"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    review_id: Mapped[str] = mapped_column(String, ForeignKey("reviews.id"), index=True)
    state: Mapped[int] = mapped_column(Integer)
    actor_role: Mapped[str] = mapped_column(String(10), default="system")  # system|lawyer|admin
    actor_user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class ReviewAnnotation(Base):
    __tablename__ = "review_annotations"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    review_id: Mapped[str] = mapped_column(String, ForeignKey("reviews.id"), index=True)
    lawyer_id: Mapped[str] = mapped_column(String, ForeignKey("lawyers.id"))
    paragraph_index: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(10))                  # comment|change|highlight
    comment_text: Mapped[str | None] = mapped_column(Text)
    original_text: Mapped[str | None] = mapped_column(Text)
    proposed_text: Mapped[str | None] = mapped_column(Text)
    client_resolution: Mapped[str] = mapped_column(String(10), default="pending")  # pending|accepted|rejected
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ReviewMessage(Base):
    __tablename__ = "review_messages"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    review_id: Mapped[str] = mapped_column(String, ForeignKey("reviews.id"), index=True)
    sender_role: Mapped[str] = mapped_column(String(10))           # client|lawyer
    sender_user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class HistoryAccessLog(Base):
    __tablename__ = "history_access_log"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    lawyer_id: Mapped[str] = mapped_column(String, ForeignKey("lawyers.id"), index=True)
    review_id: Mapped[str] = mapped_column(String, ForeignKey("reviews.id"))
    document_id: Mapped[str] = mapped_column(String, ForeignKey("documents.id"))
    viewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)
    ip: Mapped[str | None] = mapped_column(String(45))


class Plan(Base):
    __tablename__ = "plans"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    color: Mapped[str] = mapped_column(String(7), default="#FF6B35")
    price_monthly_clp: Mapped[int | None] = mapped_column(Integer)
    price_annual_clp: Mapped[int | None] = mapped_column(Integer)
    corporate: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)    # baja lógica (§16)
    limits: Mapped[dict] = mapped_column(JSONB)                    # 6 límites (§4)
    stripe_price_ids: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class PlanVersion(Base):
    __tablename__ = "plan_versions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    plan_id: Mapped[str] = mapped_column(String, ForeignKey("plans.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    price_monthly_clp: Mapped[int | None] = mapped_column(Integer)
    price_annual_clp: Mapped[int | None] = mapped_column(Integer)
    limits: Mapped[dict] = mapped_column(JSONB)
    created_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)
    __table_args__ = (UniqueConstraint("plan_id", "version"),)


class Subscription(Base):
    __tablename__ = "subscriptions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), unique=True)
    plan_id: Mapped[str] = mapped_column(String, ForeignKey("plans.id"))
    plan_version_id: Mapped[str | None] = mapped_column(String, ForeignKey("plan_versions.id"))
    billing_cycle: Mapped[str] = mapped_column(String(10), default="monthly")
    status: Mapped[str] = mapped_column(String(20), default="active")
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(64))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class CreditTransaction(Base):
    __tablename__ = "credit_transactions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(20))  # gift|purchase|review_spend|plan_bonus
    reference_id: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    stripe_event_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    description: Mapped[str] = mapped_column(String(200))
    amount_clp: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20))
    invoice_url: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), index=True)
    event: Mapped[str] = mapped_column(String(30))
    detail: Mapped[dict | None] = mapped_column(JSONB)
    ip: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class Seller(Base):
    __tablename__ = "sellers"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), unique=True)
    target_monthly_clp: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class Client(Base):
    __tablename__ = "clients"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    seller_id: Mapped[str] = mapped_column(String, ForeignKey("sellers.id"), index=True)
    company: Mapped[str] = mapped_column(String(120))
    contact: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(20))
    city: Mapped[str | None] = mapped_column(String(80))
    industry: Mapped[str | None] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(10), default="prospect")  # client|prospect
    linked_user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(Text)
    projection: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class SalesContract(Base):
    __tablename__ = "sales_contracts"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    seller_id: Mapped[str] = mapped_column(String, ForeignKey("sellers.id"), index=True)
    client_id: Mapped[str | None] = mapped_column(String, ForeignKey("clients.id"))
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    plan_id: Mapped[str] = mapped_column(String, ForeignKey("plans.id"))
    monthly_amount_clp: Mapped[int] = mapped_column(Integer)
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)


class ServiceIncident(Base):
    __tablename__ = "service_incidents"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    service: Mapped[str] = mapped_column(String(60))
    summary: Mapped[str] = mapped_column(String(300))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    severity: Mapped[str] = mapped_column(String(10), default="warn")


class LawyerFeeEntry(Base):
    __tablename__ = "lawyer_fee_entries"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    lawyer_id: Mapped[str] = mapped_column(String, ForeignKey("lawyers.id"), index=True)
    review_id: Mapped[str] = mapped_column(String, ForeignKey("reviews.id"), unique=True)
    kind: Mapped[str] = mapped_column(String(15))                 # review|consultation
    urgency: Mapped[str] = mapped_column(String(5))
    amount_clp: Mapped[int] = mapped_column(Integer)
    rate_version_id: Mapped[str | None] = mapped_column(String, ForeignKey("lawyer_fee_rates.id"))
    accrued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)
    settlement_id: Mapped[str | None] = mapped_column(String, ForeignKey("lawyer_settlements.id"))


class LawyerSettlement(Base):
    __tablename__ = "lawyer_settlements"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    lawyer_id: Mapped[str] = mapped_column(String, ForeignKey("lawyers.id"), index=True)
    period: Mapped[str] = mapped_column(String(7))                # YYYY-MM
    reviews_count: Mapped[int] = mapped_column(Integer, default=0)
    consultations_count: Mapped[int] = mapped_column(Integer, default=0)
    sla_bonus_pct: Mapped[int] = mapped_column(Integer, default=0)
    total_clp: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(12), default="open")  # open|processing|paid
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    receipt_blob: Mapped[str | None] = mapped_column(String)
    __table_args__ = (UniqueConstraint("lawyer_id", "period"),)


class LawyerFeeRate(Base):
    __tablename__ = "lawyer_fee_rates"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, unique=True)
    review_std_clp: Mapped[int] = mapped_column(Integer)
    review_urgent_clp: Mapped[int] = mapped_column(Integer)
    consultation_std_clp: Mapped[int] = mapped_column(Integer)
    consultation_urgent_clp: Mapped[int] = mapped_column(Integer)
    sla_bonus_pct: Mapped[int] = mapped_column(Integer, default=5)
    effective_from: Mapped[date] = mapped_column(Date)
    created_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now)
