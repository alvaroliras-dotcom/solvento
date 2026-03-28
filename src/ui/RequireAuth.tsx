import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate, useLocation } from "react-router-dom";
import { useActiveMembership } from "../app/useActiveMembership";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);

  const { membership, loading: membershipLoading } = useActiveMembership();

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