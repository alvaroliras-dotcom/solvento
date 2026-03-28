import { supabase } from "../../lib/supabaseClient";
import type { TimeEntry } from "./timeEntries.types";

const MAX_DAILY_ENTRIES = 2;
const MAX_OPEN_HOURS = 10;

// ======================================================
// GEOCONFIG TEMPORAL DEL CENTRO DE TRABAJO
// ======================================================

const WORKPLACE_LAT = 40.3488264;
const WORKPLACE_LNG = -3.8013929;
const ALLOWED_RADIUS_M = 250;
const MAX_ACCURACY_FOR_GEOFENCE_M = 100;

// ======================================================
// TIPOS
// ======================================================

type GeoInput = {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string;
};

// ======================================================
// HELPERS
// ======================================================

function startOfLocalDayIso(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function endOfLocalDayIso(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}

function hoursBetween(startIso: string, endIso: string) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return Math.max(0, end - start) / 3600000;
}

function isSameLocalDay(aIso: string, b: Date) {
  const a = new Date(aIso);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function analyzeWorkplaceDistance(geo?: GeoInput | null) {
  if (!geo) {
    return {
      hasGeo: false,
      canEvaluate: false,
      distanceM: null as number | null,
      isOutside: false,
      reason: "no_geolocation",
    };
  }

  const accuracy = geo.accuracy ?? null;
  const distanceM = distanceMeters(
    geo.lat,
    geo.lng,
    WORKPLACE_LAT,
    WORKPLACE_LNG
  );

  if (accuracy == null || accuracy > MAX_ACCURACY_FOR_GEOFENCE_M) {
    return {
      hasGeo: true,
      canEvaluate: false,
      distanceM,
      isOutside: false,
      reason: "low_accuracy",
    };
  }

  const isOutside = distanceM > ALLOWED_RADIUS_M;

  return {
    hasGeo: true,
    canEvaluate: true,
    distanceM,
    isOutside,
    reason: isOutside ? "outside_workplace_radius" : "inside_workplace_radius",
  };
}

// ======================================================
// QUERIES
// ======================================================

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

export async function getTodayEntries(companyId: string, userId: string) {
  const { data, error } = await supabase
    .from("time_entries")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .gte("check_in_at", startOfLocalDayIso())
    .lte("check_in_at", endOfLocalDayIso())
    .order("check_in_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as TimeEntry[];
}

// ======================================================
// MUTATIONS
// ======================================================

export async function createCheckIn(
  companyId: string,
  userId: string,
  geo?: GeoInput | null
) {
  const now = new Date();

  const openEntry = await getOpenEntry(companyId, userId);

  if (openEntry) {
    const sameDay = isSameLocalDay(openEntry.check_in_at, now);

    if (!sameDay) {
      throw new Error(
        "Tienes una jornada abierta de un día anterior. Debes regularizarla antes de volver a entrar."
      );
    }

    throw new Error(
      "Ya tienes un tramo abierto. Debes cerrarlo antes de volver a fichar entrada."
    );
  }

  const todayEntries = await getTodayEntries(companyId, userId);

  if (todayEntries.length >= MAX_DAILY_ENTRIES) {
    throw new Error(
      "Solo se permiten dos tramos de trabajo al día (mañana y tarde)."
    );
  }

  const geoCheck = analyzeWorkplaceDistance(geo);
  const shouldCreateAutomaticIncident = geoCheck.canEvaluate && geoCheck.isOutside;

  const payload = {
    p_company_id: companyId,
    p_user_id: userId,
    p_status: "open",
    p_workflow_status: shouldCreateAutomaticIncident ? "pending" : "auto",
    p_flags: {
      auto_incident: shouldCreateAutomaticIncident,
      auto_incident_reason: shouldCreateAutomaticIncident
        ? "check_in_outside_workplace"
        : null,

      workplace_reference_lat: WORKPLACE_LAT,
      workplace_reference_lng: WORKPLACE_LNG,
      allowed_radius_m: ALLOWED_RADIUS_M,
      max_accuracy_for_geofence_m: MAX_ACCURACY_FOR_GEOFENCE_M,

      has_check_in_geolocation: !!geo,
      check_in_geo_can_evaluate_workplace: geoCheck.canEvaluate,
      check_in_geo_distance_to_workplace_m: geoCheck.distanceM,
      check_in_geo_outside_workplace: geoCheck.canEvaluate
        ? geoCheck.isOutside
        : null,
      check_in_geo_reason: geoCheck.reason,
    },
    p_check_in_geo_lat: geo?.lat ?? null,
    p_check_in_geo_lng: geo?.lng ?? null,
    p_check_in_geo_accuracy_m: geo?.accuracy ?? null,
    p_check_in_geo_captured_at: geo?.capturedAt ?? null,
  };

  console.log("CHECK IN RPC PAYLOAD", payload);

  const { data, error } = await supabase.rpc(
    "create_checkin_server_time",
    payload
  );

  if (error) throw error;
  return data as TimeEntry;
}

export async function createCheckOut(
  entryId: string,
  geo?: GeoInput | null
) {
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: existing, error: existingError } = await supabase
    .from("time_entries")
    .select("*")
    .eq("id", entryId)
    .single();

  if (existingError) throw existingError;

  const entry = existing as TimeEntry;
  const previousFlags =
    entry.flags && typeof entry.flags === "object" ? entry.flags : {};

  const openHours = hoursBetween(entry.check_in_at, nowIso);
  const crossedDay = !isSameLocalDay(entry.check_in_at, now);
  const exceededHours = openHours > MAX_OPEN_HOURS;

  // NUEVAS REGLAS DE TRAMO ANÓMALO
  const suspiciousLongShift = openHours > 7;
  const zeroLengthShift = openHours < 2 / 60;

  const geoCheck = analyzeWorkplaceDistance(geo);

  const shouldCreateAutomaticIncident =
    exceededHours ||
    crossedDay ||
    suspiciousLongShift ||
    zeroLengthShift ||
    (geoCheck.canEvaluate && geoCheck.isOutside) ||
    previousFlags.check_in_geo_outside_workplace === true;

  const autoIncidentReason = crossedDay
    ? "open_entry_crossed_day"
    : exceededHours
    ? "open_entry_exceeded_hours"
    : zeroLengthShift
    ? "zero_length_shift"
    : suspiciousLongShift
    ? "possible_missed_lunch_checkout"
    : geoCheck.canEvaluate && geoCheck.isOutside
    ? "check_out_outside_workplace"
    : previousFlags.auto_incident_reason ?? null;

  const payload = {
    p_entry_id: entryId,
    p_status: "closed",
    p_workflow_status: shouldCreateAutomaticIncident ? "pending" : "auto",
    p_flags: {
      ...previousFlags,
      auto_incident: shouldCreateAutomaticIncident,
      auto_incident_reason: autoIncidentReason,

      workplace_reference_lat: WORKPLACE_LAT,
      workplace_reference_lng: WORKPLACE_LNG,
      allowed_radius_m: ALLOWED_RADIUS_M,
      max_accuracy_for_geofence_m: MAX_ACCURACY_FOR_GEOFENCE_M,

      has_check_out_geolocation: !!geo,
      check_out_geo_can_evaluate_workplace: geoCheck.canEvaluate,
      check_out_geo_distance_to_workplace_m: geoCheck.distanceM,
      check_out_geo_outside_workplace: geoCheck.canEvaluate
        ? geoCheck.isOutside
        : null,
      check_out_geo_reason: geoCheck.reason,

      exceeded_open_hours_limit: exceededHours,
      crossed_day_without_checkout: crossedDay,
      detected_open_hours: Number(openHours.toFixed(2)),
      max_open_hours_rule: MAX_OPEN_HOURS,

      suspicious_long_shift: suspiciousLongShift,
      zero_length_shift: zeroLengthShift,
    },
    p_check_out_geo_lat: geo?.lat ?? null,
    p_check_out_geo_lng: geo?.lng ?? null,
    p_check_out_geo_accuracy_m: geo?.accuracy ?? null,
    p_check_out_geo_captured_at: geo?.capturedAt ?? null,
  };

  console.log("CHECK OUT RPC PAYLOAD", { entryId, payload });

  const { data, error } = await supabase.rpc(
    "create_checkout_server_time",
    payload
  );

  if (error) throw error;
  return data as TimeEntry;
}