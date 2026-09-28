import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errCode, errMsg, money, limitLabel, DISCLAIMER_GLOBAL } from "../lib/format.js";
import { PageHead, PublicTopbar } from "../components/Shell.jsx";

function planFeatures(limits = {}) {
  const f = [];
  f.push(`${limitLabel(limits.questions_month)} consultas al mes`);
  f.push(`${limitLabel(limits.documents_month, "Ilimitados")} documentos al mes`);
  f.push(`${limitLabel(limits.agents, "Todos los")} agentes disponibles`);
  if (limits.seats !== undefined) f.push(`${limitLabel(limits.seats, "Ilimitados")} usuario(s)`);
  if (limits.history_months) f.push(`Historial de ${limits.history_months} meses`);
  if (limits.support_hours) f.push(`${limits.support_hours} h de soporte al mes`);
  return f;
}

function PlansContent() {
  const navigate = useNavigate();
  const toast = useToast();
  const logged = api.auth.isLoggedIn();

  const [plans, setPlans] = useState(null);
  const [sub, setSub] = useState(null);
  const [packs, setPacks] = useState([]);
  const [annual, setAnnual] = useState(false);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let alive = true;
    const jobs = [api.billing.plans()];
    if (logged) jobs.push(api.billing.subscription(), api.billing.creditPacks());
    Promise.allSettled(jobs).then(([p, s, cp]) => {
      if (!alive) return;
      if (p.status === "fulfilled") setPlans(p.value.items || []);
      else { setPlans([]); toast(errMsg(p.reason), "err"); }
      if (s?.status === "fulfilled") setSub(s.value);
      if (cp?.status === "fulfilled") setPacks(cp.value.items || []);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (p) => {
    if (!logged) { navigate("/signup"); return; }
    if (p.corporate || p.contact_sales) {
      window.location.href = "mailto:ventas@justiniano.cl?subject=Plan%20Corporativo%20Justiniano";
      return;
    }
    setBusy(p.id);
    try {
      const r = await api.billing.checkoutPlan({ plan_id: p.id, billing_cycle: annual ? "annual" : "monthly" });
      if (r?.checkout_url) window.location.href = r.checkout_url;
    } catch (e) {
      if (errCode(e) === "already_subscribed") toast("Ya tiene ese plan activo", "info");
      else toast(errMsg(e), "err");
    } finally {
      setBusy("");
    }
  };

  const buyPack = async (pack) => {
    setBusy(pack.id);
    try {
      const r = await api.billing.checkoutCredits({ pack_id: pack.id });
      if (r?.checkout_url) window.location.href = r.checkout_url;
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy("");
    }
  };

  if (plans === null) {
    return <div className="center" style={{ padding: 40 }}><Spinner size={28} /></div>;
  }

  const popularId = plans.find((p) => !p.corporate && (p.price_monthly_clp || 0) > 0 && p.limits?.agents >= 6)?.id
    || plans[Math.min(2, plans.length - 1)]?.id;

  return (
    <>
      <div className="row" style={{ justifyContent: "center", marginBottom: 20 }}>
        <div className="row" style={{ background: "var(--bg-sunken)", padding: 4, borderRadius: 99, gap: 2, border: "1px solid var(--border)" }}>
          <button className={`btn sm ${!annual ? "primary" : "ghost"}`} style={{ borderRadius: 99 }} onClick={() => setAnnual(false)}>
            Mensual
          </button>
          <button className={`btn sm ${annual ? "primary" : "ghost"}`} style={{ borderRadius: 99 }} onClick={() => setAnnual(true)}>
            Anual · 2 meses gratis
          </button>
        </div>
      </div>

      <div className="plans" style={{ gridTemplateColumns: `repeat(${Math.min(plans.length, 3) || 1},1fr)` }}>
        {plans.map((p) => {
          const price = annual ? p.price_annual_clp : p.price_monthly_clp;
          const current = sub && (sub.plan === p.id);
          const hi = p.id === popularId;
          return (
            <div className={`plan ${hi ? "hi" : ""}`} key={p.id}>
              {hi ? <span className="ribbon">Más elegido</span> : null}
              <h3 style={{ fontSize: 17 }}>{p.name}</h3>
              <div className="price">
                {p.corporate ? "A medida" : price === 0 ? "Gratis" : money(price)}
                <small>
                  {p.corporate || price === 0 ? "" : annual ? "/año" : "/mes"}
                </small>
              </div>
              <ul>
                {planFeatures(p.limits).map((f) => <li key={f}>{f}</li>)}
              </ul>
              <button
                className={`btn ${hi ? "primary" : "gold"} block`}
                disabled={current || busy === p.id || (!p.corporate && price === 0 && logged)}
                onClick={() => choose(p)}
              >
                {busy === p.id ? <Spinner size={16} /> : current ? "Plan actual"
                  : p.corporate ? "Hablar con ventas"
                    : price === 0 ? (logged ? "Plan actual" : "Comenzar gratis") : "Elegir plan"}
              </button>
            </div>
          );
        })}
      </div>

      {logged && packs.length > 0 && (
        <div className="card pad-lg" style={{ marginTop: 26 }}>
          <h2 style={{ marginBottom: 4 }}>Créditos de revisión humana</h2>
          <p className="muted" style={{ marginBottom: 16 }}>
            Cada crédito equivale a una revisión de abogado sobre un documento o respuesta.
          </p>
          <div className="threecol">
            {packs.map((c) => (
              <div className="card pad row" key={c.id} style={{ justifyContent: "space-between", background: "var(--bg-sunken)" }}>
                <div>
                  <b style={{ fontSize: 16 }}>{c.credits} {c.credits === 1 ? "crédito" : "créditos"}</b>
                  <div className="subtle">{money(Math.round(c.price_clp / c.credits))} c/u</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <b>{money(c.price_clp)}</b>
                  <button className="btn sm gold" style={{ marginTop: 6, display: "block" }}
                    disabled={busy === c.id} onClick={() => buyPack(c)}>
                    {busy === c.id ? <Spinner size={14} /> : "Comprar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="subtle center" style={{ marginTop: 22 }}>{DISCLAIMER_GLOBAL}</p>
    </>
  );
}

/** Vista privada (dentro del shell) */
export default function Plans() {
  return (
    <>
      <PageHead title="Planes y precios" sub="Cambie o cancele cuando quiera" />
      <PlansContent />
    </>
  );
}

/** Vista pública (landing → Planes) */
export function PlansPublic() {
  return (
    <>
      <PublicTopbar />
      <main className="main fadein">
        <div className="container">
          <PageHead title="Planes y precios" sub="Cambie o cancele cuando quiera" />
          <PlansContent />
        </div>
      </main>
    </>
  );
}
