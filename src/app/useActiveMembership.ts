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
  const [error, setError] = useState<string | null>(null);

  // Antes, si esta consulta fallaba, el error se descartaba sin mas y el
  // usuario se quedaba "sin empresa". La aplicacion lo mandaba entonces a
  // la pantalla de acceso pendiente, que no tiene ningun boton, y el
  // trabajador se quedaba encerrado sin poder fichar por un simple
  // tropiezo de conexion. Ahora se distingue "no tiene empresa" de "no he
  // podido preguntarlo".
  useEffect(() => {
    let cancelado = false;

    (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc("my_memberships");
        if (cancelado) return;

        if (rpcError) {
          setError(rpcError.message);
        } else if (data && data.length > 0) {
          setMembership(data[0]);
        }
      } catch {
        if (!cancelado) setError("No se ha podido conectar.");
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  return { membership, loading, error };
}
