/* Consola de administración y portal del vendedor Justiniano.
   Guard de rutas privadas: sin token → /login; el rol del JWT decide qué
   módulos se muestran (admin: todo · seller: solo Ventas propias). */
import React from "react";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { api } from "./api.js";
import { getSession } from "./lib/session.js";
import Shell, { PeriodProvider } from "./components/Shell.jsx";
import Login from "./screens/Login.jsx";
import Dashboard from "./screens/Dashboard.jsx";
import DashDetail from "./screens/DashDetail.jsx";
import Plans from "./screens/Plans.jsx";
import PlanUsers from "./screens/PlanUsers.jsx";
import Ops from "./screens/Ops.jsx";
import Reviewers from "./screens/Reviewers.jsx";
import ReviewerDetail from "./screens/ReviewerDetail.jsx";
import SalesAdmin from "./screens/SalesAdmin.jsx";
import SellerPortal from "./screens/SellerPortal.jsx";

/* Ruta privada: exige sesión (y opcionalmente rol admin) */
function Private({ admin = false, children }) {
  const location = useLocation();
  if (!api.auth.isLoggedIn()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  const session = getSession();
  if (admin && session?.role !== "admin") return <Navigate to="/ventas" replace />;
  return <Shell>{children}</Shell>;
}

/* Inicio según rol (réplica del wireframe: admin → dashboard, seller → ventas) */
function Home() {
  if (!api.auth.isLoggedIn()) return <Navigate to="/login" replace />;
  const session = getSession();
  return <Navigate to={session?.role === "admin" ? "/dash" : "/ventas"} replace />;
}

/* Ventas: consola completa para admin, portal propio para el vendedor */
function Sales() {
  const session = getSession();
  return session?.role === "admin" ? <SalesAdmin /> : <SellerPortal />;
}

export default function App() {
  return (
    <HashRouter>
      <PeriodProvider>
        <Routes>
          <Route path="/login" element={
            api.auth.isLoggedIn() ? <Home /> : <Login />
          } />
          <Route path="/" element={<Home />} />
          <Route path="/dash" element={<Private admin><Dashboard /></Private>} />
          <Route path="/dash/:metric" element={<Private admin><DashDetail /></Private>} />
          <Route path="/planes" element={<Private admin><Plans /></Private>} />
          <Route path="/planes/:planId/usuarios" element={<Private admin><PlanUsers /></Private>} />
          <Route path="/operacion" element={<Private admin><Ops /></Private>} />
          <Route path="/revisores" element={<Private admin><Reviewers /></Private>} />
          <Route path="/revisores/:lawyerId" element={<Private admin><ReviewerDetail /></Private>} />
          <Route path="/ventas" element={<Private><Sales /></Private>} />
          <Route path="*" element={<Home />} />
        </Routes>
      </PeriodProvider>
    </HashRouter>
  );
}
