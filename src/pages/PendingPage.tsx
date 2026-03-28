import { adminTheme } from "../ui/adminTheme";

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
          Tu usuario no está asignado a ninguna empresa.
        </p>
      </div>
    </div>
  );
}