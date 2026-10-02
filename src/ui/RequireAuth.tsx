import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveMembership } from "../app/useActiveMembership";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [sessionState, setSessionState] = useState<"loading" | "in" | "out">(
    "loading",
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionState(data.session ? "in" : "out");
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) {
          // Al salir se olvida todo lo cargado, para que otra persona en el
          // mismo dispositivo no vea datos del anterior.
          queryClient.clear();
          setSessionState("out");
        }
      },
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [queryClient]);

  const {
    membership,
    loading: membershipLoading,
    error: membershipError,
  } = useActiveMembership();

  if (sessionState === "out") return <Navigate to="/login" replace />;
  if (sessionState === "loading" || membershipLoading) return <div>Cargando...</div>;

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

  if (!membership) return <Navigate to="/pending" replace />;

  // Proteccion por rol: el panel solo para owner/admin; la pantalla de
  // fichar solo para empleados. (La seguridad de verdad esta en la base de
  // datos; esto solo evita que cada uno acabe en la pantalla que no es.)
  const esAdmin = membership.role === "owner" || membership.role === "admin";

  if (location.pathname.startsWith("/admin") && !esAdmin) {
    return <Navigate to="/worker" replace />;
  }

  if (location.pathname.startsWith("/worker") && esAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
}
