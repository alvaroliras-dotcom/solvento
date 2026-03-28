import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useActiveMembership } from "../app/useActiveMembership";
import { adminTheme } from "../ui/adminTheme";

// ======================================================
// PARTE 1/6 — TIPOS Y HELPERS
// ======================================================

type IncidentSourceType = "manual" | "automatic";

type PendingAdjustment = {
  adjustment_id: string;
  time_entry_id: string;
  user_id: string;
  check_in_at: string;
  proposed_check_out: string;
  reason: string;
  created_at: string;
  source_type: IncidentSourceType;
};

type OpenEntry = {
  id: string;
  user_id: string;
  check_in_at: string;
};

type TimeEntryForMetrics = {
  user_id: string;
  check_in_at: string;
  check_out_at: string | null;
};

type UserMetrics = {
  user_id: string;
  closed_entries: number;
  total_minutes: number;
};

type TimeEntryForCsv = {
  id: string;
  user_id: string;
  check_in_at: string;
  check_out_at: string | null;
  status: string | null;
  workflow_status: string | null;
  created_at: string | null;
  created_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  flags: any | null;
};

type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type Preset = "today" | "week" | "month" | "custom";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatElapsedHm(fromIso: string) {
  const from = new Date(fromIso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - from);
  const totalMinutes = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

function formatMinutesHm(totalMinutes: number) {
  const safe = Math.max(0, Math.floor(totalMinutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}h ${m}m`;
}

function formatLocalDate(d: Date) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatLocalTime(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatLocalDateTime(iso: string) {
  const d = new Date(iso);
  return `${formatLocalDate(d)} ${formatLocalTime(d)}`;
}

function minutesToHHMM(mins: number | "") {
  if (mins === "") return "";
  const m = Math.max(0, Math.floor(mins));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${pad2(h)}:${pad2(mm)}`;
}

function toDateInputValue(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateInputValue(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

function startOfLocalDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endExclusiveFromLocalDate(endDateLocal: Date) {
  const x = startOfLocalDay(endDateLocal);
  x.setDate(x.getDate() + 1);
  return x;
}

function startOfLocalWeek(d: Date) {
  const x = startOfLocalDay(d);
  const day = x.getDay();
  const diffToMonday = (day + 6) % 7;
  x.setDate(x.getDate() - diffToMonday);
  return x;
}

function startOfLocalMonth(d: Date) {
  const x = startOfLocalDay(d);
  x.setDate(1);
  return x;
}

function summarizeFlags(flags: any): string {
  if (!flags || (typeof flags === "object" && Object.keys(flags).length === 0)) {
    return "Normal";
  }

  if (typeof flags === "string") return flags;
  if (typeof flags !== "object") return String(flags);
  if (flags.cierre_manual) return "Editado por administrador";
  if (flags.reset) return "Ajuste aplicado por administrador";
  if (flags.manual) return "Modificación manual";
  if (flags.auto_close) return "Cierre automático del sistema";
  if (flags.note) return `Motivo: ${String(flags.note)}`;
  if (flags.reason) return `Motivo: ${String(flags.reason)}`;

  try {
    const s = JSON.stringify(flags);
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  } catch {
    return String(flags);
  }
}

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return "";
  const s =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value);

  const needsQuotes = /[",\n\r;]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function downloadCsv(
  filename: string,
  rows: Array<Record<string, unknown>>,
  headersOverride?: string[]
) {
  const hasRows = rows.length > 0;
  const headers = headersOverride ?? (hasRows ? Object.keys(rows[0]) : []);

  if (!hasRows && headers.length === 0) {
    const blob = new Blob([""], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const lines = [
    headers.map(csvEscape).join(";"),
    ...(hasRows ? rows.map((r) => headers.map((h) => csvEscape(r[h])).join(";")) : []),
  ];

  const csv = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
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
    default:
      return value;
  }
}

function getIncidentTypeLabel(sourceType: IncidentSourceType) {
  return sourceType === "automatic" ? "Automática" : "Manual";
}

function isAutomaticIncident(item: PendingAdjustment) {
  return item.source_type === "automatic";
}

// ======================================================
// PARTE 2/6 — COMPONENTE Y ESTADO
// ======================================================

export function AdminPage() {
  const navigate = useNavigate();
  const { membership, loading: membershipLoading } = useActiveMembership();

  const [items, setItems] = useState<PendingAdjustment[]>([]);
  const [openEntries, setOpenEntries] = useState<OpenEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [resolutionReason, setResolutionReason] = useState("");
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [entriesInRange, setEntriesInRange] = useState<number | null>(null);
  const [closesInRange, setClosesInRange] = useState<number | null>(null);
  const [metricsByUser, setMetricsByUser] = useState<UserMetrics[]>([]);
  const [inspectionEntries, setInspectionEntries] = useState<TimeEntryForCsv[]>([]);
  const [totalMinutesInRange, setTotalMinutesInRange] = useState<number | null>(null);

  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [employeeQuery, setEmployeeQuery] = useState("");

  const [exporting, setExporting] = useState<null | "summary" | "detail" | "inspection">(null);
  const [preset, setPreset] = useState<Preset>("today");

  const today = useMemo(() => new Date(), []);
  const [fromDateStr, setFromDateStr] = useState(() => toDateInputValue(today));
  const [toDateStr, setToDateStr] = useState(() => toDateInputValue(today));

  // ======================================================
  // PARTE 3/6 — DERIVADOS Y CÁLCULOS
  // ======================================================

  const range = useMemo(() => {
    const fromLocal = startOfLocalDay(fromDateInputValue(fromDateStr));
    const toLocalExclusive = endExclusiveFromLocalDate(fromDateInputValue(toDateStr));

    return {
      fromIso: fromLocal.toISOString(),
      toIsoExclusive: toLocalExclusive.toISOString(),
    };
  }, [fromDateStr, toDateStr]);

  const rangeLabel = useMemo(() => {
    if (preset === "today") return "Hoy";
    if (preset === "week") return "Esta semana";
    if (preset === "month") return "Este mes";
    return `${fromDateStr} → ${toDateStr}`;
  }, [preset, fromDateStr, toDateStr]);

  const filteredEmployees = useMemo(() => {
    const q = employeeQuery.trim().toLowerCase();
    if (!q) return employees;

    return employees.filter((e) => {
      const name = (e.full_name ?? "").toLowerCase();
      const email = (e.email ?? "").toLowerCase();
      const id = e.id.toLowerCase();
      return name.includes(q) || email.includes(q) || id.includes(q);
    });
  }, [employees, employeeQuery]);

  const groupedPending = useMemo(() => {
    const map = new Map<string, { user_id: string; count: number; latest_created_at: string }>();

    for (const it of items) {
      const prev = map.get(it.user_id);

      if (!prev) {
        map.set(it.user_id, {
          user_id: it.user_id,
          count: 1,
          latest_created_at: it.created_at,
        });
      } else {
        prev.count += 1;
        if (new Date(it.created_at).getTime() > new Date(prev.latest_created_at).getTime()) {
          prev.latest_created_at = it.created_at;
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return new Date(b.latest_created_at).getTime() - new Date(a.latest_created_at).getTime();
    });
  }, [items]);

  function applyPreset(p: Preset) {
    setPreset(p);
    const now = new Date();

    if (p === "today") {
      const d = toDateInputValue(now);
      setFromDateStr(d);
      setToDateStr(d);
      return;
    }

    if (p === "week") {
      setFromDateStr(toDateInputValue(startOfLocalWeek(now)));
      setToDateStr(toDateInputValue(now));
      return;
    }

    if (p === "month") {
      setFromDateStr(toDateInputValue(startOfLocalMonth(now)));
      setToDateStr(toDateInputValue(now));
    }
  }

  function computeMetrics(rows: TimeEntryForMetrics[]) {
    const map = new Map<string, UserMetrics>();
    let total = 0;

    for (const r of rows) {
      if (!r.check_out_at) continue;

      const inMs = new Date(r.check_in_at).getTime();
      const outMs = new Date(r.check_out_at).getTime();
      const diffMs = outMs - inMs;

      if (!Number.isFinite(diffMs) || diffMs <= 0) continue;

      const mins = Math.floor(diffMs / 60000);

      const prev = map.get(r.user_id) ?? {
        user_id: r.user_id,
        closed_entries: 0,
        total_minutes: 0,
      };

      prev.closed_entries += 1;
      prev.total_minutes += mins;

      map.set(r.user_id, prev);
      total += mins;
    }

    return {
      arr: Array.from(map.values()).sort((a, b) => b.total_minutes - a.total_minutes),
      total,
    };
  }

  function displayUser(userId: string) {
    const p = profilesById[userId];
    if (!p) return userId;

    const name = (p.full_name ?? "").trim();
    const email = (p.email ?? "").trim();

    if (name && email) return `${name} (${email})`;
    if (name) return name;
    if (email) return email;
    return userId;
  }

  // ======================================================
  // PARTE 4/6 — CARGA DE DATOS Y ACCIONES
  // ======================================================

  async function loadProfilesForCompany(companyId: string) {
    const { data, error } = await supabase.rpc("admin_company_profiles", {
      p_company_id: companyId,
    });

    if (error) {
      console.error("admin_company_profiles error:", error);
      return;
    }

    const list = (data ?? []) as Profile[];
    const map: Record<string, Profile> = {};

    for (const p of list) map[p.id] = p;

    const sorted = [...list].sort((a, b) => {
      const ak = (a.full_name ?? a.email ?? a.id).toLowerCase();
      const bk = (b.full_name ?? b.email ?? b.id).toLowerCase();
      return ak.localeCompare(bk);
    });

    setProfilesById(map);
    setEmployees(sorted);
  }

  async function load() {
    if (!membership) return;

    setLoading(true);
    setError(null);

    await loadProfilesForCompany(membership.company_id);

    const { data: manualData, error: manualError } = await supabase.rpc(
      "admin_pending_adjustments",
      {
        p_company_id: membership.company_id,
      }
    );

    if (manualError) {
      setError(manualError.message);
      setItems([]);
      setOpenCount(null);
      setOpenEntries([]);
      setEntriesInRange(null);
      setClosesInRange(null);
      setMetricsByUser([]);
      setTotalMinutesInRange(null);
      setInspectionEntries([]);
      setLoading(false);
      return;
    }

    const manual: PendingAdjustment[] = ((manualData ?? []) as Omit<
      PendingAdjustment,
      "source_type"
    >[]).map((item) => ({
      ...item,
      source_type: "manual",
    }));

    const { data: autoRows, error: autoError } = await supabase
      .from("time_entries")
      .select("id,user_id,check_in_at,check_out_at,flags")
      .eq("company_id", membership.company_id)
      .eq("workflow_status", "pending");

    if (autoError) {
      setError(autoError.message);
      setItems([]);
      setOpenCount(null);
      setOpenEntries([]);
      setEntriesInRange(null);
      setClosesInRange(null);
      setMetricsByUser([]);
      setTotalMinutesInRange(null);
      setInspectionEntries([]);
      setLoading(false);
      return;
    }

    const auto: PendingAdjustment[] =
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

    const nextItems = [...manual, ...auto].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    setItems(nextItems);

    const { count, error: openErr } = await supabase
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("company_id", membership.company_id)
      .is("check_out_at", null);

    if (openErr) {
      setError(openErr.message);
      setOpenCount(null);
      setLoading(false);
      return;
    }

    setOpenCount(count ?? 0);

    const { data: openRows, error: openListErr } = await supabase
      .from("time_entries")
      .select("id,user_id,check_in_at")
      .eq("company_id", membership.company_id)
      .is("check_out_at", null)
      .order("check_in_at", { ascending: false })
      .limit(10);

    if (openListErr) {
      setError(openListErr.message);
      setOpenEntries([]);
      setLoading(false);
      return;
    }

    setOpenEntries((openRows ?? []) as OpenEntry[]);

    const { count: entriesCount, error: entriesErr } = await supabase
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("company_id", membership.company_id)
      .gte("check_in_at", range.fromIso)
      .lt("check_in_at", range.toIsoExclusive);

    if (entriesErr) {
      setError(entriesErr.message);
      setEntriesInRange(null);
      setClosesInRange(null);
      setMetricsByUser([]);
      setTotalMinutesInRange(null);
      setInspectionEntries([]);
      setLoading(false);
      return;
    }

    setEntriesInRange(entriesCount ?? 0);

    const { count: closesCount, error: closesErr } = await supabase
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("company_id", membership.company_id)
      .gte("check_out_at", range.fromIso)
      .lt("check_out_at", range.toIsoExclusive);

    if (closesErr) {
      setError(closesErr.message);
      setEntriesInRange(null);
      setClosesInRange(null);
      setMetricsByUser([]);
      setTotalMinutesInRange(null);
      setInspectionEntries([]);
      setLoading(false);
      return;
    }

    setClosesInRange(closesCount ?? 0);

    const { data: metricRows, error: metricErr } = await supabase
      .from("time_entries")
      .select("user_id,check_in_at,check_out_at")
      .eq("company_id", membership.company_id)
      .gte("check_in_at", range.fromIso)
      .lt("check_in_at", range.toIsoExclusive)
      .not("check_out_at", "is", null);

    if (metricErr) {
      setError(metricErr.message);
      setMetricsByUser([]);
      setTotalMinutesInRange(null);
      setInspectionEntries([]);
      setLoading(false);
      return;
    }

    const { arr, total } = computeMetrics((metricRows ?? []) as TimeEntryForMetrics[]);
    setMetricsByUser(arr);
    setTotalMinutesInRange(total);

    const { data: inspRows, error: inspErr } = await supabase
      .from("time_entries")
      .select("id,user_id,check_in_at,check_out_at,status,workflow_status,flags")
      .eq("company_id", membership.company_id)
      .gte("check_in_at", range.fromIso)
      .lt("check_in_at", range.toIsoExclusive)
      .order("check_in_at", { ascending: true });

    if (inspErr) {
      setError(inspErr.message);
      setInspectionEntries([]);
      setLoading(false);
      return;
    }

    setInspectionEntries((inspRows ?? []) as TimeEntryForCsv[]);
    setLoading(false);
  }

  async function resolveManual(adjustmentId: string, decision: "validated" | "rejected") {
    setError(null);

    if (!resolutionReason || resolutionReason.trim().length < 3) {
      setError("Motivo de resolución obligatorio para incidencias manuales (mínimo 3 caracteres).");
      return;
    }

    const { error } = await supabase.rpc("resolve_time_entry_adjustment", {
      p_adjustment_id: adjustmentId,
      p_decision: decision,
      p_resolution_reason: resolutionReason.trim(),
    });

    if (error) {
      setError(error.message);
      return;
    }

    setResolutionReason("");
    await load();
  }

  function openIncidentsPage() {
    navigate("/admin/incidents");
  }

  function exportSummaryCsv() {
    const rows = metricsByUser.map((m) => ({
      company_id: membership?.company_id ?? "",
      range_label: rangeLabel,
      range_from_local: fromDateStr,
      range_to_local: toDateStr,
      user_id: m.user_id,
      full_name: profilesById[m.user_id]?.full_name ?? "",
      email: profilesById[m.user_id]?.email ?? "",
      jornadas_cerradas: m.closed_entries,
      minutos_totales: m.total_minutes,
      horas_formateadas: formatMinutesHm(m.total_minutes),
    }));

    downloadCsv(`solvento_resumen_${fromDateStr}_a_${toDateStr}.csv`, rows);
  }

  async function exportDetailCsv() {
    if (!membership) return;

    setExporting("detail");
    setError(null);

    const { data, error } = await supabase
      .from("time_entries")
      .select("id,user_id,check_in_at,check_out_at,status,workflow_status,created_at,created_by,approved_at,approved_by,flags")
      .eq("company_id", membership.company_id)
      .gte("check_in_at", range.fromIso)
      .lt("check_in_at", range.toIsoExclusive)
      .order("check_in_at", { ascending: true });

    if (error) {
      setError(error.message);
      setExporting(null);
      return;
    }

    const rows = ((data ?? []) as TimeEntryForCsv[]).map((r) => {
      const inMs = new Date(r.check_in_at).getTime();
      const outMs = r.check_out_at ? new Date(r.check_out_at).getTime() : null;
      const minutes = outMs && outMs > inMs ? Math.floor((outMs - inMs) / 60000) : "";
      const p = profilesById[r.user_id];

      return {
        company_id: membership.company_id,
        range_label: rangeLabel,
        range_from_local: fromDateStr,
        range_to_local: toDateStr,
        time_entry_id: r.id,
        user_id: r.user_id,
        full_name: p?.full_name ?? "",
        email: p?.email ?? "",
        check_in_at_utc: r.check_in_at,
        check_out_at_utc: r.check_out_at ?? "",
        duracion_minutos: minutes,
        duracion_hm: typeof minutes === "number" ? formatMinutesHm(minutes) : "",
        status: r.status ?? "",
        workflow_status: r.workflow_status ?? "",
        created_at_utc: r.created_at ?? "",
        created_by: r.created_by ?? "",
        approved_at_utc: r.approved_at ?? "",
        approved_by: r.approved_by ?? "",
        flags_json: r.flags ?? "",
      };
    });

    downloadCsv(`solvento_detalle_${fromDateStr}_a_${toDateStr}.csv`, rows);
    setExporting(null);
  }

  function exportInspectionCsv() {
    if (!membership) return;

    setError(null);

    const rows = (inspectionEntries ?? []).map((r) => {
      const inDate = new Date(r.check_in_at);
      const outDate = r.check_out_at ? new Date(r.check_out_at) : null;
      const inMs = inDate.getTime();
      const outMs = outDate ? outDate.getTime() : null;
      const minutes = outMs && outMs > inMs ? Math.floor((outMs - inMs) / 60000) : "";
      const p = profilesById[r.user_id];

      const trabajador = (p?.full_name ?? "").trim();
      const email = (p?.email ?? "").trim();

      return {
        Empresa: membership.company_id,
        Trabajador: trabajador || email || r.user_id,
        Email: email,
        Fecha: formatLocalDate(inDate),
        "Entrada (local)": formatLocalDateTime(r.check_in_at),
        "Salida (local)": r.check_out_at ? formatLocalDateTime(r.check_out_at) : "",
        "Duración (HH:MM)": minutesToHHMM(minutes),
        "Duración (min)": minutes,
        Estado: r.status ?? "",
        Workflow: r.workflow_status ?? "",
        Flags: summarizeFlags(r.flags),
      };
    });

    const headers = [
      "Empresa",
      "Trabajador",
      "Email",
      "Fecha",
      "Entrada (local)",
      "Salida (local)",
      "Duración (HH:MM)",
      "Duración (min)",
      "Estado",
      "Workflow",
      "Flags",
    ];

    downloadCsv(`SOLVENTO_INSPECCION_${fromDateStr}_a_${toDateStr}.csv`, rows, headers);
  }

  async function onExport(which: "summary" | "detail" | "inspection") {
    if (which === "summary") {
      setExporting("summary");
      try {
        exportSummaryCsv();
      } finally {
        setExporting(null);
      }
      return;
    }

    if (which === "detail") {
      await exportDetailCsv();
      return;
    }

    if (which === "inspection") {
      setExporting("inspection");
      try {
        exportInspectionCsv();
      } finally {
        setExporting(null);
      }
    }
  }

  function goToWorker(userId: string) {
    navigate(`/admin/worker/${userId}?from=${fromDateStr}&to=${toDateStr}`);
  }

  // ======================================================
  // PARTE 5/6 — EFECTOS Y ESTADOS BASE
  // ======================================================

  useEffect(() => {
    if (membershipLoading || !membership) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipLoading, membership?.company_id, range.fromIso, range.toIsoExclusive]);

  if (membershipLoading) return <div className="container">Cargando…</div>;
  if (!membership) return <div className="container">Sin empresa activa.</div>;

  // ======================================================
  // PARTE 6/6 — UI PROPIA DE LA PÁGINA
  // ======================================================

  return (
    <div className="adminPageUi">
      <style>{`
  .adminPageUi {
    display: grid;
    gap: 12px;
  }

  .adminFilters {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .adminPill {
    height: 40px;
    padding: 0 14px;
    border: 1px solid ${adminTheme.colors.border};
    border-radius: 12px;
    background: ${adminTheme.colors.panelSoft};
    color: ${adminTheme.colors.text};
    font-weight: 700;
    cursor: pointer;
  }

  .adminPill.active {
    background: ${adminTheme.colors.primarySoft};
    border-color: ${adminTheme.colors.primary};
    color: ${adminTheme.colors.primary};
  }

  .adminField {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    border: 1px solid ${adminTheme.colors.border};
    border-radius: 12px;
    background: ${adminTheme.colors.panelBg};
  }

  .adminField label {
    font-size: 12px;
    color: ${adminTheme.colors.textSoft};
    font-weight: 700;
  }

  .adminField input {
    background: transparent;
    border: none;
    outline: none;
    color: ${adminTheme.colors.text};
    font-weight: 700;
  }

  .adminBtn {
    height: 40px;
    padding: 0 16px;
    border: 1px solid ${adminTheme.colors.border};
    border-radius: 12px;
    background: ${adminTheme.colors.panelSoft};
    color: ${adminTheme.colors.text};
    font-weight: 700;
    cursor: pointer;
  }

  .adminBtn.primary {
    background: ${adminTheme.colors.primary};
    color: ${adminTheme.colors.textOnPrimary};
    border-color: ${adminTheme.colors.primary};
  }

  .adminBtn.danger {
    background: ${adminTheme.colors.danger};
    color: ${adminTheme.colors.textOnPrimary};
    border-color: ${adminTheme.colors.dangerHover};
  }

  .adminBtn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .adminBadge {
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

  .adminKpiGrid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px;
  }

  .adminKpi {
    border: 1px solid ${adminTheme.colors.border};
    border-radius: 18px;
    background: linear-gradient(180deg, ${adminTheme.colors.panelBg} 0%, ${adminTheme.colors.panelSoft} 100%);
    padding: 16px;
    box-shadow: ${adminTheme.shadow.sm};
  }

  .adminKpiLabel {
    font-size: 13px;
    font-weight: 700;
    color: ${adminTheme.colors.textSoft};
  }

  .adminKpiValue {
    margin-top: 8px;
    font-size: 26px;
    font-weight: 800;
    color: ${adminTheme.colors.text};
  }

  .adminGrid {
    display: grid;
    grid-template-columns: 1.55fr 1fr;
    gap: 12px;
    align-items: start;
  }

  .adminCol {
    display: grid;
    gap: 12px;
  }

  .adminCard {
    border: 1px solid ${adminTheme.colors.border};
    border-radius: 18px;
    background: linear-gradient(180deg, ${adminTheme.colors.panelBg} 0%, ${adminTheme.colors.panelSoft} 100%);
    padding: 16px;
    box-shadow: ${adminTheme.shadow.sm};
  }

  .adminCardTitle {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    color: ${adminTheme.colors.text};
  }

  .adminCardSub {
    margin: 4px 0 0 0;
    font-size: 13px;
    font-weight: 600;
    color: ${adminTheme.colors.textSoft};
  }

  .adminNotice {
    margin-top: 12px;
    padding: 12px;
    border-radius: 12px;
    background: ${adminTheme.colors.dangerSoft};
    color: ${adminTheme.colors.danger};
    border: 1px solid ${adminTheme.colors.danger};
    font-weight: 700;
  }

  .adminTableWrap {
    margin-top: 12px;
    overflow: auto;
    border: 1px solid ${adminTheme.colors.border};
    border-radius: 14px;
    background: ${adminTheme.colors.panelBg};
  }

  .adminTable {
    width: 100%;
    border-collapse: collapse;
  }

  .adminTable th,
  .adminTable td {
    padding: 12px;
    text-align: left;
    border-bottom: 1px solid ${adminTheme.colors.border};
    font-size: 14px;
    color: ${adminTheme.colors.text};
    background: transparent;
  }

  .adminTable th {
    color: ${adminTheme.colors.textSoft};
    font-weight: 800;
    background: ${adminTheme.colors.panelSoft};
  }

  .adminRight {
    text-align: right;
  }

  .adminSearchRow,
  .adminResolveRow {
    margin-top: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .adminInput {
    flex: 1;
    min-width: 220px;
    height: 40px;
    padding: 0 12px;
    border: 1px solid ${adminTheme.colors.border};
    border-radius: 12px;
    background: ${adminTheme.colors.panelBg};
    color: ${adminTheme.colors.text};
    outline: none;
    font-weight: 700;
  }

  .adminInput::placeholder {
    color: ${adminTheme.colors.textMuted};
  }

  @media (max-width: 1200px) {
    .adminKpiGrid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .adminGrid {
      grid-template-columns: 1fr;
    }
  }
`}</style>

      <section className="adminFilters">
        <button
          className={`adminPill ${preset === "today" ? "active" : ""}`}
          onClick={() => applyPreset("today")}
        >
          Hoy
        </button>

        <button
          className={`adminPill ${preset === "week" ? "active" : ""}`}
          onClick={() => applyPreset("week")}
        >
          Semana
        </button>

        <button
          className={`adminPill ${preset === "month" ? "active" : ""}`}
          onClick={() => applyPreset("month")}
        >
          Mes
        </button>

        <button
          className={`adminPill ${preset === "custom" ? "active" : ""}`}
          onClick={() => setPreset("custom")}
        >
          Personalizado
        </button>

        <div className="adminField">
          <label>Desde</label>
          <input
            type="date"
            value={fromDateStr}
            onChange={(e) => {
              setPreset("custom");
              setFromDateStr(e.target.value);
            }}
          />
        </div>

        <div className="adminField">
          <label>Hasta</label>
          <input
            type="date"
            value={toDateStr}
            onChange={(e) => {
              setPreset("custom");
              setToDateStr(e.target.value);
            }}
          />
        </div>

        <button className="adminBtn primary" onClick={load}>
          Aplicar
        </button>

        <div className="adminBadge">Rango: {rangeLabel}</div>
      </section>

      <section className="adminKpiGrid">
        <div className="adminKpi">
          <div className="adminKpiLabel">Trabajando ahora</div>
          <div className="adminKpiValue">{openCount === null ? "…" : openCount}</div>
        </div>

        <div className="adminKpi">
          <div className="adminKpiLabel">Incidencias pendientes</div>
          <div className="adminKpiValue">{loading ? "…" : items.length}</div>
        </div>

        <div className="adminKpi">
          <div className="adminKpiLabel">Entradas en rango</div>
          <div className="adminKpiValue">{entriesInRange === null ? "…" : entriesInRange}</div>
        </div>

        <div className="adminKpi">
          <div className="adminKpiLabel">Cierres en rango</div>
          <div className="adminKpiValue">{closesInRange === null ? "…" : closesInRange}</div>
        </div>

        <div className="adminKpi">
          <div className="adminKpiLabel">Total horas</div>
          <div className="adminKpiValue">
            {totalMinutesInRange === null ? "…" : formatMinutesHm(totalMinutesInRange)}
          </div>
        </div>
      </section>

      <section className="adminGrid">
        <div className="adminCol">
          <section className="adminCard">
            <h2 className="adminCardTitle">Incidencias pendientes</h2>
            <p className="adminCardSub">Agrupadas por trabajador</p>

            {loading && <p className="adminCardSub">Cargando…</p>}

            {!loading && groupedPending.length === 0 && (
              <p className="adminCardSub">No hay incidencias pendientes.</p>
            )}

            {!loading && groupedPending.length > 0 && (
              <div className="adminTableWrap">
                <table className="adminTable">
                  <thead>
                    <tr>
                      <th>Trabajador</th>
                      <th className="adminRight">Pendientes</th>
                      <th>Última incidencia</th>
                      <th className="adminRight"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedPending.map((g) => (
                      <tr key={g.user_id}>
                        <td>{displayUser(g.user_id)}</td>
                        <td className="adminRight">{g.count}</td>
                        <td>{new Date(g.latest_created_at).toLocaleString()}</td>
                        <td className="adminRight">
                          <button className="adminBtn primary" onClick={() => goToWorker(g.user_id)}>
                            Ver ficha
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="adminCard">
            <h2 className="adminCardTitle">Jornadas abiertas</h2>
            <p className="adminCardSub">Últimas 10</p>

            {!loading && openEntries.length === 0 && (
              <p className="adminCardSub">No hay nadie en turno ahora mismo.</p>
            )}

            {!loading && openEntries.length > 0 && (
              <div className="adminTableWrap">
                <table className="adminTable">
                  <thead>
                    <tr>
                      <th>Trabajador</th>
                      <th>Entrada</th>
                      <th className="adminRight">Tiempo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openEntries.map((e) => (
                      <tr key={e.id}>
                        <td>{displayUser(e.user_id)}</td>
                        <td>{new Date(e.check_in_at).toLocaleString()}</td>
                        <td className="adminRight">{formatElapsedHm(e.check_in_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="adminCard">
            <h2 className="adminCardTitle">Resolver incidencias</h2>
            <p className="adminCardSub">
              Las incidencias manuales pueden resolverse aquí. Las automáticas deben revisarse en su pantalla específica.
            </p>

            <div className="adminResolveRow">
              <input
                className="adminInput"
                value={resolutionReason}
                onChange={(e) => setResolutionReason(e.target.value)}
                placeholder="Motivo de resolución para incidencias manuales"
              />

              <button
                className="adminBtn"
                onClick={() => onExport("summary")}
                disabled={exporting !== null || metricsByUser.length === 0}
              >
                {exporting === "summary" ? "Exportando…" : "CSV Resumen"}
              </button>

              <button
                className="adminBtn"
                onClick={() => onExport("detail")}
                disabled={exporting !== null}
              >
                {exporting === "detail" ? "Exportando…" : "CSV Detalle"}
              </button>

              <button
                className="adminBtn primary"
                onClick={() => onExport("inspection")}
                disabled={exporting !== null}
              >
                {exporting === "inspection" ? "Exportando…" : "Inspección"}
              </button>
            </div>

            {error && <div className="adminNotice">{error}</div>}

            {!loading && items.length === 0 && (
              <p className="adminCardSub" style={{ marginTop: 12 }}>
                No hay incidencias pendientes.
              </p>
            )}

            {!loading && items.length > 0 && (
              <div className="adminTableWrap">
                <table className="adminTable">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Trabajador</th>
                      <th>Entrada</th>
                      <th>Salida propuesta</th>
                      <th>Motivo</th>
                      <th className="adminRight"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.adjustment_id}>
                        <td>{getIncidentTypeLabel(it.source_type)}</td>
                        <td>{displayUser(it.user_id)}</td>
                        <td>{new Date(it.check_in_at).toLocaleString()}</td>
                        <td>{new Date(it.proposed_check_out).toLocaleString()}</td>
                        <td>{formatReason(it.reason)}</td>
                        <td className="adminRight">
                          {isAutomaticIncident(it) ? (
                            <button
                              className="adminBtn primary"
                              onClick={openIncidentsPage}
                            >
                              Revisar
                            </button>
                          ) : (
                            <>
                              <button
                                className="adminBtn primary"
                                onClick={() => resolveManual(it.adjustment_id, "validated")}
                                style={{ marginRight: 8 }}
                              >
                                Validar
                              </button>
                              <button
                                className="adminBtn danger"
                                onClick={() => resolveManual(it.adjustment_id, "rejected")}
                              >
                                Rechazar
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="adminCol">
          <section className="adminCard">
            <h2 className="adminCardTitle">Empleados</h2>
            <p className="adminCardSub">Buscar y abrir ficha</p>

            <div className="adminSearchRow">
              <input
                className="adminInput"
                value={employeeQuery}
                onChange={(e) => setEmployeeQuery(e.target.value)}
                placeholder="Buscar por nombre / email"
              />
              <div className="adminBadge">
                {filteredEmployees.length}/{employees.length}
              </div>
            </div>

            {employees.length === 0 && (
              <p className="adminCardSub" style={{ marginTop: 12 }}>
                No hay empleados.
              </p>
            )}

            {employees.length > 0 && (
              <div className="adminTableWrap">
                <table className="adminTable">
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Email</th>
                      <th className="adminRight"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((e) => (
                      <tr key={e.id}>
                        <td>{(e.full_name ?? "").trim() || "—"}</td>
                        <td>{e.email ?? "—"}</td>
                        <td className="adminRight">
                          <button className="adminBtn primary" onClick={() => goToWorker(e.id)}>
                            Ver ficha
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="adminCard">
            <h2 className="adminCardTitle">Horas por trabajador</h2>
            <p className="adminCardSub">Resumen dentro del rango</p>

            {!loading && metricsByUser.length === 0 && (
              <p className="adminCardSub">No hay jornadas cerradas en este rango.</p>
            )}

            {!loading && metricsByUser.length > 0 && (
              <div className="adminTableWrap">
                <table className="adminTable">
                  <thead>
                    <tr>
                      <th>Trabajador</th>
                      <th className="adminRight">Jornadas</th>
                      <th className="adminRight">Horas</th>
                      <th className="adminRight"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricsByUser.map((m) => (
                      <tr key={m.user_id}>
                        <td>{displayUser(m.user_id)}</td>
                        <td className="adminRight">{m.closed_entries}</td>
                        <td className="adminRight">{formatMinutesHm(m.total_minutes)}</td>
                        <td className="adminRight">
                          <button className="adminBtn primary" onClick={() => goToWorker(m.user_id)}>
                            Ver ficha
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}