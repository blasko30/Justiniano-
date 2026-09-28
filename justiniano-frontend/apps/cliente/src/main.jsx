import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, ToastProvider } from "@justiniano/ui";
import "@justiniano/ui/styles/shared.css";
import "./styles/app.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>
);
