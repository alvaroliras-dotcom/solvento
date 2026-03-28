import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useActiveMembership } from "../app/useActiveMembership";
import { useNavigate } from "react-router-dom";
import { adminTheme } from "../ui/adminTheme";

type HistoryEntry = {
  id: string;
  check_in_at: string;
  check_out_at: string | null;
  workflow_status:
    | "auto"
    | "pending"
    | "adjusted"
    | "requires_new_proposal"
    | null;
  flags?: any;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function formatHour(iso: string) {
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 160ms ease",
      }}
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WorkerHistoryPage() {
  const navigate = useNavigate();
  const { membership, loading: membershipLoading } = useActiveMembership();

  const [userId, setUserId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  async function loadHistory() {
    if (!membership?.company_id || !userId) return;

    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from("time_entries")
      .select("id,check_in_at,check_out_at,workflow_status,flags")
      .eq("company_id", membership.company_id)
      .eq("user_id", userId)
      .order("check_in_at", { ascending: false })
      .limit(60);

    if (error) {
      setError(error.message);
      setHistory([]);
      setLoading(false);
      return;
    }

    setHistory((data ?? []) as HistoryEntry[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!membership?.company_id || !userId) return;
    loadHistory();
  }, [membership?.company_id, userId]);

  const grouped = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();

    for (const item of history) {
      const d = new Date(item.check_in_at);
      const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }

    return Array.from(map.entries()).map(([key, items]) => {
      const totalMinutes = items.reduce(
        (acc, item) => acc + minutesBetween(item.check_in_at, item.check_out_at),
        0
      );

      const hasIncident = items.some(
        (item) =>
          item.workflow_status === "pending" ||
          item.workflow_status === "adjusted" ||
          item.workflow_status === "requires_new_proposal"
      );

      const hasOpen = items.some((item) => !item.check_out_at);

      return {
        key,
        label: formatDateShort(items[0].check_in_at),
        totalMinutes,
        items,
        count: items.length,
        hasIncident,
        hasOpen,
      };
    });
  }, [history]);

  function toggleDay(key: string) {
    setOpenDays((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
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
      style={{
        minHeight: "100vh",
        width: "100%",
        background: `linear-gradient(180deg, ${adminTheme.colors.primary} 0%, ${adminTheme.colors.primarySoft} 100%)`,
        display: "flex",
        justifyContent: "center",
        padding: 14,
      }}
    >
      <div style={{ width: "100%", maxWidth: 520, display: "grid", gap: 12 }}>
        <div
          style={{
            background: adminTheme.colors.panelBg,
            borderRadius: 22,
            border: `1px solid ${adminTheme.colors.border}`,
            boxShadow: adminTheme.shadow.lg,
            backdropFilter: "blur(6px)",
            padding: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <button
              onClick={() => navigate("/worker")}
              style={{
                width: 46,
                height: 46,
                borderRadius: 14,
                border: `1px solid ${adminTheme.colors.border}`,
                background: adminTheme.colors.panelSoft,
                color: adminTheme.colors.text,
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
              }}
            >
              <BackIcon />
            </button>

            <div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 950,
                  color: adminTheme.colors.text,
                }}
              >
                Histórico
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: adminTheme.colors.textSoft,
                  fontWeight: 700,
                }}
              >
                Resumen diario de fichajes
              </div>
            </div>
          </div>
        </div>

        {loading && (
          <div
            style={{
              background: adminTheme.colors.panelBg,
              borderRadius: 22,
              border: `1px solid ${adminTheme.colors.border}`,
              boxShadow: adminTheme.shadow.lg,
              backdropFilter: "blur(6px)",
              padding: 16,
              color: adminTheme.colors.textSoft,
            }}
          >
            Cargando histórico…
          </div>
        )}

        {error && (
          <div
            style={{
              background: adminTheme.colors.panelBg,
              borderRadius: 22,
              border: `1px solid ${adminTheme.colors.danger}`,
              boxShadow: adminTheme.shadow.lg,
              backdropFilter: "blur(6px)",
              padding: 16,
              color: adminTheme.colors.danger,
              fontWeight: 800,
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && grouped.length === 0 && (
          <div
            style={{
              background: adminTheme.colors.panelBg,
              borderRadius: 22,
              border: `1px solid ${adminTheme.colors.border}`,
              boxShadow: adminTheme.shadow.lg,
              backdropFilter: "blur(6px)",
              padding: 16,
              color: adminTheme.colors.textSoft,
            }}
          >
            No hay fichajes registrados.
          </div>
        )}

        {!loading &&
          !error &&
          grouped.map((group) => {
            const isOpen = !!openDays[group.key];

            return (
              <div
                key={group.key}
                style={{
                  background: adminTheme.colors.panelBg,
                  borderRadius: 22,
                  border: `1px solid ${adminTheme.colors.border}`,
                  boxShadow: adminTheme.shadow.lg,
                  backdropFilter: "blur(6px)",
                  padding: 12,
                }}
              >
                <button
                  onClick={() => toggleDay(group.key)}
                  style={{
                    width: "100%",
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    cursor: "pointer",
                    textAlign: "left",
                    color: adminTheme.colors.text,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.2fr .9fr .8fr auto",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 950,
                          color: adminTheme.colors.text,
                          textTransform: "capitalize",
                        }}
                      >
                        {group.label}
                      </div>
                      <div
                        style={{
                          marginTop: 2,
                          fontSize: 12,
                          color: adminTheme.colors.textSoft,
                          fontWeight: 700,
                        }}
                      >
                        {group.count} tramo{group.count !== 1 ? "s" : ""}
                      </div>
                    </div>

                    <div>
                      <div
                        style={{
                          fontSize: 12,
                          color: adminTheme.colors.textSoft,
                          fontWeight: 800,
                        }}
                      >
                        Total
                      </div>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 950,
                          color: adminTheme.colors.text,
                        }}
                      >
                        {hhmmFromMinutes(group.totalMinutes)}
                      </div>
                    </div>

                    <div>
                      <div
                        style={{
                          fontSize: 12,
                          color: adminTheme.colors.textSoft,
                          fontWeight: 800,
                        }}
                      >
                        Estado
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 900,
                          color: group.hasOpen
                            ? adminTheme.colors.danger
                            : group.hasIncident
                            ? adminTheme.colors.danger
                            : adminTheme.colors.success,
                        }}
                      >
                        {group.hasOpen
                          ? "abierto"
                          : group.hasIncident
                          ? "revisar"
                          : "ok"}
                      </div>
                    </div>

                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 12,
                        background: adminTheme.colors.panelSoft,
                        color: adminTheme.colors.text,
                        display: "grid",
                        placeItems: "center",
                        border: `1px solid ${adminTheme.colors.border}`,
                      }}
                    >
                      <ChevronIcon open={isOpen} />
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div
                    style={{
                      marginTop: 12,
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    {group.items.map((item, idx) => {
                      const mins = minutesBetween(item.check_in_at, item.check_out_at);
                      const hasIncident =
                        item.workflow_status === "pending" ||
                        item.workflow_status === "adjusted" ||
                        item.workflow_status === "requires_new_proposal";

                      return (
                        <div
                          key={item.id}
                          style={{
                            borderRadius: 16,
                            padding: 10,
                            border: `1px solid ${adminTheme.colors.border}`,
                            background: adminTheme.colors.panelSoft,
                            display: "grid",
                            gap: 8,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              alignItems: "center",
                            }}
                          >
                            <div
                              style={{
                                fontWeight: 900,
                                color: adminTheme.colors.text,
                                fontSize: 14,
                              }}
                            >
                              Tramo {idx + 1}
                            </div>

                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 900,
                                padding: "5px 9px",
                                borderRadius: 999,
                                background:
                                  hasIncident || !item.check_out_at
                                    ? adminTheme.colors.dangerSoft
                                    : adminTheme.colors.panelAlt,
                                color:
                                  hasIncident || !item.check_out_at
                                    ? adminTheme.colors.danger
                                    : adminTheme.colors.textSoft,
                                border: `1px solid ${
                                  hasIncident || !item.check_out_at
                                    ? adminTheme.colors.danger
                                    : adminTheme.colors.border
                                }`,
                              }}
                            >
                              {!item.check_out_at
                                ? "abierto"
                                : hasIncident
                                ? item.workflow_status
                                : "normal"}
                            </div>
                          </div>

                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr 1fr",
                              gap: 8,
                            }}
                          >
                            <div
                              style={{
                                borderRadius: 14,
                                padding: 10,
                                background: adminTheme.colors.panelBg,
                                border: `1px solid ${adminTheme.colors.border}`,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  color: adminTheme.colors.textMuted,
                                  fontWeight: 800,
                                }}
                              >
                                Entrada
                              </div>
                              <div
                                style={{
                                  marginTop: 2,
                                  fontSize: 15,
                                  color: adminTheme.colors.text,
                                  fontWeight: 950,
                                }}
                              >
                                {formatHour(item.check_in_at)}
                              </div>
                            </div>

                            <div
                              style={{
                                borderRadius: 14,
                                padding: 10,
                                background: adminTheme.colors.panelBg,
                                border: `1px solid ${adminTheme.colors.border}`,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  color: adminTheme.colors.textMuted,
                                  fontWeight: 800,
                                }}
                              >
                                Salida
                              </div>
                              <div
                                style={{
                                  marginTop: 2,
                                  fontSize: 15,
                                  color: adminTheme.colors.text,
                                  fontWeight: 950,
                                }}
                              >
                                {item.check_out_at ? formatHour(item.check_out_at) : "—"}
                              </div>
                            </div>

                            <div
                              style={{
                                borderRadius: 14,
                                padding: 10,
                                background: adminTheme.colors.panelBg,
                                border: `1px solid ${adminTheme.colors.border}`,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  color: adminTheme.colors.textMuted,
                                  fontWeight: 800,
                                }}
                              >
                                Tiempo
                              </div>
                              <div
                                style={{
                                  marginTop: 2,
                                  fontSize: 15,
                                  color: adminTheme.colors.text,
                                  fontWeight: 950,
                                }}
                              >
                                {hhmmFromMinutes(mins)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}