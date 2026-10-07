import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { fetchAllRows } from "../lib/fetchAllRows";
import { formatFechaHoraMadrid, formatFechaMadrid } from "../lib/madrid";
import { useActiveMembership } from "../app/useActiveMembership";
import { adminTheme } from "../ui/adminTheme";
import {
  CATEGORIAS,
  categoriaDeIncidencia,
  type CategoriaClave,
} from "../lib/incidentCategories";

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
  categoria: CategoriaClave;
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
  workflow_status: string | null;
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
  status?: string | null;
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

// Antes se formateaba con getHours() (zona del navegador). Ahora
// siempre en hora de Madrid, que es la del registro legal.
function formatLocalDateTime(iso: string) {
  return formatFechaHoraMadrid(iso);
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

  // Antes un nombre o motivo que empezara por = + - @ se abria en Excel
  // como formula (CSV injection). Ahora se neutraliza con un apostrofo.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;

  const needsQuotes = /[",\n\r;]/.test(safe);
  const escaped = safe.replace(/"/g, '""');
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

  // Antes un doble clic en Validar/Rechazar lanzaba dos resoluciones.
  // Ahora se bloquea la incidencia mientras se resuelve.
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Antes, al cambiar de rango con una carga en curso, la respuesta vieja
  // podia llegar la ultima y dejar datos (y CSV) de otro periodo. Ahora
  // cada carga lleva su numero y se descarta si ya no es la ultima.
  const loadReqRef = useRef(0);

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

  const pendientesPorTipo = useMemo(() => {
    const cuenta = new Map<CategoriaClave, number>();
    for (const it of items) cuenta.set(it.categoria, (cuenta.get(it.categoria) ?? 0) + 1);
    return CATEGORIAS.map((c) => ({ ...c, total: cuenta.get(c.clave) ?? 0 })).filter(
      (c) => c.total > 0,
    );
  }, [items]);

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
      // Antes las jornadas rechazadas sumaban horas. Ahora no computan
      // (las pendientes si: casi todas son "mas de 7 h" por revisar).
      if (r.workflow_status === "rejected") continue;

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

  // Se piden TODOS los perfiles, tambien los de baja. Antes solo se
  // pedian los activos, asi que en informes y exportaciones las horas de
  // quien ya no esta salian con un codigo en vez de su nombre, y el
  // fichero parecia correcto. El listado de empleados si sigue mostrando
  // solo a los activos.
  async function loadProfilesForCompany(companyId: string) {
    const { data, error } = await supabase.rpc("admin_company_profiles_all", {
      p_company_id: companyId,
    });

    if (error) {
      setError(
        "No se han podido cargar los nombres de los trabajadores: " +
          error.message,
      );
      return;
    }

    const list = (data ?? []) as Profile[];
    const map: Record<string, Profile> = {};

    for (const p of list) map[p.id] = p;

    const sorted = list
      .filter((p) => (p.status ?? "active") === "active")
      .sort((a, b) => {
        const ak = (a.full_name ?? a.email ?? a.id).toLowerCase();
        const bk = (b.full_name ?? b.email ?? b.id).toLowerCase();
        return ak.localeCompare(bk);
      });

    setProfilesById(map);
    setEmployees(sorted);
  }

  async function load() {
    if (!membership) return;

    const reqId = ++loadReqRef.current;
    const esVieja = () => reqId !== loadReqRef.current;

    setLoading(true);
    setError(null);

    await loadProfilesForCompany(membership.company_id);
    if (esVieja()) return;

    const { data: manualData, error: manualError } = await supabase.rpc(
      "admin_pending_adjustments",
      {
        p_company_id: membership.company_id,
      }
    );

    if (esVieja()) return;

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
      "source_type" | "categoria"
    >[]).map((item) => ({
      ...item,
      source_type: "manual",
      categoria: "trabajador",
    }));

    // Se pide por bloques: sin paginar, esta consulta se cortaba a las
    // 1.000 primeras filas en silencio en cuanto se acumularan.
    const { data: autoRows, error: autoError } = await fetchAllRows<any>(
      (desde, hasta) =>
        supabase
          .from("time_entries")
          .select("id,user_id,check_in_at,check_out_at,flags")
          .eq("company_id", membership.company_id)
          .eq("workflow_status", "pending")
          .order("check_in_at", { ascending: false })
          .range(desde, hasta),
    );

    if (esVieja()) return;

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
        categoria: categoriaDeIncidencia(e.flags?.auto_incident_reason, "automatic"),
      })) ?? [];

    // La bandeja de incidencias se alimenta de tres sitios y este panel
    // solo miraba dos: el contador de la portada decia 86 cuando en la
    // pantalla de incidencias habia 334.
    // Por bloques: sin paginar se cortaba a 1.000 solicitudes en silencio.
    const { data: solicitudRows, error: solicitudError } = await fetchAllRows(
      (desde, hasta) =>
        supabase
          .from("time_entry_requests")
          .select("id,time_entry_id,requested_by,requested_at,reason,status")
          .eq("company_id", membership.company_id)
          .eq("status", "pending")
          .order("requested_at", { ascending: false })
          .range(desde, hasta),
    );

    if (esVieja()) return;

    if (solicitudError) {
      setError(solicitudError.message);
      setItems([]);
      setLoading(false);
      return;
    }

    const solicitudes: PendingAdjustment[] = ((solicitudRows ?? []) as any[]).map(
      (r) => ({
        adjustment_id: `req-${r.id}`,
        time_entry_id: r.time_entry_id ?? "",
        user_id: r.requested_by,
        check_in_at: r.requested_at,
        proposed_check_out: r.requested_at,
        reason: r.reason ?? "Incidencia pendiente",
        created_at: r.requested_at,
        source_type: "automatic",
        categoria: categoriaDeIncidencia(r.reason, "time_request"),
      }),
    );

    const nextItems = [...manual, ...auto, ...solicitudes].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    setItems(nextItems);

    // "Trabajando ahora" contaba TODAS las jornadas sin cerrar desde que
    // existe la aplicacion, asi que cada olvido de fichar la salida subia
    // ese numero para siempre. Ahora solo cuenta las de hoy.
    const inicioDeHoy = startOfLocalDay(new Date()).toISOString();

    const { count, error: openErr } = await supabase
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("company_id", membership.company_id)
      .is("check_out_at", null)
      .gte("check_in_at", inicioDeHoy);

    if (esVieja()) return;

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

    if (esVieja()) return;

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

    if (esVieja()) return;

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

    if (esVieja()) return;

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

    // Por bloques: si se cortaba a 1.000 filas, el total de horas
    // que se mostraba era menor que el real.
    const { data: metricRows, error: metricErr } = await fetchAllRows<TimeEntryForMetrics>(
      (desde, hasta) =>
        supabase
          .from("time_entries")
          .select("user_id,check_in_at,check_out_at,workflow_status")
          .eq("company_id", membership.company_id)
          .gte("check_in_at", range.fromIso)
          .lt("check_in_at", range.toIsoExclusive)
          .not("check_out_at", "is", null)
          .order("check_in_at", { ascending: true })
          .range(desde, hasta),
    );

    if (esVieja()) return;

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

    const { data: inspRows, error: inspErr } = await fetchAllRows<any>(
      (desde, hasta) =>
        supabase
          .from("time_entries")
          .select("id,user_id,check_in_at,check_out_at,status,workflow_status,flags")
          .eq("company_id", membership.company_id)
          .gte("check_in_at", range.fromIso)
          .lt("check_in_at", range.toIsoExclusive)
          .order("check_in_at", { ascending: true })
          .range(desde, hasta),
    );

    if (esVieja()) return;

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
    if (resolvingId) return;
    setError(null);

    if (!resolutionReason || resolutionReason.trim().length < 3) {
      setError("Motivo de resolución obligatorio para incidencias manuales (mínimo 3 caracteres).");
      return;
    }

    setResolvingId(adjustmentId);
    try {
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
    } finally {
      setResolvingId(null);
    }
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

    const { data, error } = await fetchAllRows<TimeEntryForCsv>((desde, hasta) =>
      supabase
        .from("time_entries")
        .select("id,user_id,check_in_at,check_out_at,status,workflow_status,created_at,created_by,approved_at,approved_by,flags")
        .eq("company_id", membership.company_id)
        .gte("check_in_at", range.fromIso)
        .lt("check_in_at", range.toIsoExclusive)
        .order("check_in_at", { ascending: true })
        .range(desde, hasta),
    );

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
        entrada_local: formatLocalDateTime(r.check_in_at),
        salida_local: r.check_out_at ? formatLocalDateTime(r.check_out_at) : "",
        check_in_at_utc: r.check_in_at,
        check_out_at_utc: r.check_out_at ?? "",
        duracion_minutos: minutes,
        duracion_hm: typeof minutes === "number" ? formatMinutesHm(minutes) : "",
        // La fila rechazada se mantiene (trazabilidad) pero no computa.
        computa: r.workflow_status === "rejected" ? "No" : "Sí",
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
      const outDate = r.check_out_at ? new Date(r.check_out_at) : null;
      const inMs = new Date(r.check_in_at).getTime();
      const outMs = outDate ? outDate.getTime() : null;
      const minutes = outMs && outMs > inMs ? Math.floor((outMs - inMs) / 60000) : "";
      const p = profilesById[r.user_id];

      const trabajador = (p?.full_name ?? "").trim();
      const email = (p?.email ?? "").trim();

      return {
        Empresa: membership.company_id,
        Trabajador: trabajador || email || r.user_id,
        Email: email,
        Fecha: formatFechaMadrid(r.check_in_at),
        "Entrada (local)": formatLocalDateTime(r.check_in_at),
        "Salida (local)": r.check_out_at ? formatLocalDateTime(r.check_out_at) : "",
        "Duración (HH:MM)": minutesToHHMM(minutes),
        "Duración (min)": minutes,
        // La fila rechazada se mantiene (trazabilidad) pero no computa.
        Computa: r.workflow_status === "rejected" ? "No" : "Sí",
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
      "Computa",
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

  .adminKpiLink {
    cursor: pointer;
  }

  .adminKpiLink:hover {
    border-color: ${adminTheme.colors.primary};
  }

  .adminTipoLista {
    margin-top: 12px;
    display: grid;
    gap: 6px;
  }

  .adminTipoFila {
    display: grid;
    grid-template-columns: minmax(150px, 220px) 1fr 44px;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid ${adminTheme.colors.border};
    border-radius: 12px;
    background: ${adminTheme.colors.panelBg};
    color: ${adminTheme.colors.text};
    cursor: pointer;
    text-align: left;
    font: inherit;
  }

  .adminTipoFila:hover {
    border-color: ${adminTheme.colors.primary};
    background: ${adminTheme.colors.primarySoft};
  }

  .adminTipoNombre {
    font-weight: 700;
    font-size: 14px;
  }

  .adminTipoBarra {
    height: 8px;
    border-radius: 999px;
    background: ${adminTheme.colors.panelSoft};
    overflow: hidden;
  }

  .adminTipoRelleno {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: ${adminTheme.colors.primary};
  }

  .adminTipoNum {
    text-align: right;
    font-weight: 800;
    font-size: 15px;
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

        <div
          className="adminKpi adminKpiLink"
          role="link"
          tabIndex={0}
          onClick={openIncidentsPage}
          onKeyDown={(e) => {
            if (e.key === "Enter") openIncidentsPage();
          }}
        >
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
          {!loading && pendientesPorTipo.length > 0 && (
            <section className="adminCard">
              <h2 className="adminCardTitle">Qué hay pendiente</h2>
              <p className="adminCardSub">
                Por tipo. Pulsa uno para verlo en la bandeja y resolverlo.
              </p>
              <div className="adminTipoLista">
                {pendientesPorTipo.map((c) => (
                  <button
                    key={c.clave}
                    className="adminTipoFila"
                    title={c.ayuda}
                    onClick={() => navigate(`/admin/incidents?tipo=${c.clave}`)}
                  >
                    <span className="adminTipoNombre">{c.etiqueta}</span>
                    <span className="adminTipoBarra">
                      <span
                        className="adminTipoRelleno"
                        style={{ width: `${Math.max(4, (c.total / items.length) * 100)}%` }}
                      />
                    </span>
                    <span className="adminTipoNum">{c.total}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

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
                        <td>{formatFechaHoraMadrid(g.latest_created_at)}</td>
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
            {/* Antes se rotulaba "Jornadas abiertas" junto a "Trabajando ahora"
                (que solo cuenta las de hoy), pero la lista incluye olvidos de
                dias anteriores. Ahora se llama por lo que es. */}
            <h2 className="adminCardTitle">Jornadas sin cerrar</h2>
            <p className="adminCardSub">Últimas 10, incluidas las de días anteriores</p>

            {!loading && openEntries.length === 0 && (
              <p className="adminCardSub">No hay jornadas sin cerrar.</p>
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
                        <td>{formatFechaHoraMadrid(e.check_in_at)}</td>
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

              {/* Antes se podia exportar mientras cargaba el nuevo rango y
                  salian datos del rango anterior. Ahora se espera a la carga. */}
              <button
                className="adminBtn"
                onClick={() => onExport("summary")}
                disabled={loading || exporting !== null || metricsByUser.length === 0}
              >
                {exporting === "summary" ? "Exportando…" : "CSV Resumen"}
              </button>

              <button
                className="adminBtn"
                onClick={() => onExport("detail")}
                disabled={loading || exporting !== null}
              >
                {exporting === "detail" ? "Exportando…" : "CSV Detalle"}
              </button>

              <button
                className="adminBtn primary"
                onClick={() => onExport("inspection")}
                disabled={loading || exporting !== null}
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
                        <td>{formatFechaHoraMadrid(it.check_in_at)}</td>
                        <td>{formatFechaHoraMadrid(it.proposed_check_out)}</td>
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
                                disabled={resolvingId !== null}
                                style={{ marginRight: 8 }}
                              >
                                Validar
                              </button>
                              <button
                                className="adminBtn danger"
                                onClick={() => resolveManual(it.adjustment_id, "rejected")}
                                disabled={resolvingId !== null}
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

            {/* Las altas y bajas viven en la pantalla Empleados, pero su
                acceso era solo un icono sin texto en el menu lateral y no
                se encontraba. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <button
                className="adminBtn primary"
                onClick={() => navigate("/admin/employees?alta=1")}
              >
                + Dar de alta a un trabajador
              </button>
              <button className="adminBtn" onClick={() => navigate("/admin/employees")}>
                Bajas, reactivaciones y PIN
              </button>
            </div>

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
