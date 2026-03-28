import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useActiveMembership } from "../app/useActiveMembership";
import { adminTheme } from "../ui/adminTheme";

type DownloadRange = "week" | "month" | "custom";
type RequestType = "vacaciones" | "dia_libre" | "otro";

type CsvEntry = {
  id: string;
  check_in_at: string;
  check_out_at: string | null;
  workflow_status: string | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateEs(iso: string) {
  const d = new Date(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatHourEs(iso: string) {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function minutesBetween(startIso: string, endIso: string | null) {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 60000));
}

function hhmmFromMinutes(totalMinutes: number) {
  const safe = Math.max(0, totalMinutes);
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function csvEscape(value: string | number | null | undefined) {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() + diffToMonday);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function getMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 18l-6-6 6-6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadBadgeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path
        d="m8.8 10.8 3.2 3.2 3.2-3.2"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5.5 18.2h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function MailBadgeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="2.4" stroke="currentColor" strokeWidth="2" />
      <path
        d="m6 8 6 4.8L18 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5.2" width="16" height="14" rx="2.4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M8 3.8v3M16 3.8v3M4 9h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M8.3 12.7h.01M12 12.7h.01M15.7 12.7h.01"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CalendarClockIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.8" y="5.2" width="12.4" height="12.4" rx="2.3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M7 3.8v3M13 3.8v3M3.8 8.8h12.4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="18.1" cy="16.8" r="3.8" stroke="currentColor" strokeWidth="2" />
      <path
        d="M18.1 15.2v1.8l1.2.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PalmIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M11.5 18.5V7.2a1 1 0 1 1 2 0v3.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M9.1 17.4V9.7a1 1 0 1 1 2 0v7.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M13.9 17.2v-6.4a1 1 0 1 1 2 0v5.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6.5 19.5c1.1-1 1.9-2.5 1.9-4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5.5 19.8h12.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M17.9 19.4c-.9-1.1-1.3-2.3-1.3-3.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function DayOffIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2.4" stroke="currentColor" strokeWidth="2" />
      <path d="M8 3.8v3M16 3.8v3M4 9h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 12.2v2.4M10.8 13.4h2.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 18.2 5 19.5v-2.6a6.6 6.6 0 0 1-.8-3.1C4.2 9.8 7.6 6.7 12 6.7s7.8 3.1 7.8 7.1-3.4 7.1-7.8 7.1c-1.7 0-3.3-.5-5-1.7Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M9.5 13.7h.01M12 13.7h.01M14.5 13.7h.01" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function InputCalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.2" y="5.2" width="15.6" height="14" rx="2.3" stroke="currentColor" strokeWidth="2" />
      <path d="M8 3.8v3M16 3.8v3M4.2 9h15.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 4 10.5 13.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <path
        d="m20 4-6 15-3.2-6L4 9.8 20 4Z"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SelectCard({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 84,
        borderRadius: 18,
        border: `1px solid ${active ? adminTheme.colors.primary : adminTheme.colors.border}`,
        background: active ? adminTheme.colors.primary : adminTheme.colors.panelBg,
        color: active ? adminTheme.colors.textOnPrimary : adminTheme.colors.text,
        display: "grid",
        placeItems: "center",
        gap: 6,
        cursor: "pointer",
        padding: "10px 8px",
        textAlign: "center",
      }}
    >
      <div style={{ display: "grid", placeItems: "center" }}>{icon}</div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.15,
          fontWeight: 900,
          letterSpacing: -0.1,
        }}
      >
        {label}
      </div>
    </button>
  );
}

function InputShell({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        height: 52,
        borderRadius: 16,
        border: `1px solid ${adminTheme.colors.border}`,
        background: adminTheme.colors.panelBg,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 12px",
        minWidth: 0,
      }}
    >
      <div style={{ color: adminTheme.colors.text, display: "grid", placeItems: "center" }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function WorkerGestionesPage() {
  const navigate = useNavigate();
  const { membership, loading: membershipLoading } = useActiveMembership();

  const [userId, setUserId] = useState<string | null>(null);

  const [downloadRange, setDownloadRange] = useState<DownloadRange>("week");
  const [customDownloadStart, setCustomDownloadStart] = useState("");
  const [customDownloadEnd, setCustomDownloadEnd] = useState("");

  const [requestType, setRequestType] = useState<RequestType>("vacaciones");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [comment, setComment] = useState("");

  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (downloadRange === "custom" && !customDownloadStart && !customDownloadEnd) {
      const now = new Date();
      const start = new Date(now);
      start.setDate(now.getDate() - 7);
      setCustomDownloadStart(toDateInputValue(start));
      setCustomDownloadEnd(toDateInputValue(now));
    }
  }, [downloadRange, customDownloadStart, customDownloadEnd]);

  const downloadLabel = useMemo(() => {
    if (downloadRange === "week") return "Descargar (CSV)";
    if (downloadRange === "month") return "Descargar (CSV)";
    return "Descargar (CSV)";
  }, [downloadRange]);

  async function handleDownload() {
    if (!membership?.company_id || !userId) {
      setDownloadMessage("No se ha podido detectar el usuario o la empresa.");
      return;
    }

    setDownloadLoading(true);
    setDownloadMessage(null);

    try {
      let rangeStart: Date;
      let rangeEnd: Date;
      let filenameSuffix = "historial";

      if (downloadRange === "week") {
        const { start, end } = getWeekRange();
        rangeStart = start;
        rangeEnd = end;
        filenameSuffix = "semana";
      } else if (downloadRange === "month") {
        const { start, end } = getMonthRange();
        rangeStart = start;
        rangeEnd = end;
        filenameSuffix = "mes";
      } else {
        if (!customDownloadStart || !customDownloadEnd) {
          setDownloadMessage("Selecciona fecha inicio y fecha fin.");
          setDownloadLoading(false);
          return;
        }

        if (customDownloadEnd < customDownloadStart) {
          setDownloadMessage("La fecha fin no puede ser anterior a la fecha inicio.");
          setDownloadLoading(false);
          return;
        }

        rangeStart = new Date(`${customDownloadStart}T00:00:00`);
        rangeEnd = new Date(`${customDownloadEnd}T23:59:59.999`);
        filenameSuffix = `${customDownloadStart}_${customDownloadEnd}`;
      }

      const { data, error } = await supabase
        .from("time_entries")
        .select("id,check_in_at,check_out_at,workflow_status")
        .eq("company_id", membership.company_id)
        .eq("user_id", userId)
        .gte("check_in_at", rangeStart.toISOString())
        .lte("check_in_at", rangeEnd.toISOString())
        .order("check_in_at", { ascending: true });

      if (error) {
        setDownloadMessage(error.message);
        setDownloadLoading(false);
        return;
      }

      const rows = (data ?? []) as CsvEntry[];

      const csvLines = [
        ["Fecha", "Entrada", "Salida", "Tiempo", "Estado"].map(csvEscape).join(","),
        ...rows.map((row) =>
          [
            csvEscape(formatDateEs(row.check_in_at)),
            csvEscape(formatHourEs(row.check_in_at)),
            csvEscape(row.check_out_at ? formatHourEs(row.check_out_at) : ""),
            csvEscape(hhmmFromMinutes(minutesBetween(row.check_in_at, row.check_out_at))),
            csvEscape(row.workflow_status ?? ""),
          ].join(",")
        ),
      ];

      downloadTextFile(`cerbero_${filenameSuffix}.csv`, csvLines.join("\n"));
      setDownloadMessage(rows.length === 0 ? "CSV descargado sin registros en ese rango." : "CSV descargado correctamente.");
    } catch (err) {
      setDownloadMessage("No se pudo generar el CSV.");
      console.error(err);
    } finally {
      setDownloadLoading(false);
    }
  }

  async function handleSubmitRequest() {
    if (!membership?.company_id || !userId) {
      setRequestMessage("No se ha podido detectar el usuario o la empresa.");
      return;
    }

    if (!startDate || !endDate) {
      setRequestMessage("Debes indicar fecha inicio y fecha fin.");
      return;
    }

    if (endDate < startDate) {
      setRequestMessage("La fecha fin no puede ser anterior a la fecha inicio.");
      return;
    }

    setRequestLoading(true);
    setRequestMessage(null);

    try {
      const { error } = await supabase.from("worker_requests").insert({
        company_id: membership.company_id,
        user_id: userId,
        type: requestType,
        start_date: startDate,
        end_date: endDate,
        comment: comment.trim() || null,
        status: "pending",
      });

      if (error) {
        setRequestMessage(error.message);
        setRequestLoading(false);
        return;
      }

      setComment("");
      setStartDate("");
      setEndDate("");
      setRequestType("vacaciones");
      setRequestMessage("Solicitud enviada correctamente.");
    } catch (err) {
      setRequestMessage("No se pudo enviar la solicitud.");
      console.error(err);
    } finally {
      setRequestLoading(false);
    }
  }

  if (!userId) {
    return (
      <div
        style={{
          minHeight: "100vh",
          padding: 24,
          color: adminTheme.colors.text,
          background: adminTheme.colors.pageBg,
        }}
      >
        Cargando usuario...
      </div>
    );
  }

  if (membershipLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          padding: 24,
          color: adminTheme.colors.text,
          background: adminTheme.colors.pageBg,
        }}
      >
        Cargando empresa...
      </div>
    );
  }

  if (!membership) {
    return (
      <div
        style={{
          minHeight: "100vh",
          padding: 24,
          color: adminTheme.colors.text,
          background: adminTheme.colors.pageBg,
        }}
      >
        No hay empresa activa.
      </div>
    );
  }

  return (
    <div
      className="workerGestionesPageUi"
      style={{
        minHeight: "100vh",
        width: "100%",
        background: `linear-gradient(180deg, ${adminTheme.colors.primary} 0%, ${adminTheme.colors.primarySoft} 100%)`,
        display: "flex",
        justifyContent: "center",
        padding: 14,
      }}
    >
      <style>{`
        .workerGestionesPageUi * {
          box-sizing: border-box;
        }

        .workerGestionesShell {
          width: 100%;
          max-width: 520px;
          display: grid;
          gap: 12px;
        }

        .workerGestionesTopCard {
          background: ${adminTheme.colors.panelBg};
          border-radius: 22px;
          border: 1px solid ${adminTheme.colors.border};
          box-shadow: ${adminTheme.shadow.lg};
          overflow: hidden;
          backdrop-filter: blur(6px);
        }

        .workerGestionesHeader {
          display: grid;
          grid-template-columns: 46px 1fr 16px;
          align-items: center;
          gap: 10px;
          padding: 14px;
          border-bottom: 1px solid ${adminTheme.colors.border};
          background: rgba(255,255,255,0.35);
        }

        .workerGestionesHeaderTitle {
          text-align: center;
          font-size: 20px;
          line-height: 1.08;
          font-weight: 950;
          color: ${adminTheme.colors.text};
          letter-spacing: -0.4px;
        }

        .workerGestionesRoundBtn {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          border: 1px solid ${adminTheme.colors.border};
          background: ${adminTheme.colors.panelSoft};
          color: ${adminTheme.colors.text};
          display: grid;
          placeItems: "center";
          cursor: pointer;
        }

        .workerGestionesContent {
          padding: 12px;
          display: grid;
          gap: 12px;
          overflow-x: hidden;
        }

        .workerBlock {
          background: ${adminTheme.colors.panelSoft};
          border-radius: 20px;
          border: 1px solid ${adminTheme.colors.border};
          padding: 14px;
          box-shadow: ${adminTheme.shadow.sm};
          overflow: hidden;
        }

        .workerBlockHeader {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 12px;
        }

        .workerBlockBadge {
          width: 44px;
          height: 44px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          color: ${adminTheme.colors.textOnPrimary};
          background: ${adminTheme.colors.primary};
        }

        .workerBlockTitle {
          font-size: 19px;
          line-height: 1.08;
          font-weight: 950;
          letter-spacing: -0.25px;
          color: ${adminTheme.colors.text};
        }

        .workerBlockSub {
          margin-top: 4px;
          font-size: 12px;
          line-height: 1.25;
          color: ${adminTheme.colors.textSoft};
          font-weight: 700;
        }

        .workerCardsGrid,
        .workerRequestGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }

        .workerFieldLabel {
          margin-top: 14px;
          margin-bottom: 8px;
          font-size: 13px;
          color: ${adminTheme.colors.textSoft};
          font-weight: 900;
          letter-spacing: -0.1px;
        }

        .workerDateGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .workerDateInput,
        .workerTextArea {
          width: 100%;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          color: ${adminTheme.colors.text};
          font-size: 14px;
          font-weight: 700;
          font-family: inherit;
        }

        .workerDateInput::-webkit-calendar-picker-indicator {
          cursor: pointer;
        }

        .workerTextArea::placeholder {
          color: ${adminTheme.colors.textMuted};
        }

        .workerTextAreaWrap {
          min-height: 106px;
          border-radius: 16px;
          border: 1px solid ${adminTheme.colors.border};
          background: ${adminTheme.colors.panelBg};
          padding: 12px;
        }

        .workerTextArea {
          resize: none;
          min-height: 80px;
          line-height: 1.35;
        }

        .workerMainBtn {
          margin-top: 12px;
          width: 100%;
          height: 50px;
          border: none;
          border-radius: 16px;
          background: ${adminTheme.colors.primary};
          color: ${adminTheme.colors.textOnPrimary};
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          font-size: 16px;
          font-weight: 950;
          letter-spacing: -0.15px;
          cursor: pointer;
        }

        .workerMainBtn:disabled {
          opacity: 0.75;
          cursor: not-allowed;
        }

        .workerInfoText {
          margin-top: 8px;
          font-size: 12px;
          font-weight: 800;
          color: ${adminTheme.colors.textSoft};
        }

        .workerSuccessText {
          margin-top: 8px;
          font-size: 12px;
          font-weight: 900;
          color: ${adminTheme.colors.success};
        }

        .workerErrorText {
          margin-top: 8px;
          font-size: 12px;
          font-weight: 900;
          color: ${adminTheme.colors.danger};
        }

        @media (max-width: 560px) {
          .workerGestionesShell {
            max-width: 520px;
          }

          .workerCardsGrid,
          .workerRequestGrid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .workerDateGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
      `}</style>

      <div className="workerGestionesShell">
        <div className="workerGestionesTopCard">
          <div className="workerGestionesHeader">
            <button
              type="button"
              className="workerGestionesRoundBtn"
              onClick={() => navigate("/worker")}
              aria-label="Volver"
              title="Volver"
            >
              <BackIcon />
            </button>

            <div className="workerGestionesHeaderTitle">Gestiones y Descargas</div>

            <div />
          </div>

          <div className="workerGestionesContent">
            <section className="workerBlock">
              <div className="workerBlockHeader">
                <div className="workerBlockBadge">
                  <DownloadBadgeIcon />
                </div>

                <div>
                  <div className="workerBlockTitle">Descargar historial</div>
                  <div className="workerBlockSub">Exporta tus fichajes en CSV</div>
                </div>
              </div>

              <div className="workerCardsGrid">
                <SelectCard
                  active={downloadRange === "week"}
                  onClick={() => setDownloadRange("week")}
                  icon={<CalendarIcon />}
                  label="Esta semana"
                />

                <SelectCard
                  active={downloadRange === "month"}
                  onClick={() => setDownloadRange("month")}
                  icon={<CalendarIcon />}
                  label="Este mes"
                />

                <SelectCard
                  active={downloadRange === "custom"}
                  onClick={() => setDownloadRange("custom")}
                  icon={<CalendarClockIcon />}
                  label={
                    <>
                      Rango
                      <br />
                      personal.
                    </>
                  }
                />
              </div>

              {downloadRange === "custom" && (
                <>
                  <div className="workerFieldLabel">Rango personalizado</div>

                  <div className="workerDateGrid">
                    <InputShell icon={<InputCalendarIcon />}>
                      <input
                        className="workerDateInput"
                        type="date"
                        value={customDownloadStart}
                        onChange={(e) => setCustomDownloadStart(e.target.value)}
                        aria-label="Fecha inicio descarga"
                      />
                    </InputShell>

                    <InputShell icon={<InputCalendarIcon />}>
                      <input
                        className="workerDateInput"
                        type="date"
                        value={customDownloadEnd}
                        onChange={(e) => setCustomDownloadEnd(e.target.value)}
                        aria-label="Fecha fin descarga"
                      />
                    </InputShell>
                  </div>
                </>
              )}

              <button
                type="button"
                className="workerMainBtn"
                onClick={handleDownload}
                disabled={downloadLoading}
                title={downloadLabel}
              >
                <DownloadBadgeIcon />
                <span>{downloadLoading ? "DESCARGANDO..." : "DESCARGAR (CSV)"}</span>
              </button>

              {downloadMessage && (
                <div
                  className={
                    downloadMessage.toLowerCase().includes("correctamente") ||
                    downloadMessage.toLowerCase().includes("descargado")
                      ? "workerSuccessText"
                      : "workerErrorText"
                  }
                >
                  {downloadMessage}
                </div>
              )}
            </section>

            <section className="workerBlock">
              <div className="workerBlockHeader">
                <div className="workerBlockBadge">
                  <MailBadgeIcon />
                </div>

                <div>
                  <div className="workerBlockTitle">Solicitar día libre o vacaciones</div>
                  <div className="workerBlockSub">Envía una solicitud al equipo</div>
                </div>
              </div>

              <div className="workerRequestGrid">
                <SelectCard
                  active={requestType === "vacaciones"}
                  onClick={() => setRequestType("vacaciones")}
                  icon={<PalmIcon />}
                  label="Vacaciones"
                />

                <SelectCard
                  active={requestType === "dia_libre"}
                  onClick={() => setRequestType("dia_libre")}
                  icon={<DayOffIcon />}
                  label="Día libre"
                />

                <SelectCard
                  active={requestType === "otro"}
                  onClick={() => setRequestType("otro")}
                  icon={<ChatIcon />}
                  label="Otro"
                />
              </div>

              <div className="workerFieldLabel">Fechas</div>

              <div className="workerDateGrid">
                <InputShell icon={<InputCalendarIcon />}>
                  <input
                    className="workerDateInput"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    aria-label="Fecha inicio"
                  />
                </InputShell>

                <InputShell icon={<InputCalendarIcon />}>
                  <input
                    className="workerDateInput"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    aria-label="Fecha fin"
                  />
                </InputShell>
              </div>

              <div className="workerFieldLabel">Motivo o comentario (opcional)</div>

              <div className="workerTextAreaWrap">
                <textarea
                  className="workerTextArea"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Explícales el motivo de tu solicitud..."
                />
              </div>

              <button
                type="button"
                className="workerMainBtn"
                onClick={handleSubmitRequest}
                disabled={requestLoading}
                title="Enviar solicitud"
              >
                <SendIcon />
                <span>{requestLoading ? "ENVIANDO..." : "ENVIAR SOLICITUD"}</span>
              </button>

              {requestMessage && (
                <div
                  className={
                    requestMessage.toLowerCase().includes("correctamente")
                      ? "workerSuccessText"
                      : "workerErrorText"
                  }
                >
                  {requestMessage}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}