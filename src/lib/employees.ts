import { supabase } from "./supabaseClient";

// Altas, bajas, reactivaciones y cambios de PIN. Lo hace la Edge Function
// admin_manage_employee con permisos de servidor; aqui solo se la llama y
// se devuelve un mensaje que se pueda ensenar tal cual.

type Resultado = { ok: true; reactivado?: boolean } | { ok: false; error: string };

async function llamar(body: Record<string, unknown>): Promise<Resultado> {
  const { data, error } = await supabase.functions.invoke("admin_manage_employee", { body });

  if (error) {
    // Respuestas 401/403/500: el cuerpo trae el mensaje en espanol.
    try {
      const ctx = (error as { context?: Response }).context;
      const json = ctx ? await ctx.json() : null;
      if (json?.error) return { ok: false, error: String(json.error) };
    } catch {
      // sin cuerpo legible
    }
    const msg = error.message || "";
    return {
      ok: false,
      error: /fetch|network/i.test(msg)
        ? "No hay conexión. No se ha hecho ningún cambio."
        : msg || "No se ha podido completar.",
    };
  }

  if (data?.ok) return { ok: true, reactivado: !!data.reactivado };
  return { ok: false, error: String(data?.error ?? "No se ha podido completar.") };
}

export function darDeAlta(fullName: string, email: string, pin: string) {
  return llamar({ action: "alta", full_name: fullName, email, pin });
}

export function darDeBaja(userId: string, reason: string) {
  return llamar({ action: "baja", user_id: userId, reason });
}

export function reactivar(userId: string, pin: string) {
  return llamar({ action: "reactivar", user_id: userId, pin });
}

export function cambiarPin(userId: string, pin: string) {
  return llamar({ action: "cambiar_pin", user_id: userId, pin });
}

export function generarPin(cifras = 6) {
  const valores = new Uint32Array(cifras);
  crypto.getRandomValues(valores);
  return Array.from(valores, (v) => String(v % 10)).join("");
}
