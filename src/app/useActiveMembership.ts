import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Membership = {
  id: string;
  company_id: string;
  role: "owner" | "admin" | "employee";
  job_type: "fixed" | "mobile";
  horario_referencia: string | null;
  margen_tolerancia_minutos: number;
};

export function useActiveMembership() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.rpc("my_memberships").then(({ data, error }) => {
      if (!error && data && data.length > 0) {
        setMembership(data[0]);
      }
      setLoading(false);
    });
  }, []);

  return { membership, loading };
}