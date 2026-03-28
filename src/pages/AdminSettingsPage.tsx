import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useActiveMembership } from "../app/useActiveMembership";
import { adminTheme } from "../ui/adminTheme";

type HolidayRow = {
  id: string;
  holiday_date: string;
  name: string;
};

type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type WorkerOption = {
  id: string;
  name: string;
  email: string;
};

type AbsenceType = "vacation" | "medical_leave" | "personal_leave" | "day_off";

type WorkerAbsenceRow = {
  id: string;
  company_id: string;
  user_id: string;
  absence_type: AbsenceType;
  start_date: string;
  end_date: string;
  note: string | null;
  created_at: string;
};

type WorkerRequestType = "vacaciones" | "dia_libre" | "otro";
type WorkerRequestStatus = "pending" | "read";

type WorkerRequestRow = {
  id: string;
  company_id: string;
  user_id: string;
  type: WorkerRequestType;
  start_date: string;
  end_date: string;
  comment: string | null;
  status: WorkerRequestStatus;
  created_at: string;
  read_at: string | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayDateInput() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatAbsenceTypeLabel(type: AbsenceType) {
  switch (type) {
    case "vacation":
      return "Vacaciones";
    case "medical_leave":
      return "Baja médica";
    case "personal_leave":
      return "Permiso";
    case "day_off":
      return "Día libre";
    default:
      return type;
  }
}

function formatWorkerRequestTypeLabel(type: WorkerRequestType) {
  switch (type) {
    case "vacaciones":
      return "Vacaciones";
    case "dia_libre":
      return "Día libre";
    case "otro":
      return "Otro";
    default:
      return type;
  }
}

export function AdminSettingsPage() {
  const { membership, loading: membershipLoading } = useActiveMembership();

  const [worksOnSaturday, setWorksOnSaturday] = useState(false);
  const [worksOnSunday, setWorksOnSunday] = useState(false);

  const [morningStart, setMorningStart] = useState("08:30");
  const [lunchStart, setLunchStart] = useState("14:00");
  const [afternoonStart, setAfternoonStart] = useState("15:30");
  const [dayEnd, setDayEnd] = useState("18:00");

  const [holidayDate, setHolidayDate] = useState(todayDateInput());
  const [holidayName, setHolidayName] = useState("");

  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [absences, setAbsences] = useState<WorkerAbsenceRow[]>([]);
  const [workerRequests, setWorkerRequests] = useState<WorkerRequestRow[]>([]);

  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [absenceType, setAbsenceType] = useState<AbsenceType>("vacation");
  const [absenceStartDate, setAbsenceStartDate] = useState(todayDateInput());
  const [absenceEndDate, setAbsenceEndDate] = useState(todayDateInput());
  const [absenceNote, setAbsenceNote] = useState("");

  const [loading, setLoading] = useState(true);
  const [savingCalendar, setSavingCalendar] = useState(false);
  const [savingHoliday, setSavingHoliday] = useState(false);
  const [savingAbsence, setSavingAbsence] = useState(false);
  const [markingRequestId, setMarkingRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const sortedHolidays = useMemo(() => {
    return [...holidays].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
  }, [holidays]);

  const sortedAbsences = useMemo(() => {
    return [...absences].sort((a, b) => {
      if (a.start_date !== b.start_date) return a.start_date.localeCompare(b.start_date);
      return a.end_date.localeCompare(b.end_date);
    });
  }, [absences]);

  const sortedWorkerRequests = useMemo(() => {
    return [...workerRequests].sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "pending" ? -1 : 1;
      }
      return b.created_at.localeCompare(a.created_at);
    });
  }, [workerRequests]);

  const pendingWorkerRequestsCount = useMemo(() => {
    return workerRequests.filter((request) => request.status === "pending").length;
  }, [workerRequests]);

  const workersById = useMemo(() => {
    const map = new Map<string, WorkerOption>();
    for (const worker of workers) map.set(worker.id, worker);
    return map;
  }, [workers]);

  async function loadSettings() {
    if (!membership?.company_id) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    const [calendarRes, holidaysRes, profilesRes, absencesRes, requestsRes] = await Promise.all([
      supabase
        .from("company_work_calendar")
        .select(
          "company_id,works_on_saturday,works_on_sunday,morning_start,lunch_start,afternoon_start,day_end"
        )
        .eq("company_id", membership.company_id)
        .maybeSingle(),

      supabase
        .from("company_holidays")
        .select("id,holiday_date,name")
        .eq("company_id", membership.company_id)
        .order("holiday_date", { ascending: true }),

      supabase.rpc("admin_company_profiles", {
        p_company_id: membership.company_id,
      }),

      supabase
        .from("worker_absences")
        .select("id,company_id,user_id,absence_type,start_date,end_date,note,created_at")
        .eq("company_id", membership.company_id)
        .order("start_date", { ascending: true }),

      supabase
        .from("worker_requests")
        .select("id,company_id,user_id,type,start_date,end_date,comment,status,created_at,read_at")
        .eq("company_id", membership.company_id)
        .order("created_at", { ascending: false }),
    ]);

    if (calendarRes.error) {
      setLoading(false);
      setError(calendarRes.error.message);
      return;
    }

    if (holidaysRes.error) {
      setLoading(false);
      setError(holidaysRes.error.message);
      return;
    }

    if (profilesRes.error) {
      setLoading(false);
      setError(profilesRes.error.message);
      return;
    }

    if (absencesRes.error) {
      setLoading(false);
      setError(absencesRes.error.message);
      return;
    }

    if (requestsRes.error) {
      setLoading(false);
      setError(requestsRes.error.message);
      return;
    }

    const calendar = calendarRes.data;
    if (calendar) {
      setWorksOnSaturday(!!calendar.works_on_saturday);
      setWorksOnSunday(!!calendar.works_on_sunday);
      setMorningStart(calendar.morning_start ?? "08:30");
      setLunchStart(calendar.lunch_start ?? "14:00");
      setAfternoonStart(calendar.afternoon_start ?? "15:30");
      setDayEnd(calendar.day_end ?? "18:00");
    }

    const nextWorkers = ((profilesRes.data ?? []) as Profile[])
      .map((p) => ({
        id: p.id,
        name: (p.full_name ?? "").trim() || (p.email ?? "").trim() || p.id,
        email: p.email ?? "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    setWorkers(nextWorkers);
    if (!selectedWorkerId && nextWorkers.length > 0) {
      setSelectedWorkerId(nextWorkers[0].id);
    }

    setHolidays((holidaysRes.data ?? []) as HolidayRow[]);
    setAbsences((absencesRes.data ?? []) as WorkerAbsenceRow[]);
    setWorkerRequests((requestsRes.data ?? []) as WorkerRequestRow[]);
    setLoading(false);
  }

  async function saveCalendar() {
    if (!membership?.company_id) return;

    setSavingCalendar(true);
    setError(null);
    setSuccess(null);

    const { error: upsertError } = await supabase
      .from("company_work_calendar")
      .upsert(
        {
          company_id: membership.company_id,
          works_on_saturday: worksOnSaturday,
          works_on_sunday: worksOnSunday,
          morning_start: morningStart,
          lunch_start: lunchStart,
          afternoon_start: afternoonStart,
          day_end: dayEnd,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id" }
      );

    if (upsertError) {
      setSavingCalendar(false);
      setError(upsertError.message);
      return;
    }

    setSavingCalendar(false);
    setSuccess("Configuración guardada correctamente.");
  }

  async function addHoliday() {
    if (!membership?.company_id) return;

    const name = holidayName.trim();
    if (!holidayDate || !name) return;

    setSavingHoliday(true);
    setError(null);
    setSuccess(null);

    const { data, error: insertError } = await supabase
      .from("company_holidays")
      .insert({
        company_id: membership.company_id,
        holiday_date: holidayDate,
        name,
      })
      .select("id,holiday_date,name")
      .single();

    if (insertError) {
      setSavingHoliday(false);
      setError(insertError.message);
      return;
    }

    setHolidays((prev) => [...prev, data as HolidayRow]);
    setHolidayName("");
    setSavingHoliday(false);
    setSuccess("Festivo añadido correctamente.");
  }

  async function removeHoliday(id: string) {
    setError(null);
    setSuccess(null);

    const { error: deleteError } = await supabase
      .from("company_holidays")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setHolidays((prev) => prev.filter((h) => h.id !== id));
    setSuccess("Festivo eliminado correctamente.");
  }

  async function addAbsence() {
    if (!membership?.company_id) return;
    if (!selectedWorkerId) {
      setError("Selecciona un trabajador.");
      return;
    }
    if (!absenceStartDate || !absenceEndDate) {
      setError("Selecciona fecha de inicio y fin.");
      return;
    }
    if (absenceEndDate < absenceStartDate) {
      setError("La fecha de fin no puede ser anterior a la de inicio.");
      return;
    }

    setSavingAbsence(true);
    setError(null);
    setSuccess(null);

    const payload = {
      company_id: membership.company_id,
      user_id: selectedWorkerId,
      absence_type: absenceType,
      start_date: absenceStartDate,
      end_date: absenceEndDate,
      note: absenceNote.trim() || null,
    };

    const { data, error: insertError } = await supabase
      .from("worker_absences")
      .insert(payload)
      .select("id,company_id,user_id,absence_type,start_date,end_date,note,created_at")
      .single();

    if (insertError) {
      setSavingAbsence(false);
      setError(insertError.message);
      return;
    }

    setAbsences((prev) => [...prev, data as WorkerAbsenceRow]);
    setAbsenceType("vacation");
    setAbsenceStartDate(todayDateInput());
    setAbsenceEndDate(todayDateInput());
    setAbsenceNote("");
    setSavingAbsence(false);
    setSuccess("Ausencia guardada correctamente.");
  }

  async function removeAbsence(id: string) {
    setError(null);
    setSuccess(null);

    const { error: deleteError } = await supabase
      .from("worker_absences")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setAbsences((prev) => prev.filter((a) => a.id !== id));
    setSuccess("Ausencia eliminada correctamente.");
  }

  async function markWorkerRequestAsRead(id: string) {
    setMarkingRequestId(id);
    setError(null);
    setSuccess(null);

    const { error: updateError } = await supabase
      .from("worker_requests")
      .update({
        status: "read",
        read_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) {
      setMarkingRequestId(null);
      setError(updateError.message);
      return;
    }

    setWorkerRequests((prev) =>
      prev.map((request) =>
        request.id === id
          ? {
              ...request,
              status: "read",
              read_at: new Date().toISOString(),
            }
          : request
      )
    );

    setMarkingRequestId(null);
    setSuccess("Solicitud marcada como vista.");
  }


async function deleteWorkerRequest(id: string) {
  setMarkingRequestId(id);
  setError(null);
  setSuccess(null);

  const { error: deleteError } = await supabase
    .from("worker_requests")
    .delete()
    .eq("id", id);

  if (deleteError) {
    setMarkingRequestId(null);
    setError(deleteError.message);
    return;
  }

  setWorkerRequests((prev) => prev.filter((request) => request.id !== id));
  setMarkingRequestId(null);
  setSuccess("Solicitud eliminada correctamente.");
}


  useEffect(() => {
    if (!membership?.company_id) return;
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membership?.company_id]);

  if (membershipLoading || loading) {
    return (
      <div
        style={{
          padding: 24,
          color: adminTheme.colors.text,
          background: adminTheme.colors.pageBg,
        }}
      >
        Cargando configuración...
      </div>
    );
  }

  if (!membership) {
    return (
      <div
        style={{
          padding: 24,
          color: adminTheme.colors.text,
          background: adminTheme.colors.pageBg,
        }}
      >
        Sin empresa activa.
      </div>
    );
  }

  return (
    <div className="adminSettingsUi">
      <style>{`
        .adminSettingsUi {
          display: grid;
          gap: 12px;
        }

        .adminSettingsHero {
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 18px;
          background: ${adminTheme.colors.panelBg};
          padding: 18px;
          box-shadow: ${adminTheme.shadow.sm};
        }

        .adminSettingsTitle {
          margin: 0;
          font-size: 22px;
          font-weight: 800;
          color: ${adminTheme.colors.text};
        }

        .adminSettingsSub {
          margin: 6px 0 0 0;
          font-size: 14px;
          line-height: 1.45;
          color: ${adminTheme.colors.textSoft};
          font-weight: 600;
        }

        .adminSettingsGrid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(320px, .9fr);
          gap: 12px;
          align-items: start;
        }

        .adminSettingsCard {
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 18px;
          background: ${adminTheme.colors.panelBg};
          padding: 16px;
          box-shadow: ${adminTheme.shadow.sm};
        }

        .adminSettingsCardTitle {
          margin: 0;
          font-size: 18px;
          font-weight: 800;
          color: ${adminTheme.colors.text};
        }

        .adminSettingsCardSub {
          margin: 4px 0 0 0;
          font-size: 13px;
          line-height: 1.45;
          color: ${adminTheme.colors.textSoft};
          font-weight: 600;
        }

        .adminSettingsBlock {
          margin-top: 14px;
          display: grid;
          gap: 10px;
        }

        .adminSettingsRow {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
        }

        .adminSettingsSwitchRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-height: 52px;
          padding: 12px 14px;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 14px;
          background: ${adminTheme.colors.panelSoft};
        }

        .adminSettingsSwitchText {
          display: grid;
          gap: 3px;
        }

        .adminSettingsSwitchText strong {
          color: ${adminTheme.colors.text};
          font-size: 14px;
          font-weight: 800;
        }

        .adminSettingsSwitchText span {
          color: ${adminTheme.colors.textSoft};
          font-size: 13px;
          font-weight: 600;
          line-height: 1.4;
        }

        .adminSettingsToggle {
          position: relative;
          width: 54px;
          height: 30px;
          border: none;
          border-radius: 999px;
          background: ${adminTheme.colors.panelAlt};
          cursor: pointer;
          transition: background .2s ease;
          flex: 0 0 auto;
        }

        .adminSettingsToggle.active {
          background: ${adminTheme.colors.primary};
        }

        .adminSettingsToggleDot {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 24px;
          height: 24px;
          border-radius: 999px;
          background: ${adminTheme.colors.textOnPrimary};
          transition: transform .2s ease;
        }

        .adminSettingsToggle.active .adminSettingsToggleDot {
          transform: translateX(24px);
        }

        .adminSettingsField {
          display: grid;
          gap: 6px;
          min-width: 0;
          flex: 1 1 180px;
        }

        .adminSettingsField label {
          font-size: 12px;
          color: ${adminTheme.colors.textSoft};
          font-weight: 700;
        }

        .adminSettingsInput,
        .adminSettingsSelect,
        .adminSettingsTextarea {
          width: 100%;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 12px;
          background: ${adminTheme.colors.panelBg};
          color: ${adminTheme.colors.text};
          outline: none;
          font-weight: 700;
          box-sizing: border-box;
        }

        .adminSettingsInput,
        .adminSettingsSelect {
          height: 42px;
          padding: 0 12px;
        }

        .adminSettingsTextarea {
          min-height: 90px;
          padding: 10px 12px;
          resize: vertical;
          font-family: inherit;
        }

        .adminSettingsInput[type="date"],
        .adminSettingsInput[type="time"] {
          color-scheme: light;
        }

        .adminSettingsInput[type="date"]::-webkit-calendar-picker-indicator,
        .adminSettingsInput[type="time"]::-webkit-calendar-picker-indicator {
          opacity: 1;
          cursor: pointer;
        }

        .adminSettingsSelect option {
          background: ${adminTheme.colors.panelBg};
          color: ${adminTheme.colors.text};
        }

        .adminSettingsBtn {
          height: 42px;
          padding: 0 16px;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 12px;
          background: ${adminTheme.colors.panelSoft};
          color: ${adminTheme.colors.text};
          font-weight: 800;
          cursor: pointer;
          transition: background .18s ease, border-color .18s ease, color .18s ease, opacity .18s ease;
        }

        .adminSettingsBtn.primary {
          background: ${adminTheme.colors.primary};
          color: ${adminTheme.colors.textOnPrimary};
          border-color: ${adminTheme.colors.primary};
        }

        .adminSettingsBtn.danger {
          background: ${adminTheme.colors.dangerSoft};
          color: ${adminTheme.colors.danger};
          border-color: ${adminTheme.colors.danger};
        }

        .adminSettingsBtn:disabled {
          opacity: .6;
          cursor: not-allowed;
        }

        .adminSettingsNote {
          margin-top: 2px;
          color: ${adminTheme.colors.textSoft};
          font-size: 13px;
          line-height: 1.45;
          font-weight: 600;
        }

        .adminSettingsList {
          display: grid;
          gap: 10px;
          margin-top: 12px;
        }

        .adminSettingsItem {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 14px;
          background: ${adminTheme.colors.panelSoft};
        }

        .adminSettingsItemMain {
          display: grid;
          gap: 4px;
          min-width: 0;
        }

        .adminSettingsItemMain strong {
          color: ${adminTheme.colors.text};
          font-size: 14px;
          font-weight: 800;
        }

        .adminSettingsItemMain span {
          color: ${adminTheme.colors.textSoft};
          font-size: 13px;
          font-weight: 600;
        }

        .adminSettingsEmpty {
          padding: 16px;
          border: 1px dashed ${adminTheme.colors.border};
          border-radius: 14px;
          background: ${adminTheme.colors.panelSoft};
          color: ${adminTheme.colors.textSoft};
          font-size: 13px;
          font-weight: 600;
          text-align: center;
        }

        .adminSettingsSummary {
          display: grid;
          gap: 10px;
          margin-top: 12px;
        }

        .adminSettingsSummaryItem {
          padding: 12px 14px;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 14px;
          background: ${adminTheme.colors.panelSoft};
        }

        .adminSettingsSummaryItem strong {
          display: block;
          margin-bottom: 4px;
          color: ${adminTheme.colors.text};
          font-size: 14px;
          font-weight: 800;
        }

        .adminSettingsSummaryItem span {
          color: ${adminTheme.colors.textSoft};
          font-size: 13px;
          line-height: 1.45;
          font-weight: 600;
        }

        .adminSettingsNotice {
          padding: 12px;
          border-radius: 12px;
          font-weight: 700;
          font-size: 13px;
        }

        .adminSettingsNotice.error {
          background: ${adminTheme.colors.dangerSoft};
          color: ${adminTheme.colors.danger};
          border: 1px solid ${adminTheme.colors.danger};
        }

        .adminSettingsNotice.success {
          background: ${adminTheme.colors.successSoft};
          color: ${adminTheme.colors.success};
          border: 1px solid ${adminTheme.colors.success};
        }

        .adminSettingsSectionDivider {
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid ${adminTheme.colors.border};
        }

        .adminSettingsRequestMeta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          margin-top: 2px;
        }

        .adminSettingsTag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 26px;
          padding: 0 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          border: 1px solid ${adminTheme.colors.border};
          background: ${adminTheme.colors.panelBg};
          color: ${adminTheme.colors.textSoft};
        }

        .adminSettingsTag.pending {
          background: ${adminTheme.colors.dangerSoft};
          color: ${adminTheme.colors.danger};
          border-color: ${adminTheme.colors.danger};
        }

        .adminSettingsTag.read {
          background: ${adminTheme.colors.successSoft};
          color: ${adminTheme.colors.success};
          border-color: ${adminTheme.colors.success};
        }

        @media (max-width: 1100px) {
          .adminSettingsGrid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <section className="adminSettingsHero">
        <h1 className="adminSettingsTitle">Configuración</h1>
        <p className="adminSettingsSub">
          Aquí vas a definir qué días se trabaja en la empresa. Esta base servirá
          después para vacaciones, ausencias y avisos push.
        </p>
      </section>

      {error && <div className="adminSettingsNotice error">{error}</div>}
      {success && <div className="adminSettingsNotice success">{success}</div>}

      <section className="adminSettingsGrid">
        <div className="adminSettingsCard">
          <h2 className="adminSettingsCardTitle">Calendario laboral</h2>
          <p className="adminSettingsCardSub">
            Primer paso: fines de semana, festivos y horarios base de empresa.
          </p>

          <div className="adminSettingsBlock">
            <div className="adminSettingsSwitchRow">
              <div className="adminSettingsSwitchText">
                <strong>Sábado laborable</strong>
                <span>Actívalo solo si la empresa trabaja normalmente los sábados.</span>
              </div>

              <button
                type="button"
                className={`adminSettingsToggle ${worksOnSaturday ? "active" : ""}`}
                onClick={() => setWorksOnSaturday((v) => !v)}
              >
                <span className="adminSettingsToggleDot" />
              </button>
            </div>

            <div className="adminSettingsSwitchRow">
              <div className="adminSettingsSwitchText">
                <strong>Domingo laborable</strong>
                <span>Déjalo apagado salvo casos muy concretos.</span>
              </div>

              <button
                type="button"
                className={`adminSettingsToggle ${worksOnSunday ? "active" : ""}`}
                onClick={() => setWorksOnSunday((v) => !v)}
              >
                <span className="adminSettingsToggleDot" />
              </button>
            </div>
          </div>

          <div className="adminSettingsBlock">
            <h3 className="adminSettingsCardTitle" style={{ fontSize: 16 }}>
              Horarios base
            </h3>
            <p className="adminSettingsCardSub">
              Estos horarios se usarán después para los recordatorios y las incidencias automáticas.
            </p>

            <div className="adminSettingsRow">
              <div className="adminSettingsField">
                <label>Entrada mañana</label>
                <input
                  className="adminSettingsInput"
                  type="time"
                  value={morningStart}
                  onChange={(e) => setMorningStart(e.target.value)}
                />
              </div>

              <div className="adminSettingsField">
                <label>Salida comida</label>
                <input
                  className="adminSettingsInput"
                  type="time"
                  value={lunchStart}
                  onChange={(e) => setLunchStart(e.target.value)}
                />
              </div>

              <div className="adminSettingsField">
                <label>Entrada tarde</label>
                <input
                  className="adminSettingsInput"
                  type="time"
                  value={afternoonStart}
                  onChange={(e) => setAfternoonStart(e.target.value)}
                />
              </div>

              <div className="adminSettingsField">
                <label>Salida final</label>
                <input
                  className="adminSettingsInput"
                  type="time"
                  value={dayEnd}
                  onChange={(e) => setDayEnd(e.target.value)}
                />
              </div>
            </div>

            <div>
              <button
                type="button"
                className="adminSettingsBtn primary"
                onClick={saveCalendar}
                disabled={savingCalendar}
              >
                {savingCalendar ? "Guardando..." : "Guardar configuración"}
              </button>
            </div>
          </div>

          <div className="adminSettingsBlock">
            <h3 className="adminSettingsCardTitle" style={{ fontSize: 16 }}>
              Festivos de empresa
            </h3>

            <div className="adminSettingsRow">
              <div className="adminSettingsField">
                <label>Fecha festiva</label>
                <input
                  className="adminSettingsInput"
                  type="date"
                  value={holidayDate}
                  onChange={(e) => setHolidayDate(e.target.value)}
                />
              </div>

              <div className="adminSettingsField">
                <label>Nombre del festivo</label>
                <input
                  className="adminSettingsInput"
                  type="text"
                  placeholder="Ej. San Isidro"
                  value={holidayName}
                  onChange={(e) => setHolidayName(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", alignItems: "end" }}>
                <button
                  type="button"
                  className="adminSettingsBtn primary"
                  onClick={addHoliday}
                  disabled={savingHoliday}
                >
                  {savingHoliday ? "Añadiendo..." : "Añadir festivo"}
                </button>
              </div>
            </div>

            <div className="adminSettingsNote">
              Los festivos guardados aquí ya quedan asociados a la empresa activa.
            </div>
          </div>

          <div className="adminSettingsList">
            {sortedHolidays.length === 0 ? (
              <div className="adminSettingsEmpty">Todavía no has añadido festivos.</div>
            ) : (
              sortedHolidays.map((holiday) => (
                <div key={holiday.id} className="adminSettingsItem">
                  <div className="adminSettingsItemMain">
                    <strong>{holiday.name}</strong>
                    <span>{holiday.holiday_date}</span>
                  </div>

                  <button
                    type="button"
                    className="adminSettingsBtn danger"
                    onClick={() => removeHoliday(holiday.id)}
                  >
                    Eliminar
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <aside className="adminSettingsCard">
          <h2 className="adminSettingsCardTitle">Resumen</h2>
          <p className="adminSettingsCardSub">
            Esto será la base para no lanzar incidencias o pushes cuando no toca.
          </p>

          <div className="adminSettingsSummary">
            <div className="adminSettingsSummaryItem">
              <strong>Sábados</strong>
              <span>
                {worksOnSaturday
                  ? "La empresa trabaja los sábados."
                  : "La empresa no trabaja los sábados."}
              </span>
            </div>

            <div className="adminSettingsSummaryItem">
              <strong>Domingos</strong>
              <span>
                {worksOnSunday
                  ? "La empresa trabaja los domingos."
                  : "La empresa no trabaja los domingos."}
              </span>
            </div>

            <div className="adminSettingsSummaryItem">
              <strong>Horario base</strong>
              <span>
                Mañana {morningStart} · Comida {lunchStart} · Tarde {afternoonStart} · Salida {dayEnd}
              </span>
            </div>

            <div className="adminSettingsSummaryItem">
              <strong>Festivos configurados</strong>
              <span>{sortedHolidays.length} festivos cargados para esta empresa.</span>
            </div>

            <div className="adminSettingsSummaryItem">
              <strong>Solicitudes pendientes</strong>
              <span>
                {pendingWorkerRequestsCount === 0
                  ? "No hay solicitudes pendientes."
                  : `${pendingWorkerRequestsCount} solicitud${pendingWorkerRequestsCount !== 1 ? "es" : ""} pendiente${pendingWorkerRequestsCount !== 1 ? "s" : ""}.`}
              </span>
            </div>
          </div>

          <div className="adminSettingsSectionDivider">
            <h3 className="adminSettingsCardTitle" style={{ fontSize: 16 }}>
              Solicitudes de trabajadores
            </h3>
            <p className="adminSettingsCardSub">
              Aquí verás vacaciones, días libres y otros avisos enviados desde la app del trabajador.
            </p>

            <div className="adminSettingsList">
              {sortedWorkerRequests.length === 0 ? (
                <div className="adminSettingsEmpty">Todavía no han llegado solicitudes.</div>
              ) : (
                sortedWorkerRequests.map((request) => {
                  const worker = workersById.get(request.user_id);
                  const workerName = worker?.name ?? request.user_id;
                  const workerEmail = worker?.email ?? "";

                  return (
                    <div key={request.id} className="adminSettingsItem">
                      <div className="adminSettingsItemMain">
                        <strong>
                          {workerName} · {formatWorkerRequestTypeLabel(request.type)}
                        </strong>

                        <div className="adminSettingsRequestMeta">
                          <span className={`adminSettingsTag ${request.status}`}>
                            {request.status === "pending" ? "Pendiente" : "Vista"}
                          </span>
                        </div>

                        <span>
                          {request.start_date} → {request.end_date}
                          {workerEmail ? ` · ${workerEmail}` : ""}
                          {request.comment ? ` · ${request.comment}` : ""}
                        </span>
                      </div>

						<div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
						  {request.status === "pending" ? (
							<button
							  type="button"
							  className="adminSettingsBtn primary"
							  onClick={() => markWorkerRequestAsRead(request.id)}
							  disabled={markingRequestId === request.id}
							>
							  {markingRequestId === request.id ? "Guardando..." : "Visto"}
							</button>
						  ) : (
							<button
							  type="button"
							  className="adminSettingsBtn"
							  disabled
							>
							  Vista
							</button>
						  )}

						  <button
							type="button"
							className="adminSettingsBtn danger"
							onClick={() => deleteWorkerRequest(request.id)}
							disabled={markingRequestId === request.id}
						  >
							{markingRequestId === request.id ? "..." : "Borrar"}
						  </button>
						</div>

                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>
      </section>

      <section className="adminSettingsCard">
        <h2 className="adminSettingsCardTitle">Ausencias de trabajadores</h2>
        <p className="adminSettingsCardSub">
          Aquí podrás registrar vacaciones, bajas, permisos y días libres para que no salten avisos ni incidencias cuando no toca.
        </p>

        <div className="adminSettingsBlock">
          <div className="adminSettingsRow">
            <div className="adminSettingsField">
              <label>Trabajador</label>
              <select
                className="adminSettingsSelect"
                value={selectedWorkerId}
                onChange={(e) => setSelectedWorkerId(e.target.value)}
              >
                {workers.length === 0 ? (
                  <option value="">No hay trabajadores</option>
                ) : (
                  workers.map((worker) => (
                    <option key={worker.id} value={worker.id}>
                      {worker.name}{worker.email ? ` · ${worker.email}` : ""}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="adminSettingsField">
              <label>Tipo de ausencia</label>
              <select
                className="adminSettingsSelect"
                value={absenceType}
                onChange={(e) => setAbsenceType(e.target.value as AbsenceType)}
              >
                <option value="vacation">Vacaciones</option>
                <option value="medical_leave">Baja médica</option>
                <option value="personal_leave">Permiso</option>
                <option value="day_off">Día libre</option>
              </select>
            </div>

            <div className="adminSettingsField">
              <label>Fecha inicio</label>
              <input
                className="adminSettingsInput"
                type="date"
                value={absenceStartDate}
                onChange={(e) => setAbsenceStartDate(e.target.value)}
              />
            </div>

            <div className="adminSettingsField">
              <label>Fecha fin</label>
              <input
                className="adminSettingsInput"
                type="date"
                value={absenceEndDate}
                onChange={(e) => setAbsenceEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="adminSettingsField">
            <label>Observación</label>
            <textarea
              className="adminSettingsTextarea"
              placeholder="Opcional. Ej. Vacaciones de verano, permiso por médico, etc."
              value={absenceNote}
              onChange={(e) => setAbsenceNote(e.target.value)}
            />
          </div>

          <div>
            <button
              type="button"
              className="adminSettingsBtn primary"
              onClick={addAbsence}
              disabled={savingAbsence || workers.length === 0}
            >
              {savingAbsence ? "Guardando..." : "Guardar ausencia"}
            </button>
          </div>
        </div>

        <div className="adminSettingsList">
          {sortedAbsences.length === 0 ? (
            <div className="adminSettingsEmpty">Todavía no has registrado ausencias.</div>
          ) : (
            sortedAbsences.map((absence) => {
              const worker = workersById.get(absence.user_id);
              const workerName = worker?.name ?? absence.user_id;
              const workerEmail = worker?.email ?? "";

              return (
                <div key={absence.id} className="adminSettingsItem">
                  <div className="adminSettingsItemMain">
                    <strong>
                      {workerName} · {formatAbsenceTypeLabel(absence.absence_type)}
                    </strong>
                    <span>
                      {absence.start_date} → {absence.end_date}
                      {workerEmail ? ` · ${workerEmail}` : ""}
                      {absence.note ? ` · ${absence.note}` : ""}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="adminSettingsBtn danger"
                    onClick={() => removeAbsence(absence.id)}
                  >
                    Eliminar
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}