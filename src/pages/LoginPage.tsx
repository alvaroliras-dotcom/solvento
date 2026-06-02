import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate } from "react-router-dom";
import { adminTheme } from "../ui/adminTheme";

// Clave con la que se guarda el correo recordado en este dispositivo.
const REMEMBER_KEY = "cerbero_saved_email";

export function LoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pinRef = useRef<HTMLInputElement>(null);

  // Al cargar la pantalla, recuperamos el usuario guardado en este dispositivo (si lo hay).
  useEffect(() => {
    const saved = localStorage.getItem(REMEMBER_KEY);
    if (saved) {
      setEmail(saved);
      setRemember(true);
      // Si ya tenemos el correo, llevamos el foco directo al PIN.
      setTimeout(() => pinRef.current?.focus(), 100);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    const cleanPin = pin.trim();

    if (!cleanEmail) {
      setError("Introduce tu correo electrónico.");
      return;
    }

    if (!cleanPin || cleanPin.length < 4) {
      setError("PIN inválido.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: cleanPin,
    });

    if (error) {
      setLoading(false);
      setError("Correo o PIN incorrectos.");
      return;
    }

    // Guardamos (o borramos) el usuario recordado en este dispositivo.
    // OJO: solo se guarda el CORREO, nunca el PIN.
    if (remember) {
      localStorage.setItem(REMEMBER_KEY, cleanEmail);
    } else {
      localStorage.removeItem(REMEMBER_KEY);
    }

    const { data: memberships, error: membershipsError } = await supabase.rpc("my_memberships");

    setLoading(false);

    if (membershipsError) {
      setError("No se pudo cargar tu acceso.");
      return;
    }

    if (!memberships || memberships.length === 0) {
      navigate("/pending", { replace: true });
      return;
    }

    const role = memberships[0].role;
    navigate(role === "employee" ? "/worker" : "/admin", { replace: true });
  }

  return (
    <div
      className="loginPage"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        overflow: "auto",
        background: `linear-gradient(180deg, ${adminTheme.colors.primary} 0%, ${adminTheme.colors.primarySoft} 60%, ${adminTheme.colors.pageBg} 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: adminTheme.colors.panelBg,
          borderRadius: 18,
          boxShadow: adminTheme.shadow.lg,
          padding: 24,
          border: `1px solid ${adminTheme.colors.border}`,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <img
            src={adminTheme.logos.main}
            alt={adminTheme.brandName}
            style={{
              height: 92,
              width: "auto",
              maxWidth: "100%",
              display: "inline-block",
            }}
          />
        </div>

        <div
          style={{
            textAlign: "center",
            fontSize: 14,
            color: adminTheme.colors.textSoft,
            fontWeight: 600,
          }}
        >
          Acceso con correo y PIN
        </div>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
          <input
            type="email"
            autoComplete="email"
            placeholder="Correo electrónico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              padding: 16,
              fontSize: 16,
              borderRadius: 12,
              border: `1px solid ${adminTheme.colors.border}`,
              outline: "none",
              textAlign: "left",
              background: adminTheme.colors.panelSoft,
              color: adminTheme.colors.text,
              fontWeight: 700,
              boxSizing: "border-box",
            }}
          />

          <input
            ref={pinRef}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            style={{
              padding: 16,
              fontSize: 18,
              borderRadius: 12,
              border: `1px solid ${adminTheme.colors.border}`,
              outline: "none",
              textAlign: "center",
              background: adminTheme.colors.panelSoft,
              color: adminTheme.colors.text,
              fontWeight: 700,
              boxSizing: "border-box",
            }}
          />

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: adminTheme.colors.textSoft,
              fontWeight: 600,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ width: 18, height: 18, cursor: "pointer" }}
            />
            Recordar mi usuario en este dispositivo
          </label>

          <button
            disabled={loading}
            style={{
              padding: 16,
              fontSize: 16,
              fontWeight: 800,
              borderRadius: 12,
              border: `1px solid ${adminTheme.colors.primary}`,
              background: adminTheme.colors.primary,
              color: adminTheme.colors.textOnPrimary,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>

          {error && (
            <div
              style={{
                color: adminTheme.colors.danger,
                fontSize: 13,
                textAlign: "center",
                background: adminTheme.colors.dangerSoft,
                padding: 10,
                borderRadius: 10,
                border: `1px solid ${adminTheme.colors.danger}`,
                fontWeight: 700,
              }}
            >
              {error}
            </div>
          )}
        </form>

        <div
          style={{
            textAlign: "center",
            fontSize: 12,
            color: adminTheme.colors.textMuted,
          }}
        >
          Introduce tu correo corporativo y el PIN facilitado por administración.
        </div>

        <div
          style={{
            marginTop: 10,
            paddingTop: 16,
            borderTop: `1px solid ${adminTheme.colors.border}`,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <img
            src={adminTheme.logos.secondary}
            alt="Cerbero"
            style={{
              height: 110,
              width: "auto",
              maxWidth: "100%",
              display: "block",
            }}
          />
        </div>
      </div>
    </div>
  );
}
