import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { getUserMemberships } from "./companies.api";

export const useActiveCompany = () => {
  const [activeCompany, setActiveCompany] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"ok" | "no-auth" | "pending" | "error">(
    "ok"
  );
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadCompany = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data.user;

        if (!user) {
          setStatus("no-auth");
          setMessage("No hay usuario autenticado.");
          setLoading(false);
          return;
        }

        const memberships = await getUserMemberships(user.id);

        if (!memberships || memberships.length === 0) {
          // ✅ Esto NO es un error técnico en tu modelo: es "pendiente de alta"
          setStatus("pending");
          setMessage(
            "Tu cuenta está creada, pero todavía no estás asignado a ninguna empresa. Contacta con el administrador (owner/RRHH) para que te dé acceso."
          );
          setLoading(false);
          return;
        }

        setActiveCompany(memberships[0].company_id);
        setStatus("ok");
        setMessage(null);
        setLoading(false);
      } catch (e: any) {
        setStatus("error");
        setMessage(e?.message ?? "Error cargando empresa");
        setLoading(false);
      }
    };

    loadCompany();
  }, []);

  return { activeCompany, loading, status, message };
};