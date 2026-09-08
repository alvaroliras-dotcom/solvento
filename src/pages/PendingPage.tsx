import { adminTheme } from "../ui/adminTheme";
import { supabase } from "../lib/supabaseClient";

// ======================================================
// PARTE 1/3 — COMPONENTE
// ======================================================

export function PendingPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        background: `linear-gradient(180deg, ${adminTheme.colors.primary} 0%, ${adminTheme.colors.primarySoft} 60%, ${adminTheme.colors.pageBg} 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: adminTheme.colors.panelBg,
          border: `1px solid ${adminTheme.colors.border}`,
          borderRadius: 18,
          boxShadow: adminTheme.shadow.lg,
          padding: 24,
          display: "grid",
          gap: 12,
        }}
      >
        {/* ====================================================== */}
        {/* PARTE 2/3 — CABECERA */}
        {/* ====================================================== */}
        <h2
          style={{
            margin: 0,
            fontSize: 24,
            fontWeight: 900,
            color: adminTheme.colors.text,
          }}
        >
          Acceso pendiente
        </h2>

        {/* ====================================================== */}
        {/* PARTE 3/3 — MENSAJE */}
        {/* ====================================================== */}
        <p
          style={{
            margin: 0,
            fontSize: 15,
            lineHeight: 1.5,
            color: adminTheme.colors.textSoft,
            fontWeight: 600,
          }}
        >
          Tu usuario no está asignado a ninguna empresa. Si crees que es un
          error, avisa a administración.
        </p>

        {/* Esta pantalla era un callejón sin salida: sin ningún botón, quien
            llegaba aquí por error no podía ni reintentar ni salir. */}
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            border: `1px solid ${adminTheme.colors.border}`,
            background: adminTheme.colors.panelBg,
            color: adminTheme.colors.text,
            borderRadius: 12,
            padding: "12px 16px",
            fontWeight: 900,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          Reintentar
        </button>

        <button
          type="button"
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.replace("/login");
          }}
          style={{
            border: "none",
            background: "transparent",
            color: adminTheme.colors.textSoft,
            fontWeight: 800,
            fontSize: 14,
            cursor: "pointer",
            padding: 4,
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
