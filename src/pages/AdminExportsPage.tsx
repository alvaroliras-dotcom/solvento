import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useActiveMembership } from "../app/useActiveMembership";
import { adminTheme } from "../ui/adminTheme";

// ======================================================
// PARTE 1/6 — TIPOS Y HELPERS
// ======================================================

type TimeEntryRow = {
  id: string;
  user_id: string;
  check_in_at: string;
  check_out_at: string | null;
  status: string | null;
  workflow_status: string | null;
  flags: any | null;
};

type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type ExportType = "inspection" | "company_summary" | "worker_detail";
type Preset = "today" | "week" | "month" | "custom";

type PreviewRow = {
  id: string;
  user_id: string;
  worker_name: string;
  worker_email: string;
  check_in_at: string;
  check_out_at: string | null;
  duration_minutes: number;
  status: string;
  workflow_status: string;
  flags: any | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
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

function formatLocalDateTime(iso: string) {
  const d = new Date(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatOptionalLocalDateTime(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return formatLocalDateTime(value);
}

function safeDurationMinutes(checkInIso: string, checkOutIso: string | null) {
  if (!checkOutIso) return 0;
  const inMs = new Date(checkInIso).getTime();
  const outMs = new Date(checkOutIso).getTime();
  const diff = outMs - inMs;
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return Math.floor(diff / 60000);
}

function formatMinutes(mins: number) {
  if (!mins || mins <= 0) return "0 h";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h} h ${m} min`;
  if (h > 0) return `${h} h`;
  return `${m} min`;
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
  headers: string[]
) {
  const lines = [
    headers.map(csvEscape).join(";"),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(";")),
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

function translateWorkflow(workflow: string | null | undefined) {
  switch (workflow) {
    case "auto":
      return "Sin incidencia";
    case "pending":
      return "Pendiente";
    case "adjusted":
      return "Ajustada";
    case "requires_new_proposal":
      return "Requiere nueva propuesta";
    case "rejected":
      return "Rechazada";
    default:
      return workflow ?? "";
  }
}

function translateStatus(status: string | null | undefined) {
  switch (status) {
    case "open":
      return "Abierta";
    case "closed":
      return "Cerrada";
    default:
      return status ?? "";
  }
}

function formatReason(value: unknown) {
  if (typeof value !== "string" || !value) return "";

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

function formatBoolForCsv(value: unknown) {
  if (value === true) return "Sí";
  if (value === false) return "No";
  return "";
}

function formatNumberForCsv(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  return Math.round(value);
}

function getInspectionReason(row: PreviewRow) {
  const flags = row.flags ?? {};
  return formatReason(
    flags?.auto_incident_reason ??
      flags?.check_in_geo_reason ??
      flags?.check_out_geo_reason ??
      flags?.reason ??
      ""
  );
}

function getAdminResolutionDecision(row: PreviewRow) {
  const flags = row.flags ?? {};
  return flags?.admin_resolution_decision === "validated"
    ? "Validada"
    : flags?.admin_resolution_decision === "rejected"
    ? "Rechazada"
    : "";
}

function getAdminResolutionReason(row: PreviewRow) {
  const flags = row.flags ?? {};
  return typeof flags?.admin_resolution_reason === "string"
    ? flags.admin_resolution_reason.trim()
    : "";
}

function getAdminResolutionAt(row: PreviewRow) {
  const flags = row.flags ?? {};
  return formatOptionalLocalDateTime(flags?.admin_resolution_at);
}

function getAdminOldCheckOutAt(row: PreviewRow) {
  const flags = row.flags ?? {};
  return formatOptionalLocalDateTime(flags?.admin_old_check_out_at);
}

function getAdminNewCheckOutAt(row: PreviewRow) {
  const flags = row.flags ?? {};
  return formatOptionalLocalDateTime(flags?.admin_new_check_out_at);
}

function getInspectionExportRow(r: PreviewRow) {
  const flags = r.flags ?? {};

  return {
    Trabajador: r.worker_name,
    Email: r.worker_email,
    Entrada: formatLocalDateTime(r.check_in_at),
    Salida: r.check_out_at ? formatLocalDateTime(r.check_out_at) : "",
    "Duración (min)": r.duration_minutes,
    Duración: formatMinutes(r.duration_minutes),
    Estado: translateStatus(r.status),
    Workflow: translateWorkflow(r.workflow_status),
    "Motivo incidencia": getInspectionReason(r),
    "Entrada fuera centro": formatBoolForCsv(flags?.check_in_geo_outside_workplace),
    "Salida fuera centro": formatBoolForCsv(flags?.check_out_geo_outside_workplace),
    "Distancia entrada (m)": formatNumberForCsv(flags?.check_in_geo_distance_to_workplace_m),
    "Distancia salida (m)": formatNumberForCsv(flags?.check_out_geo_distance_to_workplace_m),
    "Precisión entrada (m)": formatNumberForCsv(flags?.check_in_geo_accuracy_m),
    "Precisión salida (m)": formatNumberForCsv(flags?.check_out_geo_accuracy_m),
    "Resolución admin": getAdminResolutionDecision(r),
    "Motivo resolución admin": getAdminResolutionReason(r),
    "Fecha resolución admin": getAdminResolutionAt(r),
    "Salida original": getAdminOldCheckOutAt(r),
    "Salida corregida": getAdminNewCheckOutAt(r),
  };
}

// ======================================================
// PARTE 2/6 — COMPONENTE Y ESTADO
// ======================================================

export function AdminExportsPage() {
  const { membership, loading: membershipLoading } = useActiveMembership();

  const today = useMemo(() => new Date(), []);
  const [preset, setPreset] = useState<Preset>("today");
  const [fromDateStr, setFromDateStr] = useState<string>(toDateInputValue(today));
  const [toDateStr, setToDateStr] = useState<string>(toDateInputValue(today));

  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [selectedExportType, setSelectedExportType] = useState<ExportType>("inspection");
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>("all");

  // ======================================================
  // PARTE 3/6 — RANGO, FILTROS Y MÉTRICAS
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

  const workerOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; email: string }>();

    for (const row of previewRows) {
      if (!map.has(row.user_id)) {
        map.set(row.user_id, {
          id: row.user_id,
          name: row.worker_name,
          email: row.worker_email,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [previewRows]);

  const filteredPreviewRows = useMemo(() => {
    if (selectedWorkerId === "all") return previewRows;
    return previewRows.filter((r) => r.user_id === selectedWorkerId);
  }, [previewRows, selectedWorkerId]);

  const previewRowsForTable = useMemo(() => {
    return filteredPreviewRows.slice(0, 80);
  }, [filteredPreviewRows]);

  const metrics = useMemo(() => {
    const baseRows = selectedWorkerId === "all" ? previewRows : filteredPreviewRows;

    const totalEntries = baseRows.length;
    const totalMinutes = baseRows.reduce((acc, row) => acc + row.duration_minutes, 0);
    const openEntries = baseRows.filter((row) => !row.check_out_at).length;
    const incidentEntries = baseRows.filter(
      (row) => row.workflow_status === "pending"
    ).length;
    const adjustedEntries = baseRows.filter(
      (row) =>
        row.workflow_status === "adjusted" ||
        row.workflow_status === "requires_new_proposal" ||
        row.workflow_status === "rejected"
    ).length;
    const completedEntries = baseRows.filter((row) => !!row.check_out_at).length;
    const compliancePercent =
      totalEntries > 0 ? Math.round((completedEntries / totalEntries) * 100) : 0;

    return {
      totalEntries,
      totalMinutes,
      openEntries,
      incidentEntries,
      adjustedEntries,
      completedEntries,
      compliancePercent,
    };
  }, [previewRows, filteredPreviewRows, selectedWorkerId]);

  const summaryByWorker = useMemo(() => {
    const source =
      selectedWorkerId === "all"
        ? previewRows
        : previewRows.filter((r) => r.user_id === selectedWorkerId);

    const map = new Map<
      string,
      {
        Trabajador: string;
        Email: string;
        Jornadas: number;
        "Horas totales (min)": number;
        "Jornadas abiertas": number;
        Incidencias: number;
      }
    >();

    for (const row of source) {
      const key = row.user_id;

      if (!map.has(key)) {
        map.set(key, {
          Trabajador: row.worker_name,
          Email: row.worker_email,
          Jornadas: 0,
          "Horas totales (min)": 0,
          "Jornadas abiertas": 0,
          Incidencias: 0,
        });
      }

      const item = map.get(key)!;
      item["Jornadas"] += 1;
      item["Horas totales (min)"] += row.duration_minutes;
      if (!row.check_out_at) item["Jornadas abiertas"] += 1;
      if (row.workflow_status === "pending") item["Incidencias"] += 1;
    }

    return Array.from(map.values()).sort((a, b) =>
      String(a["Trabajador"]).localeCompare(String(b["Trabajador"]))
    );
  }, [previewRows, selectedWorkerId]);

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

  // ======================================================
  // PARTE 4/6 — CARGA DE DATOS Y EXPORTACIONES
  // ======================================================

  async function loadPreviewData() {
    if (!membership) return;

    setPreviewLoading(true);
    setError(null);

    const { data: profilesData, error: profilesError } = await supabase.rpc(
      "admin_company_profiles",
      { p_company_id: membership.company_id }
    );

    if (profilesError) {
      setPreviewLoading(false);
      setError(profilesError.message);
      return;
    }

    const nextProfiles = (profilesData ?? []) as Profile[];

    const profilesById: Record<string, Profile> = {};
    for (const p of nextProfiles) profilesById[p.id] = p;

    const { data, error } = await supabase
      .from("time_entries")
      .select("id,user_id,check_in_at,check_out_at,status,workflow_status,flags")
      .eq("company_id", membership.company_id)
      .gte("check_in_at", range.fromIso)
      .lt("check_in_at", range.toIsoExclusive)
      .order("check_in_at", { ascending: false });

    if (error) {
      setPreviewLoading(false);
      setError(error.message);
      return;
    }

    const rows = ((data ?? []) as TimeEntryRow[]).map((r) => {
      const profile = profilesById[r.user_id];
      return {
        id: r.id,
        user_id: r.user_id,
        worker_name:
          (profile?.full_name ?? "").trim() ||
          (profile?.email ?? "").trim() ||
          r.user_id,
        worker_email: profile?.email ?? "",
        check_in_at: r.check_in_at,
        check_out_at: r.check_out_at,
        duration_minutes: safeDurationMinutes(r.check_in_at, r.check_out_at),
        status: r.status ?? "",
        workflow_status: r.workflow_status ?? "",
        flags: r.flags ?? null,
      };
    });

    setPreviewRows(rows);
    setPreviewLoading(false);
  }

  async function exportCsv(type: ExportType) {
    setLoading(true);
    setError(null);

    try {
      if (type === "inspection") {
        const source =
          selectedWorkerId === "all"
            ? previewRows
            : previewRows.filter((r) => r.user_id === selectedWorkerId);

        const rows = source.map(getInspectionExportRow);

        downloadCsv(
          `cerbero_inspeccion_${fromDateStr}_a_${toDateStr}.csv`,
          rows,
          [
            "Trabajador",
            "Email",
            "Entrada",
            "Salida",
            "Duración (min)",
            "Duración",
            "Estado",
            "Workflow",
            "Motivo incidencia",
            "Entrada fuera centro",
            "Salida fuera centro",
            "Distancia entrada (m)",
            "Distancia salida (m)",
            "Precisión entrada (m)",
            "Precisión salida (m)",
            "Resolución admin",
            "Motivo resolución admin",
            "Fecha resolución admin",
            "Salida original",
            "Salida corregida",
          ]
        );
      }

      if (type === "company_summary") {
        downloadCsv(
          `cerbero_resumen_empresa_${fromDateStr}_a_${toDateStr}.csv`,
          summaryByWorker,
          ["Trabajador", "Email", "Jornadas", "Horas totales (min)", "Jornadas abiertas", "Incidencias"]
        );
      }

      if (type === "worker_detail") {
        if (selectedWorkerId === "all") {
          setError("Para la exportación individual debes seleccionar un trabajador concreto.");
          setLoading(false);
          return;
        }

        const source = previewRows.filter((r) => r.user_id === selectedWorkerId);

        const rows = source.map((r) => ({
          Trabajador: r.worker_name,
          Email: r.worker_email,
          Entrada: formatLocalDateTime(r.check_in_at),
          Salida: r.check_out_at ? formatLocalDateTime(r.check_out_at) : "",
          "Duración (min)": r.duration_minutes,
          Estado: translateStatus(r.status),
          Workflow: translateWorkflow(r.workflow_status),
          "Motivo incidencia": getInspectionReason(r),
        }));

        const selectedWorkerName =
          source[0]?.worker_name?.replace(/\s+/g, "_").toLowerCase() ?? "trabajador";

        downloadCsv(
          `cerbero_detalle_${selectedWorkerName}_${fromDateStr}_a_${toDateStr}.csv`,
          rows,
          ["Trabajador", "Email", "Entrada", "Salida", "Duración (min)", "Estado", "Workflow", "Motivo incidencia"]
        );
      }

      setSelectedExportType(type);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo generar la exportación.");
    } finally {
      setLoading(false);
    }
  }

  // ======================================================
  // PARTE 5/6 — EFECTOS Y ESTADOS BASE
  // ======================================================

  useEffect(() => {
    if (!membership) return;
    loadPreviewData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membership?.company_id, range.fromIso, range.toIsoExclusive]);

  if (membershipLoading) return <div style={{ padding: 24 }}>Cargando…</div>;
  if (!membership) return <div style={{ padding: 24 }}>Sin empresa activa.</div>;

  // ======================================================
  // PARTE 6/6 — UI DE LA PÁGINA
  // ======================================================

   // ======================================================
  // PARTE 6/6 — UI DE LA PÁGINA
  // ======================================================

  return (
    <div className="adminExpPageUi">
      <style>{`
      .adminExpPageUi {
        display: grid;
        gap: 12px;
      }

      .adminExpFilters {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }

      .adminExpPill {
        height: 40px;
        padding: 0 14px;
        border: 1px solid ${adminTheme.colors.border};
        border-radius: ${adminTheme.radius.md};
        background: ${adminTheme.colors.panelSoft};
        color: ${adminTheme.colors.text};
        font-weight: 700;
        cursor: pointer;
        transition: background .18s ease, border-color .18s ease, color .18s ease;
      }

      .adminExpPill.active {
        background: ${adminTheme.colors.primarySoft};
        border-color: ${adminTheme.colors.primary};
        color: ${adminTheme.colors.primary};
      }

      .adminExpField {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 40px;
        padding: 0 12px;
        border: 1px solid ${adminTheme.colors.border};
        border-radius: ${adminTheme.radius.md};
        background: ${adminTheme.colors.panelBg};
      }

      .adminExpField label {
        font-size: 12px;
        color: ${adminTheme.colors.textSoft};
        font-weight: 700;
        white-space: nowrap;
      }

      .adminExpField input {
        background: transparent;
        border: none;
        outline: none;
        color: ${adminTheme.colors.text};
        font-weight: 700;
      }

      .adminExpField input[type="date"] {
        min-width: 140px;
        color-scheme: light;
      }

      .adminExpField input[type="date"]::-webkit-calendar-picker-indicator {
        opacity: 1;
        cursor: pointer;
      }

      .adminExpBtn {
        height: 40px;
        padding: 0 16px;
        border: 1px solid ${adminTheme.colors.border};
        border-radius: ${adminTheme.radius.md};
        background: ${adminTheme.colors.panelSoft};
        color: ${adminTheme.colors.text};
        font-weight: 700;
        cursor: pointer;
        transition: background .18s ease, border-color .18s ease, color .18s ease, opacity .18s ease;
      }

      .adminExpBtn.primary {
        background: ${adminTheme.colors.primary};
        color: ${adminTheme.colors.textOnPrimary};
        border-color: ${adminTheme.colors.primary};
      }

      .adminExpBtn:disabled {
        opacity: .6;
        cursor: not-allowed;
      }

      .adminExpBadge {
        min-height: 40px;
        padding: 0 14px;
        display: inline-flex;
        align-items: center;
        border: 1px solid ${adminTheme.colors.border};
        border-radius: ${adminTheme.radius.md};
        background: ${adminTheme.colors.panelBg};
        color: ${adminTheme.colors.textSoft};
        font-size: 13px;
        font-weight: 700;
      }

      .adminExpKpiGrid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }

      .adminExpKpi {
        border: 1px solid ${adminTheme.colors.border};
        border-radius: 18px;
        background: ${adminTheme.colors.panelBg};
        padding: 16px;
        box-shadow: ${adminTheme.shadow.sm};
      }

      .adminExpKpiLabel {
        font-size: 13px;
        font-weight: 700;
        color: ${adminTheme.colors.textSoft};
      }

      .adminExpKpiValue {
        margin-top: 8px;
        font-size: 26px;
        font-weight: 800;
        color: ${adminTheme.colors.text};
      }

      .adminExpMainGrid {
        display: grid;
        grid-template-columns: minmax(0, 1.45fr) minmax(320px, .8fr);
        gap: 12px;
        align-items: start;
      }

      .adminExpCol {
        display: grid;
        gap: 12px;
      }

      .adminExpCard {
        border: 1px solid ${adminTheme.colors.border};
        border-radius: 18px;
        background: ${adminTheme.colors.panelBg};
        padding: 16px;
        box-shadow: ${adminTheme.shadow.sm};
      }

      .adminExpCardTitle {
        margin: 0;
        font-size: 18px;
        font-weight: 800;
        color: ${adminTheme.colors.text};
      }

      .adminExpCardSub {
        margin: 4px 0 0 0;
        font-size: 13px;
        font-weight: 600;
        color: ${adminTheme.colors.textSoft};
      }

      .adminExpNotice {
        margin-top: 12px;
        padding: 12px;
        border-radius: ${adminTheme.radius.md};
        background: ${adminTheme.colors.dangerSoft};
        color: ${adminTheme.colors.danger};
        border: 1px solid ${adminTheme.colors.danger};
        font-weight: 700;
      }

      .adminExpTypeGrid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 12px;
      }

      .adminExpTypeCard {
        border: 1px solid ${adminTheme.colors.border};
        border-radius: 16px;
        background: ${adminTheme.colors.panelSoft};
        padding: 14px;
        display: grid;
        gap: 10px;
      }

      .adminExpTypeCard.active {
        border-color: ${adminTheme.colors.primary};
        background: ${adminTheme.colors.primarySoft};
      }

      .adminExpTypeTitle {
        margin: 0;
        font-size: 16px;
        font-weight: 800;
        color: ${adminTheme.colors.text};
      }

      .adminExpTypeText {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        color: ${adminTheme.colors.textSoft};
        line-height: 1.45;
      }

      .adminExpControls {
        display: grid;
        gap: 10px;
        margin-top: 16px;
      }

      .adminExpSelectWrap {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 40px;
        padding: 0 12px;
        border: 1px solid ${adminTheme.colors.border};
        border-radius: ${adminTheme.radius.md};
        background: ${adminTheme.colors.panelBg};
      }

      .adminExpSelectWrap label {
        font-size: 12px;
        color: ${adminTheme.colors.textSoft};
        font-weight: 700;
        white-space: nowrap;
      }

      .adminExpSelect {
        width: 100%;
        min-width: 0;
        background: transparent;
        border: none;
        outline: none;
        color: ${adminTheme.colors.text};
        font-weight: 700;
      }

      .adminExpSelect option {
        background: ${adminTheme.colors.panelBg};
        color: ${adminTheme.colors.text};
      }

      .adminExpHint {
        color: ${adminTheme.colors.textSoft};
        font-size: 13px;
        font-weight: 600;
        line-height: 1.45;
      }

      .adminExpTableWrap {
        margin-top: 12px;
        overflow: auto;
        border: 1px solid ${adminTheme.colors.border};
        border-radius: 14px;
        background: ${adminTheme.colors.panelSoft};
      }

      .adminExpTable {
        width: 100%;
        border-collapse: collapse;
        min-width: 880px;
      }

      .adminExpTable th,
      .adminExpTable td {
        padding: 12px;
        text-align: left;
        border-bottom: 1px solid ${adminTheme.colors.border};
        font-size: 14px;
        color: ${adminTheme.colors.text};
        vertical-align: middle;
      }

      .adminExpTable th {
        color: ${adminTheme.colors.textSoft};
        font-weight: 800;
        background: ${adminTheme.colors.panelAlt};
      }

      .adminExpMuted {
        color: ${adminTheme.colors.textMuted};
        font-size: 13px;
      }

      .adminExpStatus {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 0 10px;
        border-radius: ${adminTheme.radius.pill};
        border: 1px solid ${adminTheme.colors.border};
        background: ${adminTheme.colors.panelBg};
        font-size: 12px;
        font-weight: 700;
        color: ${adminTheme.colors.text};
      }

      .adminExpList {
        display: grid;
        gap: 10px;
        margin-top: 12px;
      }

      .adminExpListItem {
        border: 1px solid ${adminTheme.colors.border};
        border-radius: 14px;
        background: ${adminTheme.colors.panelSoft};
        padding: 12px;
      }

      .adminExpListItem strong {
        display: block;
        margin-bottom: 4px;
        color: ${adminTheme.colors.text};
      }

      .adminExpListItem div {
        color: ${adminTheme.colors.textSoft};
        font-size: 13px;
        line-height: 1.45;
        font-weight: 600;
      }

      .adminExpEmpty {
        padding: 24px 12px;
        text-align: center;
        color: ${adminTheme.colors.textSoft};
        font-weight: 600;
      }

      @media (max-width: 1200px) {
        .adminExpKpiGrid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .adminExpMainGrid {
          grid-template-columns: 1fr;
        }

        .adminExpTypeGrid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 700px) {
        .adminExpKpiGrid {
          grid-template-columns: 1fr;
        }
      }
      `}</style>

      <section className="adminExpFilters">
        <button
          className={`adminExpPill ${preset === "today" ? "active" : ""}`}
          onClick={() => applyPreset("today")}
        >
          Hoy
        </button>

        <button
          className={`adminExpPill ${preset === "week" ? "active" : ""}`}
          onClick={() => applyPreset("week")}
        >
          Semana
        </button>

        <button
          className={`adminExpPill ${preset === "month" ? "active" : ""}`}
          onClick={() => applyPreset("month")}
        >
          Mes
        </button>

        <button
          className={`adminExpPill ${preset === "custom" ? "active" : ""}`}
          onClick={() => setPreset("custom")}
        >
          Personalizado
        </button>

        <div className="adminExpField">
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

        <div className="adminExpField">
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

        <button className="adminExpBtn" onClick={loadPreviewData} disabled={previewLoading}>
          {previewLoading ? "Actualizando..." : "Actualizar datos"}
        </button>

        <div className="adminExpBadge">Rango: {rangeLabel}</div>
      </section>

      <section className="adminExpKpiGrid">
        <article className="adminExpKpi">
          <div className="adminExpKpiLabel">Total fichajes</div>
          <div className="adminExpKpiValue">{metrics.totalEntries}</div>
        </article>

        <article className="adminExpKpi">
          <div className="adminExpKpiLabel">Horas trabajadas</div>
          <div className="adminExpKpiValue">{formatMinutes(metrics.totalMinutes)}</div>
        </article>

        <article className="adminExpKpi">
          <div className="adminExpKpiLabel">Jornadas abiertas</div>
          <div className="adminExpKpiValue">{metrics.openEntries}</div>
        </article>

        <article className="adminExpKpi">
          <div className="adminExpKpiLabel">Cumplimiento</div>
          <div className="adminExpKpiValue">{metrics.compliancePercent}%</div>
        </article>
      </section>

      <section className="adminExpMainGrid">
        <div className="adminExpCol">
          <section className="adminExpCard">
            <h2 className="adminExpCardTitle">Tipos de exportación</h2>
            <p className="adminExpCardSub">
              Elige el formato de salida según control interno, auditoría o revisión individual.
            </p>

            <div className="adminExpTypeGrid">
              <article className={`adminExpTypeCard ${selectedExportType === "inspection" ? "active" : ""}`}>
                <h3 className="adminExpTypeTitle">Inspección laboral</h3>
                <p className="adminExpTypeText">
                  Exportación clara por jornada, con motivo de incidencia, distancias, precisión y resolución administrativa.
                </p>
                <button
                  className="adminExpBtn primary"
                  onClick={() => exportCsv("inspection")}
                  disabled={loading || previewLoading || previewRows.length === 0}
                >
                  {loading && selectedExportType === "inspection" ? "Exportando..." : "Descargar CSV"}
                </button>
              </article>

              <article className={`adminExpTypeCard ${selectedExportType === "company_summary" ? "active" : ""}`}>
                <h3 className="adminExpTypeTitle">Resumen empresa</h3>
                <p className="adminExpTypeText">
                  Totales por trabajador: jornadas, minutos acumulados, abiertas e incidencias.
                </p>
                <button
                  className="adminExpBtn primary"
                  onClick={() => exportCsv("company_summary")}
                  disabled={loading || previewLoading || previewRows.length === 0}
                >
                  {loading && selectedExportType === "company_summary" ? "Exportando..." : "Descargar CSV"}
                </button>
              </article>

              <article className={`adminExpTypeCard ${selectedExportType === "worker_detail" ? "active" : ""}`}>
                <h3 className="adminExpTypeTitle">Detalle por trabajador</h3>
                <p className="adminExpTypeText">
                  Exportación individual para revisión interna, consulta puntual o entrega concreta.
                </p>
                <button
                  className="adminExpBtn primary"
                  onClick={() => exportCsv("worker_detail")}
                  disabled={
                    loading ||
                    previewLoading ||
                    previewRows.length === 0 ||
                    selectedWorkerId === "all"
                  }
                >
                  {loading && selectedExportType === "worker_detail" ? "Exportando..." : "Descargar CSV"}
                </button>
              </article>
            </div>

            <div className="adminExpControls">
              <div className="adminExpSelectWrap">
                <label>Trabajador</label>
                <select
                  className="adminExpSelect"
                  value={selectedWorkerId}
                  onChange={(e) => setSelectedWorkerId(e.target.value)}
                >
                  <option value="all">Todos los trabajadores</option>
                  {workerOptions.map((worker) => (
                    <option key={worker.id} value={worker.id}>
                      {worker.name}{worker.email ? ` · ${worker.email}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="adminExpBadge">
                Registros previos: <strong style={{ marginLeft: 6 }}>{filteredPreviewRows.length}</strong>
              </div>

              <div className="adminExpHint">
                “Todos los trabajadores” sirve para las exportaciones globales. Para “Detalle por trabajador” debes elegir uno concreto.
              </div>
            </div>

            {error && <div className="adminExpNotice">{error}</div>}
          </section>

          <section className="adminExpCard">
            <h2 className="adminExpCardTitle">Vista previa de registros</h2>
            <p className="adminExpCardSub">
              Se muestran hasta 80 registros en pantalla. La exportación incluye todos.
            </p>

            <div className="adminExpTableWrap">
              <table className="adminExpTable">
                <thead>
                  <tr>
                    <th>Trabajador</th>
                    <th>Entrada</th>
                    <th>Salida</th>
                    <th>Duración</th>
                    <th>Estado</th>
                    <th>Workflow</th>
                  </tr>
                </thead>
                <tbody>
                  {previewLoading ? (
                    <tr>
                      <td colSpan={6} className="adminExpEmpty">Cargando registros…</td>
                    </tr>
                  ) : filteredPreviewRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="adminExpEmpty">No hay fichajes en el rango seleccionado.</td>
                    </tr>
                  ) : (
                    previewRowsForTable.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <div>{row.worker_name}</div>
                          <div className="adminExpMuted">{row.worker_email || row.user_id}</div>
                        </td>
                        <td>{formatLocalDateTime(row.check_in_at)}</td>
                        <td>{row.check_out_at ? formatLocalDateTime(row.check_out_at) : "—"}</td>
                        <td>{formatMinutes(row.duration_minutes)}</td>
                        <td>
                          <span className="adminExpStatus">
                            {translateStatus(row.status) || (row.check_out_at ? "Cerrada" : "Abierta")}
                          </span>
                        </td>
                        <td>
                          <span className="adminExpStatus">
                            {translateWorkflow(row.workflow_status) || "Sin incidencia"}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {filteredPreviewRows.length > 80 && (
              <div className="adminExpHint" style={{ marginTop: 10 }}>
                Se muestran los primeros 80 registros. La exportación descargada incluye todos.
              </div>
            )}
          </section>
        </div>

        <div className="adminExpCol">
          <section className="adminExpCard">
            <h2 className="adminExpCardTitle">Indicadores de cumplimiento</h2>
            <p className="adminExpCardSub">
              Vista rápida para control operativo y preparación de inspección.
            </p>

            <div className="adminExpList">
              <div className="adminExpListItem">
                <strong>Jornadas completas</strong>
                <div>{metrics.completedEntries} de {metrics.totalEntries} registros cerrados correctamente.</div>
              </div>

              <div className="adminExpListItem">
                <strong>Jornadas abiertas</strong>
                <div>{metrics.openEntries} registros sin hora de salida.</div>
              </div>

              <div className="adminExpListItem">
                <strong>Incidencias / ajustes</strong>
                <div>
                  {metrics.incidentEntries} registros pendientes y {metrics.adjustedEntries} con trazabilidad de ajuste o cierre administrativo.
                </div>
              </div>

              <div className="adminExpListItem">
                <strong>Preparación normativa</strong>
                <div>
                  Exportación pensada para evidenciar fichajes, estados de jornada y modificaciones.
                </div>
              </div>
            </div>
          </section>

          <section className="adminExpCard">
            <h2 className="adminExpCardTitle">Qué incluye cada CSV</h2>
            <p className="adminExpCardSub">Guía rápida para elegir el formato correcto.</p>

            <div className="adminExpList">
              <div className="adminExpListItem">
                <strong>Inspección laboral</strong>
                <div>Máximo detalle por jornada, pero en columnas claras y legibles, sin JSON bruto.</div>
              </div>

              <div className="adminExpListItem">
                <strong>Resumen empresa</strong>
                <div>Visión compacta por trabajador con acumulados y focos de revisión.</div>
              </div>

              <div className="adminExpListItem">
                <strong>Detalle por trabajador</strong>
                <div>Exportación individual filtrada para seguimiento o revisión puntual.</div>
              </div>
            </div>
          </section>

          <section className="adminExpCard">
            <h2 className="adminExpCardTitle">Histórico visual</h2>
            <p className="adminExpCardSub">
              Placeholder visual. Si luego quieres, esto se puede guardar en base de datos.
            </p>

            <div className="adminExpList">
              <div className="adminExpListItem">
                <strong>Última selección activa</strong>
                <div>
                  {selectedExportType === "inspection" && "Inspección laboral"}
                  {selectedExportType === "company_summary" && "Resumen empresa"}
                  {selectedExportType === "worker_detail" && "Detalle por trabajador"} · {rangeLabel}
                </div>
              </div>

              <div className="adminExpListItem">
                <strong>Trabajador filtrado</strong>
                <div>
                  {selectedWorkerId === "all"
                    ? "Sin filtro individual"
                    : workerOptions.find((w) => w.id === selectedWorkerId)?.name ?? "Trabajador seleccionado"}
                </div>
              </div>

              <div className="adminExpListItem">
                <strong>Volumen exportable</strong>
                <div>{filteredPreviewRows.length} registros en la vista actual.</div>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}