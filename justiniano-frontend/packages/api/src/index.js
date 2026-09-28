/**
 * SDK de la API Justiniano v2.3 (110 endpoints, 16 módulos).
 * Cada portal crea su instancia:
 *
 *   import { createApi } from "@justiniano/api";
 *   export const api = createApi({ storagePrefix: "jus_cliente" });
 *
 * Los métodos devuelven promesas con el JSON de la respuesta y lanzan
 * ApiError en fallos. El refresh de tokens es transparente.
 */
import { createHttp, ApiError } from "./http.js";

export { ApiError };

export function createApi(opts = {}) {
  const http = createHttp(opts);

  const api = {
    http,
    tokens: http.tokens,

    /* ── §6 Autenticación ─────────────────────────────────────────── */
    auth: {
      signup: (body) => http.post("/auth/signup", { body, auth: false }),
      verifyEmail: (body) => http.post("/auth/verify-email", { body, auth: false }),
      resendEmailCode: (body) => http.post("/auth/resend-email-code", { body, auth: false }),
      verifyPhone: (body) => http.post("/auth/verify-phone", { body, auth: false }),
      resendPhoneCode: (body) => http.post("/auth/resend-phone-code", { body, auth: false }),
      login: async (body) => {
        const r = await http.post("/auth/login", { body, auth: false });
        if (r?.access_token) http.tokens.set(r);
        return r;
      },
      mfaVerify: async (body) => {
        const r = await http.post("/auth/mfa/verify", { body, auth: false });
        if (r?.access_token) http.tokens.set(r);
        return r;
      },
      refresh: (body) => http.post("/auth/refresh", { body, auth: false }),
      logout: async () => {
        const refresh_token = http.tokens.refresh;
        try {
          if (refresh_token) await http.post("/auth/logout", { body: { refresh_token } });
        } finally {
          http.tokens.clear();
        }
      },
      forgotPassword: (body) => http.post("/auth/forgot-password", { body, auth: false }),
      resetPassword: (body) => http.post("/auth/reset-password", { body, auth: false }),
      changePassword: (body) => http.post("/auth/change-password", { body }),
      isLoggedIn: () => Boolean(http.tokens.access),
    },

    /* ── §7 Usuario actual ────────────────────────────────────────── */
    users: {
      me: () => http.get("/users/me"),
      updateMe: (body) => http.patch("/users/me", { body }),
      completeOnboarding: (body) => http.post("/users/me/onboarding", { body }),
      updatePreferences: (body) => http.patch("/users/me/preferences", { body }),
      acceptTerms: (body) => http.post("/users/me/terms-acceptance", { body }),
      consents: () => http.get("/users/me/consents"),
      usage: () => http.get("/users/me/usage"),
      deleteMe: (body) => http.del("/users/me", { body }),
    },

    /* ── §8 Catálogos ─────────────────────────────────────────────── */
    catalog: {
      countries: () => http.get("/catalog/countries", { auth: false }),
      agents: (params) => http.get("/agents", { params }),
      documentAreas: () => http.get("/catalog/document-areas"),
      documentFormats: (params) => http.get("/catalog/document-formats", { params }),
      formatFields: (formatId) => http.get(`/catalog/document-formats/${formatId}/fields`),
    },

    /* ── §9 Consultas IA ──────────────────────────────────────────── */
    consultations: {
      list: (params) => http.get("/consultations", { params }),
      create: (body) => http.post("/consultations", { body }),
      get: (id) => http.get(`/consultations/${id}`),
      messages: (id, params) => http.get(`/consultations/${id}/messages`, { params }),
      export: (id, body) => http.post(`/consultations/${id}/export`, { body }),
    },

    /* ── §10 Adjuntos ─────────────────────────────────────────────── */
    attachments: {
      upload: (file, extra = {}) => {
        const fd = new FormData();
        fd.append("file", file);
        for (const [k, v] of Object.entries(extra)) fd.append(k, v);
        return http.post("/attachments", { formData: fd });
      },
      get: (id) => http.get(`/attachments/${id}`),
      remove: (id) => http.del(`/attachments/${id}`),
    },

    /* ── §11 Documentos ───────────────────────────────────────────── */
    documents: {
      list: (params) => http.get("/documents", { params }),
      create: (body) => http.post("/documents", { body }),
      get: (id) => http.get(`/documents/${id}`),
      patchFields: (id, body) => http.patch(`/documents/${id}/fields`, { body }),
      download: (id, body) => http.post(`/documents/${id}/download`, { body }),
      removeDisclaimer: (id) => http.del(`/documents/${id}/disclaimer`),
    },

    /* ── §12 Revisiones (lado cliente) ────────────────────────────── */
    reviews: {
      lawyers: (params) => http.get("/lawyers", { params }),
      create: (body) => http.post("/reviews", { body }),
      list: (params) => http.get("/reviews", { params }),
      get: (id) => http.get(`/reviews/${id}`),
      chat: (id, params) => http.get(`/reviews/${id}/chat`, { params }),
      sendChat: (id, body) => http.post(`/reviews/${id}/chat`, { body }),
    },

    /* ── §13 Facturación / Stripe ─────────────────────────────────── */
    billing: {
      plans: () => http.get("/plans", { auth: false }),
      creditPacks: () => http.get("/billing/credit-packs"),
      subscription: () => http.get("/billing/subscription"),
      checkoutPlan: (body) => http.post("/billing/checkout", { body }),
      checkoutCredits: (body) => http.post("/billing/credits/checkout", { body }),
      portal: () => http.post("/billing/portal"),
      payments: (params) => http.get("/billing/payments", { params }),
      paymentMethod: () => http.get("/billing/payment-method"),
    },

    /* ── §14 Sistema ──────────────────────────────────────────────── */
    system: {
      health: () => http.get("/health", { auth: false }),
    },

    /* ── §15 Admin · métricas y usuarios ──────────────────────────── */
    adminMetrics: {
      overview: (params) => http.get("/admin/metrics/overview", { params }),
      users: (params) => http.get("/admin/metrics/users", { params }),
      sendReminder: (userId, body) => http.post(`/admin/users/${userId}/reminder`, { body }),
      patchUser: (userId, body) => http.patch(`/admin/users/${userId}`, { body }),
    },

    /* ── §16 Admin · planes ───────────────────────────────────────── */
    adminPlans: {
      list: (params) => http.get("/admin/plans", { params }),
      create: (body) => http.post("/admin/plans", { body }),
      patch: (planId, body) => http.patch(`/admin/plans/${planId}`, { body }),
      retire: (planId) => http.del(`/admin/plans/${planId}`),
      users: (planId, params) => http.get(`/admin/plans/${planId}/users`, { params }),
    },

    /* ── §17 Admin · operación ────────────────────────────────────── */
    adminOps: {
      panel: (params) => http.get("/admin/operations", { params }),
    },

    /* ── §18 Admin · ventas ───────────────────────────────────────── */
    adminSales: {
      overview: (params) => http.get("/admin/sales/overview", { params }),
      sellers: (params) => http.get("/admin/sales/sellers", { params }),
      conversion: (params) => http.get("/admin/sales/conversion", { params }),
      createSeller: (body) => http.post("/admin/sellers", { body }),
      patchSeller: (sellerId, body) => http.patch(`/admin/sellers/${sellerId}`, { body }),
      patchClient: (clientId, body) => http.patch(`/admin/clients/${clientId}`, { body }),
    },

    /* ── §19 Portal del vendedor ──────────────────────────────────── */
    salesMe: {
      overview: () => http.get("/sales/me/overview"),
      clients: (params) => http.get("/sales/me/clients", { params }),
      createClient: (body) => http.post("/sales/me/clients", { body }),
      patchClient: (clientId, body) => http.patch(`/sales/me/clients/${clientId}`, { body }),
    },

    /* ── §20 Portal del abogado ───────────────────────────────────── */
    lawyers: {
      uploadAccreditation: (body) => http.post("/lawyers/me/accreditation", { body }),
      me: () => http.get("/lawyers/me"),
      patchMe: (body) => http.patch("/lawyers/me", { body }),
      overview: () => http.get("/lawyers/me/overview"),
      myReviews: (params) => http.get("/lawyers/me/reviews", { params }),
      workspace: (reviewId) => http.get(`/lawyers/me/reviews/${reviewId}`),
      accept: (reviewId) => http.post(`/lawyers/me/reviews/${reviewId}/accept`),
      reject: (reviewId, body) => http.post(`/lawyers/me/reviews/${reviewId}/reject`, { body }),
      pool: (params) => http.get("/reviews/pool", { params }),
      claim: (reviewId) => http.post(`/reviews/pool/${reviewId}/claim`),
      annotations: (reviewId) => http.get(`/lawyers/me/reviews/${reviewId}/annotations`),
      createAnnotation: (reviewId, body) => http.post(`/lawyers/me/reviews/${reviewId}/annotations`, { body }),
      patchAnnotation: (reviewId, annId, body) => http.patch(`/lawyers/me/reviews/${reviewId}/annotations/${annId}`, { body }),
      deleteAnnotation: (reviewId, annId) => http.del(`/lawyers/me/reviews/${reviewId}/annotations/${annId}`),
      chat: (reviewId, params) => http.get(`/reviews/${reviewId}/chat`, { params }),
      sendChat: (reviewId, body) => http.post(`/reviews/${reviewId}/chat`, { body }),
      clientHistory: (reviewId, params) => http.get(`/lawyers/me/reviews/${reviewId}/client-history`, { params }),
      historyDocument: (reviewId, documentId) => http.get(`/lawyers/me/reviews/${reviewId}/client-history/${documentId}`),
      saveDraft: (reviewId, body) => http.patch(`/lawyers/me/reviews/${reviewId}/draft`, { body }),
      deliver: (reviewId, body) => http.post(`/lawyers/me/reviews/${reviewId}/deliver`, { body }),
      feesOverview: () => http.get("/lawyers/me/fees/overview"),
      feesEntries: (params) => http.get("/lawyers/me/fees/entries", { params }),
      feesSettlements: (params) => http.get("/lawyers/me/fees/settlements", { params }),
      downloadSettlement: (settlementId) => http.post(`/lawyers/me/fees/settlements/${settlementId}/download`),
    },

    /* ── §21 Admin · red de revisores ─────────────────────────────── */
    adminReviewers: {
      lawyers: (params) => http.get("/admin/lawyers", { params }),
      patchVerification: (lawyerId, body) => http.patch(`/admin/lawyers/${lawyerId}/verification`, { body }),
      rates: () => http.get("/admin/lawyer-rates"),
      putRates: (body) => http.put("/admin/lawyer-rates", { body }),
      overview: (params) => http.get("/admin/reviewers/overview", { params }),
      reviews: (params) => http.get("/admin/reviews", { params }),
      assign: (reviewId, body) => http.post(`/admin/reviews/${reviewId}/assign`, { body }),
      reassign: (reviewId, body) => http.patch(`/admin/reviews/${reviewId}/assignment`, { body }),
      lawyerDetail: (lawyerId) => http.get(`/admin/lawyers/${lawyerId}`),
      patchLawyer: (lawyerId, body) => http.patch(`/admin/lawyers/${lawyerId}`, { body }),
      suspendLawyer: (lawyerId, body) => http.post(`/admin/lawyers/${lawyerId}/suspend`, { body }),
    },
  };

  return api;
}
