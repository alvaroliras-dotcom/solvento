import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate, useLocation } from "react-router-dom";
import { useActiveMembership } from "../app/useActiveMembership";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);

  const {
    membership,
    loading: membershipLoading,
    error: membershipError,
  } = useActiveMembership();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate("/login", { replace: true });
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) {
          navigate("/login", { replace: true });
        }
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [navigate]);

  if (loading || membershipLoading) return <div>Cargando...</div>;

  // Un fallo al comprobar el acceso no es lo mismo que no tener empresa.
  // Mandar aqui al trabajador a "acceso pendiente" le dejaba sin poder
  // fichar y sin ninguna salida.
  if (membershipError) {
    return (
      <div style={{ padding: 24, display: "grid", gap: 12, justifyItems: "start" }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>
          No se ha podido comprobar tu acceso
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.5 }}>
          Suele ser un problema de conexion. Vuelve a intentarlo; si sigue sin
          entrar, avisa a administracion.
        </div>
        <button type="button" onClick={() => window.location.reload()}>
          Reintentar
        </button>
        <button
          type="button"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate("/login", { replace: true });
          }}
        >
          Cerrar sesion
        </button>
      </div>
    );
  }

  if (!membership) {
    navigate("/pending", { replace: true });
    return null;
  }

  // 🔒 Protección por rol
  if (location.pathname.startsWith("/admin")) {
    if (membership.role === "employee") {
      navigate("/worker", { replace: true });
      return null;
    }
  }

  if (location.pathname.startsWith("/worker")) {
    if (membership.role !== "employee") {
      navigate("/admin", { replace: true });
      return null;
    }
  }

  return <>{children}</>;
}
