import React from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { api } from "./api.js";

import Shell, { ShellBare } from "./components/Shell.jsx";
import Landing from "./screens/Landing.jsx";
import Signup from "./screens/Signup.jsx";
import VerifyEmail from "./screens/VerifyEmail.jsx";
import VerifyPhone from "./screens/VerifyPhone.jsx";
import Onboarding from "./screens/Onboarding.jsx";
import Login from "./screens/Login.jsx";
import Dashboard from "./screens/Dashboard.jsx";
import Agents from "./screens/Agents.jsx";
import Chats from "./screens/Chats.jsx";
import Chat from "./screens/Chat.jsx";
import Docs from "./screens/Docs.jsx";
import DocView from "./screens/DocView.jsx";
import Reviews from "./screens/Reviews.jsx";
import Plans, { PlansPublic } from "./screens/Plans.jsx";
import Settings from "./screens/Settings.jsx";

/** Guard de rutas privadas: sin sesión → /login. */
function RequireAuth({ children }) {
  if (!api.auth.isLoggedIn()) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        {/* Públicas */}
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/verificar-correo" element={<VerifyEmail />} />
        <Route path="/verificar-telefono" element={<VerifyPhone />} />
        <Route path="/login" element={<Login />} />
        <Route path="/planes" element={<PlansPublic />} />

        {/* Onboarding: requiere sesión pero no shell */}
        <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />

        {/* Privadas con shell (topbar + sidebar) */}
        <Route element={<RequireAuth><Shell /></RequireAuth>}>
          <Route path="/app" element={<Dashboard />} />
          <Route path="/app/agentes" element={<Agents />} />
          <Route path="/app/consultas" element={<Chats />} />
          <Route path="/app/documentos" element={<Docs />} />
          <Route path="/app/documentos/:id" element={<DocView />} />
          <Route path="/app/revisiones" element={<Reviews />} />
          <Route path="/app/planes" element={<Plans />} />
          <Route path="/app/ajustes" element={<Settings />} />
        </Route>

        {/* Chat a pantalla completa (sin container) */}
        <Route element={<RequireAuth><ShellBare /></RequireAuth>}>
          <Route path="/app/consultas/:id" element={<Chat />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
