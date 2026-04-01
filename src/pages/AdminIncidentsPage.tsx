import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useActiveMembership } from "../app/useActiveMembership";
import { adminTheme } from "../ui/adminTheme";

// ======================================================
// PARTE 1/6 — TIPOS Y HELPERS
// ======================================================

type IncidentSourceType = "manual" | "automatic" | "time_request";

type Incident = {
  adjustment_id: string;
  time_entry_id: string;
  user_id: string;
  check_in_at: string;
  proposed_check_out: string;
  reason: string;
  created_at: string;
  source_type: IncidentSourceType;
};

type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type EntryGeoDetail = {
  check_in_geo_lat: number | null;
  check_in_geo_lng: number | null;
  check_in_geo_accuracy_m: number | null;
  check_out_geo_lat: number | null;
  check_out_geo_lng: number | null;
  check_out_geo_accuracy_m: number | null;
  flags: Record<string, any> | null;
};

type ResolutionStatsRow = {
  workflow_status: string | null;
  approved_at: string | null;
  flags: Record<string, any> | null;
};

type TimeRequestRow = {
  id: string;
  time_entry_id: string | null;
  requested_by: string;
  requested_at: string;
  reason: string;
  status: string;
};

type CalendarRow = {
  morning_start: string | null;
  lunch_start: string | null;
  afternoon_start: string | null;
  day_end: string | null;
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function buildGoogleMapsEmbedUrl(lat: number, lng: number) {
  return `https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`;
}

function buildGoogleMapsExternalUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function formatCoords(lat: number, lng: number) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function formatDistance(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) return "No disponible";
  return `${Math.round(value)} m`;
}

function formatBool(value: unknown) {
  if (value === true) return "Sí";
  if (value === false) return "No";
  return "No evaluable";
}

function formatReason(value: unknown) {
  if (typeof value !== "string" || !value) return "No disponible";

  switch (value) {
    case "low_accuracy":
      return "Precisión insuficiente";
    case "inside_workplace_radius":
      return "Dentro del radio permitido";
    case "outside_workplace_radius":
      return "Fuera del radio permitido";
    case "no_geolocation":
      return "Sin geolocalización";
    case "open_entry_crossed_day":
      return "Jornada abierta de un día anterior";
    case "open_entry_exceeded_hours":
      return "Jornada demasiado larga";
    case "zero_length_shift":
      return "Tramo de duración casi cero";
    case "possible_missed_lunch_checkout":
      return "Posible olvido de salida para la comida";
    case "check_out_outside_workplace":
      return "Salida fuera del centro de trabajo";
    case "check_in_outside_workplace":
      return "Entrada fuera del centro de trabajo";
    case "missing_checkin_incident":
      return "Falta fichaje de entrada";
    case "late_checkin_incident":
      return "Entrada tardía";
    case "missing_lunch_checkout_incident":
      return "Falta salida a comer";
    case "late_lunch_checkout_incident":
      return "Salida a comer tardía";
    case "missing_afternoon_checkin_incident":
      return "Falta vuelta de comer";
    case "late_afternoon_checkin_incident":
      return "Vuelta de comer tardía";
    case "missing_final_checkout_incident":
      return "Falta fichaje de salida final";
    case "late_final_checkout_incident":
      return "Salida final tardía";
    default:
      return value;
  }
}

function isAutomaticIncident(incident: Incident | null) {
  return incident?.source_type === "automatic";
}

function isTimeRequestIncident(incident: Incident | null) {
  return incident?.source_type === "time_request";
}

function getIncidentTypeLabel(sourceType: IncidentSourceType) {
  if (sourceType === "automatic") return "Automática";
  if (sourceType === "time_request") return "Por tramos";
  return "Manual";
}

function getTodayRangeIso() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    fromIso: start.toISOString(),
    toIsoExclusive: end.toISOString(),
  };
}

function isIsoWithinRange(
  value: string | null | undefined,
  fromIso: string,
  toIsoExclusive: string
) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time >= new Date(fromIso).getTime() && time < new Date(toIsoExclusive).getTime();
}

function timeStringToMinutes(value: string) {
  const [hh, mm] = value.slice(0, 5).split(":").map(Number);
  return hh * 60 + mm;
}

function minutesToTimeString(totalMinutes: number) {
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

function getMadridDateParts(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  return {
    year: map.year,
    month: map.month,
    day: map.day,
  };
}

function buildMadridDeadlineIso(requestedAt: string, baseTime: string) {
  const { year, month, day } = getMadridDateParts(requestedAt);
  const deadlineMinutes = timeStringToMinutes(baseTime) + 45;
  const deadlineTime = minutesToTimeString(deadlineMinutes);

  return `${year}-${month}-${day}T${deadlineTime}+01:00`;
}

function getTimeRequestFallbackIso(reason: string, requestedAt: string, calendar: CalendarRow | null) {
  if (!calendar) return requestedAt;

  switch (reason) {
    case "missing_checkin_incident":
      return calendar.morning_start
        ? buildMadridDeadlineIso(requestedAt, calendar.morning_start)
        : requestedAt;

    case "missing_lunch_checkout_incident":
      return calendar.lunch_start
        ? buildMadridDeadlineIso(requestedAt, calendar.lunch_start)
        : requestedAt;

    case "missing_afternoon_checkin_incident":
      return calendar.afternoon_start
        ? buildMadridDeadlineIso(requestedAt, calendar.afternoon_start)
        : requestedAt;

    case "missing_final_checkout_incident":
      return calendar.day_end
        ? buildMadridDeadlineIso(requestedAt, calendar.day_end)
        : requestedAt;

    default:
      return requestedAt;
  }
}

// ======================================================
// PARTE 2/6 — COMPONENTE Y ESTADO
// ======================================================

export function AdminIncidentsPage() {
  const navigate = useNavigate();
  const { membership } = useActiveMembership();

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [selectedEntryGeo, setSelectedEntryGeo] = useState<EntryGeoDetail | null>(null);
  const [loadingEntryGeo, setLoadingEntryGeo] = useState(false);
  const [resolutionReason, setResolutionReason] = useState("");

  const [finalCheckIn, setFinalCheckIn] = useState("");
  const [finalCheckOut, setFinalCheckOut] = useState("");

  const [resolving, setResolving] = useState(false);

  const [validatedToday, setValidatedToday] = useState(0);
  const [rejectedToday, setRejectedToday] = useState(0);

  const [calendarConfig, setCalendarConfig] = useState<CalendarRow | null>(null);

  function getWorkerLabel(userId: string) {
    const profile = profilesById[userId];
    const fullName = (profile?.full_name ?? "").trim();
    const email = (profile?.email ?? "").trim();

    if (fullName) return fullName;
    if (email) return email;
    return userId;
  }

   // ======================================================
  // PARTE 3/6 — CARGA Y ACCIONES
  // ======================================================

  async function loadResolutionStats() {
    if (!membership) return;

    const { fromIso, toIsoExclusive } = getTodayRangeIso();

    const { data, error } = await supabase
      .from("time_entries")
      .select("workflow_status,approved_at,flags")
      .eq("company_id", membership.company_id)
      .in("workflow_status", ["adjusted", "rejected"]);

    if (error) {
      setValidatedToday(0);
      setRejectedToday(0);
      return;
    }

    const { data: requestRows } = await supabase
      .from("time_entry_requests")
      .select("status,resolved_at")
      .eq("company_id", membership.company_id)
      .in("status", ["validated", "rejected"]);

    let validated = 0;
    let rejected = 0;

    for (const row of (data ?? []) as ResolutionStatsRow[]) {
      const flagResolutionAt =
        typeof row.flags?.admin_resolution_at === "string"
          ? row.flags.admin_resolution_at
          : null;

      const effectiveResolutionAt = flagResolutionAt ?? row.approved_at;

      if (!isIsoWithinRange(effectiveResolutionAt, fromIso, toIsoExclusive)) {
        continue;
      }

      if (row.workflow_status === "adjusted") validated += 1;
      if (row.workflow_status === "rejected") rejected += 1;
    }

    for (const row of (requestRows ?? []) as Array<{ status: string; resolved_at: string | null }>) {
      if (!isIsoWithinRange(row.resolved_at, fromIso, toIsoExclusive)) {
        continue;
      }

      if (row.status === "validated") validated += 1;
      if (row.status === "rejected") rejected += 1;
    }

    setValidatedToday(validated);
    setRejectedToday(rejected);
  }

  async function loadIncidents() {
    if (!membership) return;

    setLoading(true);

    const { data: calendarData } = await supabase
      .from("company_work_calendar")
      .select("morning_start,lunch_start,afternoon_start,day_end")
      .eq("company_id", membership.company_id)
      .maybeSingle<CalendarRow>();

    setCalendarConfig(calendarData ?? null);

    const { data: manualData } = await supabase.rpc("admin_pending_adjustments", {
      p_company_id: membership.company_id,
    });

    const manual: Incident[] =
      ((manualData ?? []) as Omit<Incident, "source_type">[]).map((item) => ({
        ...item,
        source_type: "manual",
      }));

    const { data: autoRows } = await supabase
      .from("time_entries")
      .select("id,user_id,check_in_at,check_out_at,flags")
      .eq("company_id", membership.company_id)
      .eq("workflow_status", "pending");

    const automatic: Incident[] =
      (autoRows ?? []).map((e: any) => ({
        adjustment_id: `auto-${e.id}`,
        time_entry_id: e.id,
        user_id: e.user_id,
        check_in_at: e.check_in_at,
        proposed_check_out: e.check_out_at ?? e.check_in_at,
        reason:
          e.flags?.auto_incident_reason ??
          "Incidencia automática detectada por el sistema",
        created_at: e.check_in_at,
        source_type: "automatic",
      })) ?? [];

    const { data: requestRows } = await supabase
      .from("time_entry_requests")
      .select("id,time_entry_id,requested_by,requested_at,reason,status")
      .eq("company_id", membership.company_id)
      .eq("status", "pending")
      .returns<TimeRequestRow[]>();

    const requestTimeEntryIds = Array.from(
      new Set(
        (requestRows ?? [])
          .map((row) => row.time_entry_id)
          .filter((value): value is string => !!value)
      )
    );

    const entriesById: Record<string, { check_in_at: string | null; check_out_at: string | null }> = {};

    if (requestTimeEntryIds.length > 0) {
      const { data: linkedEntries } = await supabase
        .from("time_entries")
        .select("id,check_in_at,check_out_at")
        .in("id", requestTimeEntryIds);

      for (const entry of linkedEntries ?? []) {
        entriesById[entry.id] = {
          check_in_at: entry.check_in_at,
          check_out_at: entry.check_out_at,
        };
      }
    }

    const timeRequests: Incident[] =
      (requestRows ?? []).map((row) => {
        const linkedEntry = row.time_entry_id ? entriesById[row.time_entry_id] : null;
        const fallbackDateTime = getTimeRequestFallbackIso(
          row.reason,
          row.requested_at,
          calendarData ?? null
        );

        return {
          adjustment_id: row.id,
          time_entry_id: row.time_entry_id ?? "",
          user_id: row.requested_by,
          check_in_at: linkedEntry?.check_in_at ?? fallbackDateTime,
          proposed_check_out:
            linkedEntry?.check_out_at ?? linkedEntry?.check_in_at ?? fallbackDateTime,
          reason: row.reason,
          created_at: row.requested_at,
          source_type: "time_request",
        };
      }) ?? [];

    const combined = [...manual, ...automatic, ...timeRequests].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    setIncidents(combined);

    const { data: profilesData } = await supabase.rpc("admin_company_profiles", {
      p_company_id: membership.company_id,
    });

    const map: Record<string, Profile> = {};
    for (const p of (profilesData ?? []) as Profile[]) {
      map[p.id] = p;
    }

    setProfilesById(map);

    await loadResolutionStats();
    setLoading(false);
  }

  async function resolveIncident(decision: "validated" | "rejected") {
    if (!selectedIncident) return;

    const reason = resolutionReason.trim();

    if (reason.length < 3) {
      alert("El motivo de resolución es obligatorio (mínimo 3 caracteres).");
      return;
    }

    setResolving(true);

    if (isTimeRequestIncident(selectedIncident)) {
      const { error } = await supabase.rpc("resolve_time_entry_request", {
        p_request_id: selectedIncident.adjustment_id,
        p_decision: decision,
        p_resolution_reason: reason,
      });

      setResolving(false);

      if (error) {
        alert(error.message);
        return;
      }

      closeIncidentModal();
      await loadIncidents();
      return;
    }

    if (isAutomaticIncident(selectedIncident)) {
      const previousCheckOutAt =
        selectedEntryGeo?.flags?.admin_new_check_out_at ?? selectedIncident.proposed_check_out;

      const nextFlags = {
        ...(selectedEntryGeo?.flags ?? {}),
        admin_resolution_decision: decision,
        admin_resolution_reason: reason,
        admin_resolution_at: new Date().toISOString(),
        incident_closed_from_backoffice: true,
      };

      const { data: authData } = await supabase.auth.getUser();
      const adminUserId = authData.user?.id ?? null;

      const updatePayload: Record<string, any> = {
        workflow_status: decision === "validated" ? "adjusted" : "rejected",
        flags: nextFlags,
      };

      if (decision === "validated") {
        if (finalCheckIn) {
          updatePayload.check_in_at = new Date(finalCheckIn).toISOString();
        }

        if (finalCheckOut) {
          updatePayload.check_out_at = new Date(finalCheckOut).toISOString();
        }
      }

      const { error } = await supabase
        .from("time_entries")
        .update(updatePayload)
        .eq("id", selectedIncident.time_entry_id);

      if (error) {
        setResolving(false);
        alert(error.message);
        return;
      }

      await supabase.from("time_entry_logs").insert({
        company_id: membership?.company_id,
        time_entry_id: selectedIncident.time_entry_id,
        action:
          decision === "validated"
            ? "automatic_incident_validated"
            : "automatic_incident_rejected",
        performed_by: adminUserId,
        performed_role: "admin",
        old_values: {
          check_in_at: selectedIncident.check_in_at,
          check_out_at: previousCheckOutAt,
          workflow_status: "pending",
        },
        new_values: {
          check_in_at: finalCheckIn
            ? new Date(finalCheckIn).toISOString()
            : selectedIncident.check_in_at,
          check_out_at: finalCheckOut
            ? new Date(finalCheckOut).toISOString()
            : previousCheckOutAt,
          workflow_status: decision === "validated" ? "adjusted" : "rejected",
          resolution_reason: reason,
        },
      });

      setResolving(false);
      closeIncidentModal();
      await loadIncidents();
      return;
    }

    const { error } = await supabase.rpc("resolve_time_entry_adjustment", {
      p_adjustment_id: selectedIncident.adjustment_id,
      p_decision: decision,
      p_resolution_reason: reason,
      p_final_check_out:
        decision === "validated" && finalCheckOut
          ? new Date(finalCheckOut).toISOString()
          : null,
    });

    setResolving(false);

    if (error) {
      alert(error.message);
      return;
    }

    closeIncidentModal();
    await loadIncidents();
  }

  async function openIncidentModal(item: Incident) {
    setSelectedIncident(item);
    setSelectedEntryGeo(null);
    setLoadingEntryGeo(true);
    setResolutionReason("");

    setFinalCheckIn(item.check_in_at?.slice(0, 16) || "");
    setFinalCheckOut(item.proposed_check_out?.slice(0, 16) || "");

    if (!item.time_entry_id) {
      setSelectedEntryGeo(null);
      setLoadingEntryGeo(false);
      return;
    }

    const { data, error } = await supabase
      .from("time_entries")
      .select(
        "check_in_geo_lat, check_in_geo_lng, check_in_geo_accuracy_m, check_out_geo_lat, check_out_geo_lng, check_out_geo_accuracy_m, flags"
      )
      .eq("id", item.time_entry_id)
      .maybeSingle();

    if (!error && data) {
      setSelectedEntryGeo(data as EntryGeoDetail);
    } else {
      setSelectedEntryGeo(null);
    }

    setLoadingEntryGeo(false);
  }

  function closeIncidentModal() {
    setSelectedIncident(null);
    setSelectedEntryGeo(null);
    setLoadingEntryGeo(false);
    setResolutionReason("");
    setFinalCheckIn("");
    setFinalCheckOut("");
  }

  // ======================================================
  // PARTE 4/6 — DERIVADOS Y EFECTOS
  // ======================================================

  useEffect(() => {
    if (!membership) return;
    loadIncidents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membership?.company_id]);

  const filteredIncidents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return incidents;

    return incidents.filter((item) => {
      const workerLabel = getWorkerLabel(item.user_id).toLowerCase();

      return (
        workerLabel.includes(q) ||
        item.user_id.toLowerCase().includes(q) ||
        String(item.reason ?? "").toLowerCase().includes(q)
      );
    });
  }, [incidents, search, profilesById]);

  const flags = selectedEntryGeo?.flags ?? null;

   // ======================================================
  // PARTE 5/6 — UI PRINCIPAL DE LA PÁGINA
  // ======================================================

  return (
    <div className="adminIncPageUi">
      <style>{`
        .adminIncPageUi {
          display: grid;
          gap: 12px;
        }

        .adminIncTopBar {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }

        .adminIncBadge {
          height: 40px;
          padding: 0 14px;
          display: inline-flex;
          align-items: center;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 12px;
          background: ${adminTheme.colors.panelBg};
          color: ${adminTheme.colors.textSoft};
          font-size: 13px;
          font-weight: 700;
        }

        .adminIncInput {
          height: 40px;
          padding: 0 12px;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 12px;
          background: ${adminTheme.colors.panelBg};
          color: ${adminTheme.colors.text};
          outline: none;
          font-weight: 700;
          min-width: 240px;
        }

        .adminIncInput::placeholder {
          color: ${adminTheme.colors.textMuted};
        }

        .adminIncBtn {
          height: 40px;
          padding: 0 16px;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 12px;
          background: ${adminTheme.colors.panelSoft};
          color: ${adminTheme.colors.text};
          font-weight: 700;
          cursor: pointer;
        }

        .adminIncBtn.primary {
          background: ${adminTheme.colors.primary};
          color: ${adminTheme.colors.textOnPrimary};
          border-color: ${adminTheme.colors.primary};
        }

        .adminIncBtn.danger {
          background: ${adminTheme.colors.danger};
          color: #ffffff;
          border-color: ${adminTheme.colors.dangerHover};
        }

        .adminIncBtn:disabled {
          opacity: .6;
          cursor: not-allowed;
        }

        .adminIncKpiGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .adminIncKpi {
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 18px;
          background: ${adminTheme.colors.cardBg};
          padding: 16px;
        }

        .adminIncKpiLabel {
          font-size: 13px;
          font-weight: 700;
          color: ${adminTheme.colors.textSoft};
        }

        .adminIncKpiValue {
          margin-top: 8px;
          font-size: 26px;
          font-weight: 800;
          color: ${adminTheme.colors.text};
        }

        .adminIncCard {
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 18px;
          background: ${adminTheme.colors.cardBg};
          padding: 16px;
        }

        .adminIncCardTitle {
          margin: 0;
          font-size: 18px;
          font-weight: 800;
          color: ${adminTheme.colors.text};
        }

        .adminIncCardSub {
          margin: 4px 0 0 0;
          font-size: 13px;
          font-weight: 600;
          color: ${adminTheme.colors.textSoft};
        }

        .adminIncTableWrap {
          margin-top: 12px;
          overflow: auto;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 14px;
          background: ${adminTheme.colors.panelBg};
        }

        .adminIncTable {
          width: 100%;
          border-collapse: collapse;
          min-width: 980px;
        }

        .adminIncTable th,
        .adminIncTable td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid ${adminTheme.colors.border};
          font-size: 14px;
          color: ${adminTheme.colors.text};
          vertical-align: middle;
        }

        .adminIncTable th {
          color: ${adminTheme.colors.textSoft};
          font-weight: 800;
        }

        .adminIncRight {
          text-align: right;
        }

        .adminIncEmpty {
          padding: 24px 12px;
          text-align: center;
          color: ${adminTheme.colors.textSoft};
          font-weight: 600;
        }

        .adminIncModalOverlay {
          position: fixed;
          inset: 0;
          background: ${adminTheme.colors.overlay};
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
          z-index: 9999;
        }

        .adminIncModalCard {
          width: min(1680px, 100%);
          min-height: min(900px, calc(100vh - 36px));
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 24px;
          background: ${adminTheme.colors.cardBg};
          padding: 18px;
          box-shadow: ${adminTheme.shadows.lg};
          overflow: hidden;
          display: grid;
          grid-template-rows: auto 1fr;
          gap: 14px;
        }

        .adminIncModalHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .adminIncModalTitle {
          margin: 0;
          font-size: 24px;
          font-weight: 900;
          color: ${adminTheme.colors.text};
        }

        .adminIncModalSub {
          font-size: 13px;
          font-weight: 700;
          color: ${adminTheme.colors.textSoft};
        }

        .adminIncModalShell {
          display: grid;
          grid-template-columns: 320px minmax(0, 1fr) 320px;
          gap: 14px;
          min-height: 0;
        }

        .adminIncSideCol,
        .adminIncCenterCol,
        .adminIncRightCol {
          min-height: 0;
        }

        .adminIncSideCol,
        .adminIncRightCol {
          display: grid;
          gap: 12px;
          align-content: start;
        }

        .adminIncCenterCol {
          display: grid;
          gap: 12px;
          min-height: 0;
        }

        .adminIncPanel {
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 16px;
          background: ${adminTheme.colors.panelBg};
          padding: 14px;
        }

        .adminIncPanelTitle {
          margin: 0 0 10px 0;
          font-size: 15px;
          font-weight: 900;
          color: ${adminTheme.colors.text};
        }

        .adminIncInfoList {
          display: grid;
          gap: 10px;
        }

        .adminIncInfoItem {
          padding: 12px;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 14px;
          background: ${adminTheme.colors.panelSoft};
        }

        .adminIncInfoLabel {
          font-size: 11px;
          font-weight: 800;
          color: ${adminTheme.colors.textMuted};
          margin-bottom: 5px;
          text-transform: uppercase;
          letter-spacing: .02em;
        }

        .adminIncInfoValue {
          font-size: 15px;
          font-weight: 800;
          color: ${adminTheme.colors.text};
          word-break: break-word;
        }

        .adminIncEditGrid {
          display: grid;
          gap: 10px;
        }

        .adminIncModalInput,
        .adminIncModalTextarea {
          width: 100%;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 12px;
          background: ${adminTheme.colors.panelSoft};
          color: ${adminTheme.colors.text};
          outline: none;
          font-weight: 700;
          padding: 10px 12px;
        }

        .adminIncModalTextarea::placeholder,
        .adminIncModalInput::placeholder {
          color: ${adminTheme.colors.textMuted};
        }

        .adminIncModalTextarea {
          min-height: 220px;
          resize: none;
        }

        .adminIncContextBar {
          display: grid;
          gap: 8px;
        }

        .adminIncContextStrip {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          padding: 14px;
          border-radius: 14px;
          background: ${adminTheme.colors.panelSoft};
          border: 1px solid ${adminTheme.colors.border};
        }

        .adminIncContextDot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: ${adminTheme.colors.primary};
          flex: 0 0 auto;
        }

        .adminIncContextText {
          font-size: 14px;
          font-weight: 700;
          color: ${adminTheme.colors.text};
        }

        .adminIncGeoGrid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          min-height: 0;
        }

        .adminIncGeoCard {
          display: grid;
          gap: 12px;
          padding: 14px;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 16px;
          background: ${adminTheme.colors.panelBg};
          min-height: 0;
        }

        .adminIncGeoCardHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .adminIncGeoCardTitle {
          font-size: 15px;
          font-weight: 900;
          color: ${adminTheme.colors.text};
        }

        .adminIncGeoCardBadge {
          display: inline-flex;
          align-items: center;
          height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          background: ${adminTheme.colors.primarySoft};
          border: 1px solid ${adminTheme.colors.primaryBorder};
          color: ${adminTheme.colors.primary};
          font-size: 12px;
          font-weight: 800;
        }

        .adminIncGeoMetaGrid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .adminIncGeoMetaItem {
          padding: 10px 12px;
          border-radius: 12px;
          background: ${adminTheme.colors.panelSoft};
          border: 1px solid ${adminTheme.colors.border};
        }

        .adminIncGeoMetaLabel {
          font-size: 11px;
          font-weight: 800;
          color: ${adminTheme.colors.textMuted};
          margin-bottom: 4px;
          text-transform: uppercase;
          letter-spacing: .02em;
        }

        .adminIncGeoMetaValue {
          font-size: 13px;
          font-weight: 700;
          color: ${adminTheme.colors.text};
          word-break: break-word;
        }

        .adminIncMapFrame {
          width: 100%;
          height: 320px;
          border: 0;
          border-radius: 14px;
          background: ${adminTheme.colors.panelSoft};
        }

        .adminIncMapLink {
          color: ${adminTheme.colors.link};
          font-size: 13px;
          font-weight: 700;
          text-decoration: none;
        }

        .adminIncMapLink:hover {
          text-decoration: underline;
        }

        .adminIncActionText {
          font-size: 14px;
          font-weight: 700;
          color: ${adminTheme.colors.textSoft};
          line-height: 1.45;
        }

        @media (max-width: 1380px) {
          .adminIncModalCard {
            min-height: auto;
            overflow: auto;
          }

          .adminIncModalShell {
            grid-template-columns: 1fr;
          }

          .adminIncGeoGrid {
            grid-template-columns: 1fr;
          }

          .adminIncModalTextarea {
            min-height: 160px;
          }
        }

        @media (max-width: 900px) {
          .adminIncKpiGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .adminIncGeoMetaGrid {
            grid-template-columns: 1fr;
          }

          .adminIncMapFrame {
            height: 260px;
          }
        }

        @media (max-width: 700px) {
          .adminIncKpiGrid {
            grid-template-columns: 1fr;
          }

          .adminIncInput {
            min-width: 100%;
          }

          .adminIncModalCard {
            padding: 14px;
          }
        }
      `}</style>

      <section className="adminIncTopBar">
        <div className="adminIncBadge">Pendientes</div>

        <input
          className="adminIncInput"
          placeholder="Buscar trabajador..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <button className="adminIncBtn" onClick={loadIncidents}>
          Filtrar
        </button>
      </section>

      <section className="adminIncKpiGrid">
        <div className="adminIncKpi">
          <div className="adminIncKpiLabel">Incidencias pendientes</div>
          <div className="adminIncKpiValue">{incidents.length}</div>
        </div>

        <div className="adminIncKpi">
          <div className="adminIncKpiLabel">Validadas hoy</div>
          <div className="adminIncKpiValue">{validatedToday}</div>
        </div>

        <div className="adminIncKpi">
          <div className="adminIncKpiLabel">Rechazadas hoy</div>
          <div className="adminIncKpiValue">{rejectedToday}</div>
        </div>

        <div className="adminIncKpi">
          <div className="adminIncKpiLabel">Total incidencias</div>
          <div className="adminIncKpiValue">
            {incidents.length + validatedToday + rejectedToday}
          </div>
        </div>
      </section>

      <section className="adminIncCard">
        <h2 className="adminIncCardTitle">Incidencias</h2>
        <p className="adminIncCardSub">Bandeja de incidencias pendientes</p>

        <div className="adminIncTableWrap">
          <table className="adminIncTable">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Trabajador</th>
                <th>Entrada</th>
                <th>Salida propuesta</th>
                <th>Motivo</th>
                <th className="adminIncRight">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredIncidents.map((item) => (
                <tr key={item.adjustment_id}>
                  <td>{getIncidentTypeLabel(item.source_type)}</td>
                  <td>{getWorkerLabel(item.user_id)}</td>
                  <td>{formatDateTime(item.check_in_at)}</td>
                  <td>{formatDateTime(item.proposed_check_out)}</td>
                  <td>{formatReason(item.reason)}</td>
                  <td className="adminIncRight">
                    <button className="adminIncBtn primary" onClick={() => openIncidentModal(item)}>
                      {item.source_type === "automatic"
                        ? "Revisar"
                        : item.source_type === "time_request"
                        ? "Resolver"
                        : "Resolver"}
                    </button>
                  </td>
                </tr>
              ))}

              {!loading && filteredIncidents.length === 0 && (
                <tr>
                  <td colSpan={6} className="adminIncEmpty">
                    No hay incidencias pendientes.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td colSpan={6} className="adminIncEmpty">
                    Cargando…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedIncident && (
        <div
          className="adminIncModalOverlay"
          onClick={() => {
            if (resolving) return;
            closeIncidentModal();
          }}
        >
          <div className="adminIncModalCard" onClick={(e) => e.stopPropagation()}>
            <div className="adminIncModalHeader">
              <div>
                <h3 className="adminIncModalTitle">
                  {isTimeRequestIncident(selectedIncident)
                    ? "Resolución de incidencia por tramos"
                    : isAutomaticIncident(selectedIncident)
                    ? "Revisión de incidencia automática"
                    : "Resolución de incidencia manual"}
                </h3>
                <div className="adminIncModalSub">
                  {isTimeRequestIncident(selectedIncident)
                    ? "Incidencia creada automáticamente por faltar o llegar tarde en un tramo del día"
                    : isAutomaticIncident(selectedIncident)
                    ? "Inspección completa del fichaje, sus flags y la geolocalización detectada"
                    : "Revisión completa de la solicitud manual y su geolocalización"}
                </div>
              </div>
            </div>

            <div className="adminIncModalShell">
              <aside className="adminIncSideCol">
                <div className="adminIncPanel">
                  <h4 className="adminIncPanelTitle">Incidencia</h4>

                  <div className="adminIncInfoList">
                    <div className="adminIncInfoItem">
                      <div className="adminIncInfoLabel">Tipo</div>
                      <div className="adminIncInfoValue">
                        {getIncidentTypeLabel(selectedIncident.source_type)}
                      </div>
                    </div>

                    <div className="adminIncInfoItem">
                      <div className="adminIncInfoLabel">Trabajador</div>
                      <div className="adminIncInfoValue">
                        {getWorkerLabel(selectedIncident.user_id)}
                      </div>
                    </div>

                    <div className="adminIncInfoItem">
                      <div className="adminIncInfoLabel">Entrada actual</div>
                      <div className="adminIncInfoValue">
                        {formatDateTime(selectedIncident.check_in_at)}
                      </div>
                    </div>

                    <div className="adminIncInfoItem">
                      <div className="adminIncInfoLabel">Salida actual</div>
                      <div className="adminIncInfoValue">
                        {formatDateTime(selectedIncident.proposed_check_out)}
                      </div>
                    </div>

                    <div className="adminIncInfoItem">
                      <div className="adminIncInfoLabel">Motivo de la incidencia</div>
                      <div className="adminIncInfoValue">
                        {formatReason(selectedIncident.reason)}
                      </div>
                    </div>
                  </div>
                </div>

                {!isTimeRequestIncident(selectedIncident) && (
                  <div className="adminIncPanel">
                    <h4 className="adminIncPanelTitle">Corrección del tramo</h4>

                    <div className="adminIncEditGrid">
                      <div>
                        <div className="adminIncInfoLabel" style={{ marginBottom: 6 }}>
                          Hora entrada corregida
                        </div>
                        <input
                          className="adminIncModalInput"
                          type="datetime-local"
                          value={finalCheckIn}
                          onChange={(e) => setFinalCheckIn(e.target.value)}
                        />
                      </div>

                      <div>
                        <div className="adminIncInfoLabel" style={{ marginBottom: 6 }}>
                          Hora salida corregida
                        </div>
                        <input
                          className="adminIncModalInput"
                          type="datetime-local"
                          value={finalCheckOut}
                          onChange={(e) => setFinalCheckOut(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </aside>

              <main className="adminIncCenterCol">
                <div className="adminIncPanel">
                  <h4 className="adminIncPanelTitle">Contexto del día</h4>

                  <div className="adminIncContextBar">
                    <div className="adminIncContextStrip">
                      <span className="adminIncContextDot" />
                      <span className="adminIncContextText">
                        Tramo afectado: {formatDateTime(selectedIncident.check_in_at)} →{" "}
                        {formatDateTime(selectedIncident.proposed_check_out)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="adminIncPanel" style={{ minHeight: 0 }}>
                  <h4 className="adminIncPanelTitle">Geolocalización</h4>

                  {isTimeRequestIncident(selectedIncident) && !selectedIncident.time_entry_id && (
                    <div className="adminIncActionText">
                      Esta incidencia por tramos no tiene un fichaje enlazado todavía.
                    </div>
                  )}

                  {loadingEntryGeo && <div className="adminIncActionText">Cargando ubicación…</div>}

                  {!loadingEntryGeo &&
                    !selectedEntryGeo &&
                    !(isTimeRequestIncident(selectedIncident) && !selectedIncident.time_entry_id) && (
                      <div className="adminIncActionText">
                        No se ha podido cargar la ubicación.
                      </div>
                    )}

                  {!loadingEntryGeo && selectedEntryGeo && (
                    <div className="adminIncGeoGrid">
                      <div className="adminIncGeoCard">
                        <div className="adminIncGeoCardHead">
                          <div className="adminIncGeoCardTitle">Entrada</div>
                          <div className="adminIncGeoCardBadge">Check-in</div>
                        </div>

                        {selectedEntryGeo.check_in_geo_lat != null &&
                        selectedEntryGeo.check_in_geo_lng != null ? (
                          <>
                            <div className="adminIncGeoMetaGrid">
                              <div className="adminIncGeoMetaItem">
                                <div className="adminIncGeoMetaLabel">Coordenadas</div>
                                <div className="adminIncGeoMetaValue">
                                  {formatCoords(
                                    selectedEntryGeo.check_in_geo_lat,
                                    selectedEntryGeo.check_in_geo_lng
                                  )}
                                </div>
                              </div>

                              <div className="adminIncGeoMetaItem">
                                <div className="adminIncGeoMetaLabel">Precisión</div>
                                <div className="adminIncGeoMetaValue">
                                  {selectedEntryGeo.check_in_geo_accuracy_m != null
                                    ? `${Math.round(selectedEntryGeo.check_in_geo_accuracy_m)} m`
                                    : "No disponible"}
                                </div>
                              </div>

                              <div className="adminIncGeoMetaItem">
                                <div className="adminIncGeoMetaLabel">Distancia al centro</div>
                                <div className="adminIncGeoMetaValue">
                                  {formatDistance(flags?.check_in_geo_distance_to_workplace_m)}
                                </div>
                              </div>

                              <div className="adminIncGeoMetaItem">
                                <div className="adminIncGeoMetaLabel">¿Fuera del centro?</div>
                                <div className="adminIncGeoMetaValue">
                                  {formatBool(flags?.check_in_geo_outside_workplace)}
                                </div>
                              </div>

                              <div className="adminIncGeoMetaItem">
                                <div className="adminIncGeoMetaLabel">¿Evaluable?</div>
                                <div className="adminIncGeoMetaValue">
                                  {formatBool(flags?.check_in_geo_can_evaluate_workplace)}
                                </div>
                              </div>

                              <div className="adminIncGeoMetaItem">
                                <div className="adminIncGeoMetaLabel">Motivo</div>
                                <div className="adminIncGeoMetaValue">
                                  {formatReason(flags?.check_in_geo_reason)}
                                </div>
                              </div>
                            </div>

                            <iframe
                              className="adminIncMapFrame"
                              src={buildGoogleMapsEmbedUrl(
                                selectedEntryGeo.check_in_geo_lat,
                                selectedEntryGeo.check_in_geo_lng
                              )}
                              loading="lazy"
                              referrerPolicy="no-referrer-when-downgrade"
                              title="Mapa de entrada"
                            />

                            <a
                              className="adminIncMapLink"
                              href={buildGoogleMapsExternalUrl(
                                selectedEntryGeo.check_in_geo_lat,
                                selectedEntryGeo.check_in_geo_lng
                              )}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Ver ubicación exacta
                            </a>
                          </>
                        ) : (
                          <div className="adminIncActionText">
                            No hay geolocalización registrada en la entrada.
                          </div>
                        )}
                      </div>

                      <div className="adminIncGeoCard">
                        <div className="adminIncGeoCardHead">
                          <div className="adminIncGeoCardTitle">Salida</div>
                          <div className="adminIncGeoCardBadge">Check-out</div>
                        </div>

                        {selectedEntryGeo.check_out_geo_lat != null &&
                        selectedEntryGeo.check_out_geo_lng != null ? (
                          <>
                            <div className="adminIncGeoMetaGrid">
                              <div className="adminIncGeoMetaItem">
                                <div className="adminIncGeoMetaLabel">Coordenadas</div>
                                <div className="adminIncGeoMetaValue">
                                  {formatCoords(
                                    selectedEntryGeo.check_out_geo_lat,
                                    selectedEntryGeo.check_out_geo_lng
                                  )}
                                </div>
                              </div>

                              <div className="adminIncGeoMetaItem">
                                <div className="adminIncGeoMetaLabel">Precisión</div>
                                <div className="adminIncGeoMetaValue">
                                  {selectedEntryGeo.check_out_geo_accuracy_m != null
                                    ? `${Math.round(selectedEntryGeo.check_out_geo_accuracy_m)} m`
                                    : "No disponible"}
                                </div>
                              </div>

                              <div className="adminIncGeoMetaItem">
                                <div className="adminIncGeoMetaLabel">Distancia al centro</div>
                                <div className="adminIncGeoMetaValue">
                                  {formatDistance(flags?.check_out_geo_distance_to_workplace_m)}
                                </div>
                              </div>

                              <div className="adminIncGeoMetaItem">
                                <div className="adminIncGeoMetaLabel">¿Fuera del centro?</div>
                                <div className="adminIncGeoMetaValue">
                                  {formatBool(flags?.check_out_geo_outside_workplace)}
                                </div>
                              </div>

                              <div className="adminIncGeoMetaItem">
                                <div className="adminIncGeoMetaLabel">¿Evaluable?</div>
                                <div className="adminIncGeoMetaValue">
                                  {formatBool(flags?.check_out_geo_can_evaluate_workplace)}
                                </div>
                              </div>

                              <div className="adminIncGeoMetaItem">
                                <div className="adminIncGeoMetaLabel">Motivo</div>
                                <div className="adminIncGeoMetaValue">
                                  {formatReason(flags?.check_out_geo_reason)}
                                </div>
                              </div>
                            </div>

                            <iframe
                              className="adminIncMapFrame"
                              src={buildGoogleMapsEmbedUrl(
                                selectedEntryGeo.check_out_geo_lat,
                                selectedEntryGeo.check_out_geo_lng
                              )}
                              loading="lazy"
                              referrerPolicy="no-referrer-when-downgrade"
                              title="Mapa de salida"
                            />

                            <a
                              className="adminIncMapLink"
                              href={buildGoogleMapsExternalUrl(
                                selectedEntryGeo.check_out_geo_lat,
                                selectedEntryGeo.check_out_geo_lng
                              )}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Ver ubicación exacta
                            </a>
                          </>
                        ) : (
                          <div className="adminIncActionText">
                            No hay geolocalización registrada en la salida.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </main>

              <aside
                className="adminIncRightCol"
                style={{ gap: 10, alignContent: "start" }}
              >
                <div className="adminIncPanel">
                  <h4 className="adminIncPanelTitle">Motivo de resolución</h4>
                  <textarea
                    className="adminIncModalTextarea"
                    value={resolutionReason}
                    onChange={(e) => setResolutionReason(e.target.value)}
                    placeholder="Escribe aquí el motivo obligatorio de validación o rechazo."
                  />
                </div>

                <div className="adminIncPanel" style={{ display: "grid", gap: 10, minHeight: 0 }}>
                  <h4 className="adminIncPanelTitle">Acciones rápidas</h4>

                  <div className="adminIncActionText">
                    {isTimeRequestIncident(selectedIncident)
                      ? "Revisa el motivo de la incidencia por tramos y decide si la validas o la rechazas."
                      : isAutomaticIncident(selectedIncident)
                      ? "Revisa mapas, horas, flags y geolocalización antes de validar o rechazar la incidencia automática."
                      : "Revisa la propuesta del trabajador, la ubicación y la coherencia del fichaje antes de validar o rechazar."}
                  </div>

                  <div style={{ display: "grid", gap: 8, marginTop: 2 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <button
                        className="adminIncBtn"
                        disabled={resolving}
                        onClick={closeIncidentModal}
                        style={{ width: "100%" }}
                      >
                        Cerrar
                      </button>

                      <button
                        className="adminIncBtn"
                        disabled={resolving}
                        onClick={() => navigate(`/admin/worker/${selectedIncident.user_id}`)}
                        style={{ width: "100%" }}
                      >
                        Abrir ficha
                      </button>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <button
                        className="adminIncBtn primary"
                        disabled={resolving}
                        onClick={() => resolveIncident("validated")}
                        style={{ width: "100%" }}
                      >
                        {resolving ? "Procesando…" : "Validar"}
                      </button>

                      <button
                        className="adminIncBtn danger"
                        disabled={resolving}
                        onClick={() => resolveIncident("rejected")}
                        style={{ width: "100%" }}
                      >
                        {resolving ? "Procesando…" : "Rechazar"}
                      </button>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}