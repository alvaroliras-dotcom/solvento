import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  useOpenEntry,
  useCheckIn,
  useCheckOut,
  useCreateAdjustment,
} from "../domain/timeEntries/timeEntries.hooks";
import { useActiveMembership } from "../app/useActiveMembership";
import { useRegisterPushDevice } from "../app/useRegisterPushDevice";
import { useNavigate } from "react-router-dom";
import { adminTheme } from "../ui/adminTheme";

// ======================================================
// PARTE 1/6 — TIPOS Y HELPERS
// ======================================================

type HistoryEntry = {
  id: string;
  check_in_at: string;
  check_out_at: string | null;
  workflow_status: "auto" | "pending" | "adjusted" | "requires_new_proposal";
};

type GeoPayload = {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatHHMM(iso: string) {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function minutesBetween(startIso: string, endIso: string | null) {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);
  return Math.floor(diffMs / 60000);
}

function hhmmFromMinutes(totalMinutes: number) {
  const m = Math.max(0, Math.floor(totalMinutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${pad2(h)}:${pad2(mm)}`;
}

function isSameLocalDay(iso: string, day: Date) {
  const d = new Date(iso);
  return (
    d.getFullYear() === day.getFullYear() &&
    d.getMonth() === day.getMonth() &&
    d.getDate() === day.getDate()
  );
}

function formatLongDateEs(d: Date) {
  const weekday = d.toLocaleDateString("es-ES", { weekday: "long" });
  const day = d.getDate();
  const month = d.toLocaleDateString("es-ES", { month: "long" });
  return `${weekday}, ${day} de ${month}`;
}

function getCurrentPosition(): Promise<GeoPayload | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : null,
          capturedAt: new Date(position.timestamp).toISOString(),
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      }
    );
  });
}

function BracketArrowIcon({ direction }: { direction: "in" | "out" }) {
  const flip = direction === "out";

  return (
    <svg width="74" height="74" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <g transform={flip ? "translate(48,0) scale(-1,1)" : undefined}>
        <path
          d="M28 10H34V38H28"
          stroke="currentColor"
          strokeWidth="3.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M12 24H27" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" />
        <path
          d="M22 18.5L27.5 24L22 29.5"
          stroke="currentColor"
          strokeWidth="3.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

function IconButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!!disabled}
      title={title}
      aria-label={title}
      style={{
        width: 64,
        height: 64,
        borderRadius: 18,
        border: `1px solid ${adminTheme.colors.border}`,
        background: adminTheme.colors.panelSoft,
        color: adminTheme.colors.text,
        display: "grid",
        placeItems: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        boxShadow: adminTheme.shadow.sm,
      }}
    >
      {children}
    </button>
  );
}

function SettingsIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M19.4 12a7.6 7.6 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7.8 7.8 0 0 0-1.7-1l-.4-2.6H9.2l-.4 2.6a7.8 7.8 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.4-1c.5.4 1.1.8 1.7 1l.4 2.6h5.6l.4-2.6c.6-.2 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.6.1-1Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 8v5l3 2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 12a9 9 0 1 0 3-6.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M3 5v4h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 8h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10 7V6a2 2 0 0 1 2-2h7v16h-7a2 2 0 0 1-2-2v-1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M4 12h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M8 8l-4 4 4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ======================================================
// PARTE 2/6 — COMPONENTE Y ESTADO
// ======================================================

export function WorkerPage() {
  const navigate = useNavigate();

  const [userId, setUserId] = useState<string | null>(null);
  const { membership, loading: membershipLoading } = useActiveMembership();

  useRegisterPushDevice(!!membership?.company_id);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustReason, setAdjustReason] = useState("");
  const [tick, setTick] = useState(0);

  const goalHours = 8;
  const goalMinutes = goalHours * 60;

  const activeCompany = membership?.company_id ?? null;
  const {
  data: openEntry,
  isLoading,
  refetch: refetchOpenEntry,
} = useOpenEntry(activeCompany, userId);
  const checkIn = useCheckIn(activeCompany, userId);
  const checkOut = useCheckOut();
  const createAdjustment = useCreateAdjustment();

  const today = useMemo(() => new Date(), []);
  const isOpen = !!openEntry;

  // ======================================================
  // PARTE 3/6 — DATOS DERIVADOS
  // ======================================================

  const todayEntries = useMemo(() => {
    const base = history
      .filter((h) => isSameLocalDay(h.check_in_at, today))
      .sort(
        (a, b) =>
          new Date(a.check_in_at).getTime() - new Date(b.check_in_at).getTime()
      );

    if (!openEntry || !isSameLocalDay(openEntry.check_in_at, today)) {
      return base;
    }

    const alreadyIncluded = base.some((entry) => entry.id === openEntry.id);
    if (alreadyIncluded) {
      return base;
    }

    return [
      ...base,
      {
        id: openEntry.id,
        check_in_at: openEntry.check_in_at,
        check_out_at: openEntry.check_out_at ?? null,
        workflow_status: openEntry.workflow_status ?? "auto",
      },
    ].sort(
      (a, b) =>
        new Date(a.check_in_at).getTime() - new Date(b.check_in_at).getTime()
    );
  }, [history, today, openEntry]);

  const lastTodayEntry = useMemo(() => {
    if (todayEntries.length === 0) return null;
    return todayEntries[todayEntries.length - 1];
  }, [todayEntries]);

  const adjustmentTarget = useMemo(() => {
    if (openEntry) return openEntry;
    if (lastTodayEntry) return lastTodayEntry;
    return null;
  }, [openEntry, lastTodayEntry]);

  const isPending = adjustmentTarget?.workflow_status === "pending";
  const requiresNewProposal =
    adjustmentTarget?.workflow_status === "requires_new_proposal";

  const hasAdjustableContext = !!openEntry || todayEntries.length > 0;

  const isMainBlocked = false;
  const isAdjustBlocked = !hasAdjustableContext || isPending;

  const topMessage = useMemo(() => {
    if (!membership) {
      return "No se ha detectado tu empresa. Cierra sesión y vuelve a entrar.";
    }

    if (requiresNewProposal) {
      return "Tu ajuste fue rechazado. Envía una nueva propuesta.";
    }

    return "";
  }, [membership, requiresNewProposal]);

  const adjustmentHelpText = useMemo(() => {
    if (openEntry) {
      return "Estás ajustando la jornada abierta actual. Usa este campo solo si necesitas justificar una corrección.";
    }
    if (lastTodayEntry) {
      return "Estás ajustando el último tramo de hoy. Explica claramente qué ha pasado.";
    }
    return "No hay ningún tramo disponible para ajustar.";
  }, [openEntry, lastTodayEntry]);

  const totalTodayMinutes = useMemo(() => {
    void tick;
    let total = 0;

    for (const entry of todayEntries) {
      total += minutesBetween(entry.check_in_at, entry.check_out_at);
    }

    return total;
  }, [todayEntries, tick]);

  const mainTime = useMemo(() => {
    void tick;

    if (isOpen && openEntry) {
      return hhmmFromMinutes(minutesBetween(openEntry.check_in_at, null));
    }

    return hhmmFromMinutes(totalTodayMinutes);
  }, [isOpen, openEntry, totalTodayMinutes, tick]);

  const progress = useMemo(() => {
    if (goalMinutes <= 0) return 0;
    return Math.min(1, totalTodayMinutes / goalMinutes);
  }, [totalTodayMinutes, goalMinutes]);

  const isBusy =
    (isOpen && checkOut.isPending) || (!isOpen && checkIn.isPending);

  const mainLabel = isOpen ? "SALIR" : "ENTRAR";
  const todayShown = todayEntries.slice(0, 2);

  // ======================================================
  // PARTE 4/6 — CARGA Y ACCIONES
  // ======================================================

  async function loadHistory() {
    if (!activeCompany || !userId) return;

    setHistoryLoading(true);
    setHistoryError(null);

    const { data, error } = await supabase
      .from("time_entries")
      .select("id,check_in_at,check_out_at,workflow_status")
      .eq("company_id", activeCompany)
      .eq("user_id", userId)
      .order("check_in_at", { ascending: false })
      .limit(50);

    if (error) {
      setHistoryError(error.message);
      setHistory([]);
      setHistoryLoading(false);
      return;
    }

    setHistory((data ?? []) as HistoryEntry[]);
    setHistoryLoading(false);
  }

	async function onMainPress() {
	  if (isMainBlocked || !activeCompany || !userId) return;

	  const geo = await getCurrentPosition();

	  // Releer SIEMPRE el estado real justo antes de decidir
	  const { data: freshOpenEntry } = await refetchOpenEntry();

	  if (!freshOpenEntry) {
		checkIn.mutate(geo, {
		  onSuccess: async () => {
			await loadHistory();
			await refetchOpenEntry();
		  },
		});
		return;
	  }

	  checkOut.mutate(
		{ entryId: freshOpenEntry.id, geo },
		{
		  onSuccess: async () => {
			await loadHistory();
			await refetchOpenEntry();
		  },
		}
	  );
	}

  async function onSubmitAdjustment() {
    if (!adjustmentTarget) return;

    const reason = adjustReason.trim();
    if (reason.length < 3) return;

    try {
      await createAdjustment.mutateAsync({
        timeEntryId: adjustmentTarget.id,
        proposedCheckOut: new Date().toISOString(),
        reason,
      });

      setAdjustReason("");
      await loadHistory();
    } catch (err) {
      console.error(err);
    }
  }

  // ======================================================
  // PARTE 5/6 — EFECTOS Y ESTADOS BASE
  // ======================================================

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!activeCompany || !userId) return;
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompany, userId]);

  useEffect(() => {
    if (!openEntry) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [openEntry]);

  useEffect(() => {
    if (requiresNewProposal) {
      setShowAdjust(true);
    }
  }, [requiresNewProposal]);

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

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          padding: 24,
          color: adminTheme.colors.text,
          background: adminTheme.colors.pageBg,
        }}
      >
        Cargando estado...
      </div>
    );
  }

  // ======================================================
  // PARTE 6/6 — UI DE LA PÁGINA
  // ======================================================

  return (
    <div
      className="workerPageUi"
      style={{
        minHeight: "100vh",
        width: "100%",
        background: `linear-gradient(180deg, ${adminTheme.colors.primary} 0%, ${adminTheme.colors.primarySoft} 100%)`,
        display: "flex",
        justifyContent: "center",
        padding: 10,
      }}
    >
      <style>{`
        .workerPageUi * {
          box-sizing: border-box;
        }

        .workerShell {
          width: 100%;
          max-width: 520px;
          display: grid;
          gap: 10px;
        }

        .workerCard {
          background: ${adminTheme.colors.panelBg};
          border-radius: 22px;
          border: 1px solid ${adminTheme.colors.border};
          box-shadow: ${adminTheme.shadow.lg};
          backdrop-filter: blur(6px);
          padding: 14px;
        }

        .workerDate {
          text-align: center;
          font-size: 15px;
          font-weight: 900;
          color: ${adminTheme.colors.text};
          text-transform: capitalize;
        }

        .workerMainTimeWrap {
          text-align: center;
          margin-top: 6px;
        }

        .workerMainTime {
          font-size: 44px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: 1px;
          color: ${adminTheme.colors.text};
        }

        .workerMainSub {
          margin-top: 4px;
          font-size: 12px;
          color: ${adminTheme.colors.textSoft};
          font-weight: 700;
        }

        .workerProgressWrap {
          margin-top: 10px;
        }

        .workerProgressLabels {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: ${adminTheme.colors.textSoft};
          font-weight: 800;
          margin-bottom: 5px;
        }

        .workerProgressBar {
          height: 10px;
          border-radius: ${adminTheme.radius.pill};
          background: ${adminTheme.colors.panelAlt};
          overflow: hidden;
        }

        .workerProgressValue {
          height: 100%;
          width: ${Math.round(progress * 100)}%;
          background: linear-gradient(90deg, ${adminTheme.colors.primary} 0%, ${adminTheme.colors.primarySoft} 100%);
        }

        .workerMainButtonWrap {
          margin-top: 12px;
          display: flex;
          justify-content: center;
        }

        .workerMainButton {
          width: 184px;
          height: 184px;
          border-radius: 999px;
          border: 3px solid rgba(255,255,255,0.28);
          background: radial-gradient(circle at 30% 25%, rgba(255,255,255,0.34), rgba(255,255,255,0) 45%), ${
            isOpen ? adminTheme.colors.danger : adminTheme.colors.success
          };
          color: ${adminTheme.colors.textOnPrimary};
          cursor: ${isBusy || isMainBlocked ? "not-allowed" : "pointer"};
          box-shadow: ${adminTheme.shadow.lg};
          display: grid;
          place-items: center;
          opacity: ${isMainBlocked ? 0.65 : 1};
          transform: ${isBusy ? "scale(0.995)" : "scale(1)"};
          transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
        }

        .workerMainButtonInner {
          display: grid;
          place-items: center;
          gap: 8px;
        }

        .workerMainButtonInner svg {
          width: 60px;
          height: 60px;
        }

        .workerMainButtonLabel {
          font-size: 20px;
          font-weight: 950;
          letter-spacing: 1px;
          text-shadow: 0 8px 18px rgba(0,0,0,0.22);
        }

        .workerMessage {
          margin-top: 12px;
          padding: 10px;
          border-radius: 14px;
          font-weight: 800;
          text-align: center;
          border: 1px solid ${adminTheme.colors.border};
          background: ${adminTheme.colors.panelSoft};
          color: ${adminTheme.colors.text};
        }

        .workerMessage.error {
          background: ${adminTheme.colors.dangerSoft};
          border-color: ${adminTheme.colors.danger};
          color: ${adminTheme.colors.danger};
        }

        .workerTodayHead {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
        }

        .workerTodayTitle {
          font-weight: 950;
          font-size: 15px;
          color: ${adminTheme.colors.text};
        }

        .workerTodayTotal {
          font-weight: 900;
          color: ${adminTheme.colors.text};
          font-size: 14px;
        }

        .workerMuted {
          margin-top: 8px;
          color: ${adminTheme.colors.textSoft};
          font-size: 13px;
        }

        .workerEntries {
          margin-top: 10px;
          display: grid;
          gap: 8px;
        }

        .workerEntryCard {
          border-radius: 18px;
          padding: 10px;
          border: 1px solid ${adminTheme.colors.border};
          background: ${adminTheme.colors.panelSoft};
          box-shadow: ${adminTheme.shadow.sm};
          display: grid;
          gap: 8px;
        }

        .workerEntryTitle {
          font-weight: 950;
          color: ${adminTheme.colors.text};
          font-size: 15px;
        }

        .workerEntryGrid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 8px;
        }

        .workerEntryMini {
          background: ${adminTheme.colors.panelBg};
          border-radius: 16px;
          padding: 10px 8px;
          text-align: center;
          border: 1px solid ${adminTheme.colors.border};
          min-width: 0;
        }

        .workerEntryMiniLabel {
          font-size: 11px;
          color: ${adminTheme.colors.textMuted};
          font-weight: 800;
        }

        .workerEntryMiniValue {
          font-size: 16px;
          font-weight: 950;
          color: ${adminTheme.colors.text};
          line-height: 1.1;
          margin-top: 2px;
          word-break: break-word;
        }

        .workerBottomCard {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          padding-top: 12px;
          padding-bottom: 12px;
        }

        .workerAdjustCard {
          display: grid;
          gap: 10px;
        }

        .workerAdjustTitle {
          font-weight: 950;
          color: ${adminTheme.colors.text};
        }

        .workerAdjustHelp {
          font-size: 12px;
          color: ${adminTheme.colors.textSoft};
          line-height: 1.45;
          font-weight: 700;
        }

        .workerAdjustInput {
          width: 100%;
          padding: 14px;
          border-radius: 16px;
          border: 1px solid ${adminTheme.colors.border};
          font-size: 15px;
          outline: none;
          background: ${adminTheme.colors.panelSoft};
          color: ${adminTheme.colors.text};
          box-sizing: border-box;
        }

        .workerAdjustInput::placeholder {
          color: ${adminTheme.colors.textMuted};
        }

        .workerAdjustBtn {
          width: 100%;
          padding: 14px;
          border-radius: 16px;
          border: 1px solid ${adminTheme.colors.primary};
          background: ${adminTheme.colors.primary};
          color: ${adminTheme.colors.textOnPrimary};
          font-size: 15px;
          font-weight: 950;
          cursor: pointer;
          box-shadow: ${adminTheme.shadow.sm};
        }

        .workerAdjustBtn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .workerErrorText {
          color: ${adminTheme.colors.danger};
          font-size: 13px;
        }

        .workerSuccessText {
          color: ${adminTheme.colors.success};
          font-size: 13px;
          font-weight: 900;
        }

        @media (max-width: 560px) {
          .workerPageUi {
            padding: 8px;
          }

          .workerShell {
            gap: 8px;
          }

          .workerCard {
            padding: 12px;
          }

          .workerMainTime {
            font-size: 38px;
          }

          .workerMainButton {
            width: 160px;
            height: 160px;
          }

          .workerMainButtonInner svg {
            width: 56px;
            height: 56px;
          }

          .workerMainButtonLabel {
            font-size: 17px;
          }

          .workerEntryGrid {
            grid-template-columns: 1fr 1fr 1fr;
            gap: 6px;
          }

          .workerEntryMini {
            padding: 8px 6px;
            border-radius: 14px;
          }

          .workerEntryMiniLabel {
            font-size: 10px;
          }

          .workerEntryMiniValue {
            font-size: 14px;
          }

          .workerBottomCard {
            gap: 6px;
          }

          .workerBottomCard button {
            width: 56px !important;
            height: 56px !important;
            border-radius: 16px !important;
          }

          .workerBottomCard button svg {
            width: 24px;
            height: 24px;
          }
        }
      `}</style>

      <div className="workerShell">
        <section className="workerCard">
          <div className="workerDate">{formatLongDateEs(today)}</div>

          <div className="workerMainTimeWrap">
            <div className="workerMainTime">{mainTime}</div>
            <div className="workerMainSub">
              {isOpen ? "Jornada en curso" : "Trabajado hoy"}
            </div>

            <div className="workerProgressWrap">
              <div className="workerProgressLabels">
                <span>0h</span>
                <span>{goalHours}h</span>
              </div>

              <div className="workerProgressBar">
                <div className="workerProgressValue" />
              </div>
            </div>
          </div>

          <div className="workerMainButtonWrap">
            <button
              className="workerMainButton"
              onClick={onMainPress}
              disabled={isBusy || isMainBlocked}
            >
              <div className="workerMainButtonInner">
                <BracketArrowIcon direction={isOpen ? "out" : "in"} />
                <div className="workerMainButtonLabel">{isBusy ? "…" : mainLabel}</div>
              </div>
            </button>
          </div>

          {(topMessage || historyError) && (
            <div className={`workerMessage ${historyError ? "error" : ""}`}>
              {historyError ? historyError : topMessage}
            </div>
          )}
        </section>

        <section className="workerCard">
          <div className="workerTodayHead">
            <div className="workerTodayTitle">Hoy</div>
            <div className="workerTodayTotal">
              Total: {hhmmFromMinutes(totalTodayMinutes)}
            </div>
          </div>

          {historyLoading && <div className="workerMuted">Cargando…</div>}

          {!historyLoading && todayEntries.length === 0 && (
            <div className="workerMuted">Sin registros hoy.</div>
          )}

          {!historyLoading && todayEntries.length > 0 && (
            <div className="workerEntries">
              {todayShown.map((e, idx) => {
                const mins = minutesBetween(e.check_in_at, e.check_out_at);

                return (
                  <div key={e.id} className="workerEntryCard">
                    <div className="workerEntryTitle">Tramo {idx + 1}</div>

                    <div className="workerEntryGrid">
                      <div className="workerEntryMini">
                        <div className="workerEntryMiniLabel">Entrada</div>
                        <div className="workerEntryMiniValue">{formatHHMM(e.check_in_at)}</div>
                      </div>

                      <div className="workerEntryMini">
                        <div className="workerEntryMiniLabel">Salida</div>
                        <div className="workerEntryMiniValue">
                          {e.check_out_at ? formatHHMM(e.check_out_at) : "—"}
                        </div>
                      </div>

                      <div className="workerEntryMini">
                        <div className="workerEntryMiniLabel">Tiempo</div>
                        <div className="workerEntryMiniValue">{hhmmFromMinutes(mins)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {todayEntries.length > 2 && (
                <div className="workerMuted">
                  (Hay más tramos hoy. Se verán en “Histórico”.)
                </div>
              )}
            </div>
          )}
        </section>

        <section className="workerCard workerBottomCard">
          <IconButton
            title="Ajustes"
            onClick={() => setShowAdjust((s) => !s)}
            disabled={isAdjustBlocked}
          >
            <SettingsIcon />
          </IconButton>

          <IconButton title="Histórico" onClick={() => navigate("/worker/history")}>
            <HistoryIcon />
          </IconButton>

          <IconButton title="Gestiones" onClick={() => navigate("/worker/gestiones")}>
            <BriefcaseIcon />
          </IconButton>

          <IconButton title="Salir" onClick={() => supabase.auth.signOut()}>
            <LogoutIcon />
          </IconButton>
        </section>

        {showAdjust && (
          <section className="workerCard workerAdjustCard">
            <div className="workerAdjustTitle">
              {requiresNewProposal ? "Enviar nueva propuesta" : "Solicitar ajuste"}
            </div>

            <div className="workerAdjustHelp">{adjustmentHelpText}</div>

            <input
              className="workerAdjustInput"
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder={
                requiresNewProposal
                  ? "Explica la nueva propuesta (obligatorio)"
                  : openEntry
                  ? "Ejemplo: olvidé fichar salida y solicito regularización"
                  : "Ejemplo: olvidé fichar correctamente este tramo"
              }
            />

            <button
              className="workerAdjustBtn"
              onClick={onSubmitAdjustment}
              disabled={createAdjustment.isPending || adjustReason.trim().length < 3}
            >
              {createAdjustment.isPending
                ? "Enviando…"
                : requiresNewProposal
                ? "Enviar nueva propuesta"
                : "Enviar"}
            </button>

            {createAdjustment.error && (
              <div className="workerErrorText">
                {(createAdjustment.error as any)?.message ?? "Error"}
              </div>
            )}

            {createAdjustment.isSuccess && (
              <div className="workerSuccessText">
                Tu solicitud de ajuste se ha enviado correctamente. El administrador la revisará.
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}