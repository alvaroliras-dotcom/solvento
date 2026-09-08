
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PUSH_ENDPOINT = `${SUPABASE_URL}/functions/v1/send_push_notification`;
const TIMEZONE = "Europe/Madrid";

// Incidencias encendidas. Para activar las de puntualidad,
// basta con anadir su nombre a esta lista.
const INCIDENCIAS_ACTIVAS = new Set([
  "missing_checkin",
  "missing_lunch_checkout",
  "missing_afternoon_checkin",
  "missing_final_checkout",
]);

const CREADOR: Record<string, string> = {
  missing_checkin: "create_missing_checkin_incident",
  missing_lunch_checkout: "create_missing_lunch_checkout_incident",
  missing_afternoon_checkin: "create_missing_afternoon_checkin_incident",
  missing_final_checkout: "create_missing_final_checkout_incident",
  late_checkin: "create_late_checkin_incident",
  late_lunch_checkout: "create_late_lunch_checkout_incident",
  late_afternoon_checkin: "create_late_afternoon_checkin_incident",
  late_final_checkout: "create_late_final_checkout_incident",
};

const DETECTORES = [
  "get_long_open_shift_notifications",
  "get_missing_checkin_notifications",
  "get_missing_lunch_checkout_notifications",
  "get_missing_lunch_checkin_notifications",
  "get_missing_final_checkout_notifications",
] as const;

function madridHoy(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function madridHora() {
  const p = new Intl.DateTimeFormat("es-ES", {
    timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  return {
    hora: p.find((x) => x.type === "hour")?.value ?? "00",
    minuto: p.find((x) => x.type === "minute")?.value ?? "00",
  };
}

function mensajePara(tipo: string) {
  switch (tipo) {
    case "missing_checkin_warning_1":
      return "Todavía no has fichado tu entrada.";
    case "missing_checkin_warning_2":
      return "Segundo aviso: sigue sin constar tu fichaje de entrada.";
    case "missing_lunch_checkout_warning_1":
      return "Puede que hayas olvidado fichar la salida de comida.";
    case "missing_lunch_checkin_warning_1":
      return "Puede que hayas olvidado fichar la vuelta de comida.";
    case "missing_final_checkout_warning_1":
      return "Puede que hayas olvidado fichar tu salida final.";
    default:
      return "Llevas muchas horas con la jornada abierta. Revisa si falta fichar la salida.";
  }
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const hoy = madridHoy();
  const { hora, minuto } = madridHora();

  const avisos: Array<Record<string, unknown>> = [];
  const incidencias: Array<Record<string, unknown>> = [];
  const saltados: Array<Record<string, unknown>> = [];

  const { data: altas, error: errorAltas } = await supabase
    .from("memberships")
    .select("company_id, user_id")
    .eq("status", "active");

  if (errorAltas) {
    return new Response(JSON.stringify({ ok: false, error: errorAltas.message }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const usuariosDeAlta = new Set((altas ?? []).map((m) => m.user_id as string));
  const empresas = [...new Set((altas ?? []).map((m) => m.company_id as string))];

  if (empresas.length === 0) {
    return new Response(JSON.stringify({ ok: true, date: hoy, procesados: 0 }),
      { headers: { "Content-Type": "application/json" } });
  }

  const { data: ausencias, error: errorAusencias } = await supabase
    .from("worker_absences")
    .select("user_id, absence_type")
    .lte("start_date", hoy)
    .gte("end_date", hoy);

  if (errorAusencias) {
    return new Response(JSON.stringify({ ok: false, error: errorAusencias.message }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const ausentesHoy = new Map<string, string>();
  for (const a of ausencias ?? []) {
    ausentesHoy.set(a.user_id as string, a.absence_type as string);
  }

  function motivoSalto(userId: string) {
    if (!usuariosDeAlta.has(userId)) return "Trabajador dado de baja";
    if (ausentesHoy.has(userId)) return `Ausencia hoy (${ausentesHoy.get(userId)})`;
    return null;
  }

  // ---------- AVISOS AL MOVIL ----------

  let procesados = 0;

  for (const empresa of empresas) {
    const candidatos: Array<Record<string, any>> = [];

    for (const detector of DETECTORES) {
      const { data, error } = await supabase.rpc(detector, { p_company_id: empresa });
      if (error) {
        avisos.push({ detector, empresa, ok: false, error: error.message });
        continue;
      }
      candidatos.push(...(data ?? []));
    }

    for (const item of candidatos) {
      const salto = motivoSalto(item.user_id);
      if (salto) {
        saltados.push({ user_id: item.user_id, tipo: item.notification_type, motivo: salto });
        continue;
      }

      procesados += 1;

      const res = await fetch(PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          company_id: item.company_id,
          user_id: item.user_id,
          notification_type: item.notification_type,
          reference_date: item.reference_date,
          reference_slot: item.reference_slot,
          title: "Cerbero",
          body: mensajePara(item.notification_type),
        }),
      });

      avisos.push({
        user_id: item.user_id,
        tipo: item.notification_type,
        status: res.status,
        respuesta: await res.text(),
      });
    }
  }

  // ---------- INCIDENCIAS ----------
  // No dependen de que el aviso haya llegado al movil.
  // Las funciones que las crean no duplican dentro del mismo dia.

  for (const empresa of empresas) {
    const { data: candidatos, error } = await supabase.rpc(
      "get_incident_candidates",
      { p_company_id: empresa },
    );

    if (error) {
      incidencias.push({ empresa, ok: false, error: error.message });
      continue;
    }

    for (const c of candidatos ?? []) {
      if (!INCIDENCIAS_ACTIVAS.has(c.incident_type)) continue;

      const salto = motivoSalto(c.user_id);
      if (salto) {
        saltados.push({ user_id: c.user_id, tipo: c.incident_type, motivo: salto });
        continue;
      }

      const creador = CREADOR[c.incident_type];
      if (!creador) continue;

      const args: Record<string, unknown> = {
        p_company_id: c.company_id,
        p_user_id: c.user_id,
      };
      if (c.incident_type.startsWith("late_")) {
        args.p_time_entry_id = c.time_entry_id;
      }

      const { error: errorIncidencia } = await supabase.rpc(creador, args);

      incidencias.push({
        user_id: c.user_id,
        tipo: c.incident_type,
        creada: !errorIncidencia,
        error: errorIncidencia?.message ?? null,
      });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      fecha: hoy,
      hora_madrid: `${hora}:${minuto}`,
      empresas: empresas.length,
      avisos_procesados: procesados,
      avisos,
      incidencias,
      saltados,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
