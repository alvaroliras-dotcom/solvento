import { supabase } from "../../lib/supabaseClient";
import type { TimeEntry } from "./timeEntries.types";

// ======================================================
// FICHAJE
//
// Toda la logica vive en el servidor (create_checkin_server_time y
// create_checkout_server_time): la hora es la del servidor, la geovalla se
// lee de company_geofence y el servidor decide si un tramo es incidencia
// (fuera del centro, mas de dos tramos al dia, mas de 7 o 10 horas, cambio
// de dia, tramo de menos de 2 minutos). El movil solo manda la ubicacion.
//
// Antes estas reglas se calculaban aqui, con el reloj del movil y unas
// coordenadas escritas a mano, y el servidor se fiaba de lo que llegaba.
// ======================================================

type GeoInput = {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string;
};

export async function getOpenEntry(companyId: string, userId: string) {
  const { data, error } = await supabase
    .from("time_entries")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .is("check_out_at", null)
    .order("check_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as TimeEntry | null;
}

export async function createCheckIn(
  companyId: string,
  userId: string,
  geo?: GeoInput | null
) {
  const { data, error } = await supabase.rpc("create_checkin_server_time", {
    p_company_id: companyId,
    p_user_id: userId,
    p_status: "open",
    p_workflow_status: "auto",
    p_flags: { has_check_in_geolocation: !!geo },
    p_check_in_geo_lat: geo?.lat ?? null,
    p_check_in_geo_lng: geo?.lng ?? null,
    p_check_in_geo_accuracy_m: geo?.accuracy ?? null,
    p_check_in_geo_captured_at: geo?.capturedAt ?? null,
  });

  if (error) throw error;
  return data as TimeEntry;
}

export async function createCheckOut(entryId: string, geo?: GeoInput | null) {
  const { data, error } = await supabase.rpc("create_checkout_server_time", {
    p_entry_id: entryId,
    p_status: "closed",
    p_workflow_status: "auto",
    p_flags: { has_check_out_geolocation: !!geo },
    p_check_out_geo_lat: geo?.lat ?? null,
    p_check_out_geo_lng: geo?.lng ?? null,
    p_check_out_geo_accuracy_m: geo?.accuracy ?? null,
    p_check_out_geo_captured_at: geo?.capturedAt ?? null,
  });

  if (error) throw error;
  return data as TimeEntry;
}
