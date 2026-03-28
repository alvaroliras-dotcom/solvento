import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./ui/uikit.css";
import "./ui/admin-theme.css";
import "./ui/admin-components.css";

import { App } from "./app/App";
import { AppProviders } from "./app/providers";

async function bootstrap() {
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      console.log("[sw] registrado", registration);
    } catch (error) {
      console.error("[sw] error registrando service worker", error);
    }
  } else {
    console.warn("[sw] serviceWorker no soportado en este navegador");
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </React.StrictMode>
  );
}

bootstrap();