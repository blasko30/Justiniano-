import React from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api.js";
import { LawyerProvider } from "./components/LawyerContext.jsx";
import Shell from "./components/Shell.jsx";
import Login from "./screens/Login.jsx";
import Registro from "./screens/Registro.jsx";
import Panel from "./screens/Panel.jsx";
import Requerimientos from "./screens/Requerimientos.jsx";
import Caso from "./screens/Caso.jsx";
import Honorarios from "./screens/Honorarios.jsx";
import Perfil from "./screens/Perfil.jsx";

/** Guard de rutas privadas: sin token → /login. */
function RequireAuth({ children }) {
  const location = useLocation();
  if (!api.auth.isLoggedIn()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/registro" element={<Registro />} />
        <Route
          element={(
            <RequireAuth>
              <LawyerProvider>
                <Shell />
              </LawyerProvider>
            </RequireAuth>
          )}
        >
          <Route path="/" element={<Panel />} />
          <Route path="/requerimientos" element={<Requerimientos />} />
          <Route path="/caso/:id" element={<Caso />} />
          <Route path="/honorarios" element={<Honorarios />} />
          <Route path="/perfil" element={<Perfil />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
