import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient";

export type Membership = {
  id: string;
  company_id: string;
  role: "owner" | "admin" | "employee";
  job_type: "fixed" | "mobile";
  horario_referencia: string | null;
  margen_tolerancia_minutos: number;
};

export const MEMBERSHIP_QUERY_KEY = ["my_memberships"] as const;

export async function fetchMyMembership(): Promise<Membership | null> {
  const { data, error } = await supabase.rpc("my_memberships");
  if (error) throw error;
  const rows = (data ?? []) as Membership[];
  // Si alguien tuviera alta en varias empresas, se prioriza la de
  // administracion para no dejarle fuera del panel.
  return (
    rows.find((m) => m.role === "owner" || m.role === "admin") ?? rows[0] ?? null
  );
}

// Antes cada pantalla (y cada componente) volvia a preguntar su empresa al
// servidor: 3 o 4 llamadas por pantalla, y si una fallaba se mostraba "no
// hay empresa". Ahora se pregunta una vez y se comparte.
//
// Tambien se distingue "no tiene empresa" de "no he podido preguntarlo":
// confundirlos mandaba al trabajador a "acceso pendiente" por un simple
// tropiezo de conexion.
export function useActiveMembership() {
  const query = useQuery({
    queryKey: MEMBERSHIP_QUERY_KEY,
    queryFn: fetchMyMembership,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  return {
    membership: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? (query.error as Error).message || "No se ha podido conectar." : null,
  };
}
