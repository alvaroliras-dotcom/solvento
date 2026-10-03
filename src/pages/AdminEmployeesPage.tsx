import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useActiveMembership } from "../app/useActiveMembership";
import { adminTheme } from "../ui/adminTheme";
import { formatFechaMadrid } from "../lib/madrid";
import { cambiarPin, darDeAlta, darDeBaja, generarPin, reactivar } from "../lib/employees";

// ======================================================
// PARTE 1/6 — TIPOS
// ======================================================

type Persona = {
  id: string;
  email: string | null;
  full_name: string | null;
  status: string | null;
  ended_at: string | null;
  role: string | null;
  end_reason: string | null;
};

// Ventana que esta abierta: alta nueva, baja, reactivacion o cambio de PIN.
type Dialogo =
  | { tipo: "alta" }
  | { tipo: "baja"; persona: Persona }
  | { tipo: "reactivar"; persona: Persona }
  | { tipo: "pin"; persona: Persona };

// Lo que se ensena al terminar, con los datos que hay que darle al
// trabajador para que pueda entrar.
type Hecho = { titulo: string; nombre?: string; email?: string | null; pin?: string };

const MOTIVOS_BAJA = [
  "Fin de contrato",
  "Baja voluntaria",
  "Despido",
  "Fin del periodo de prueba",
  "Otro",
];

function nombreDe(p: Persona) {
  return (p.full_name ?? "").trim() || p.email || "este trabajador";
}

// ======================================================
// PARTE 2/6 — COMPONENTE Y ESTADO
// ======================================================

export function AdminEmployeesPage() {
  const navigate = useNavigate();
  const { membership, loading: membershipLoading } = useActiveMembership();

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null);
  const [hecho, setHecho] = useState<Hecho | null>(null);

  // Campos de las ventanas
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [motivo, setMotivo] = useState(MOTIVOS_BAJA[0]);
  const [motivoOtro, setMotivoOtro] = useState("");

// ======================================================
// PARTE 3/6 — CARGA DE DATOS Y ACCIONES
// ======================================================

  async function loadEmployees() {
    if (!membership) return;

    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase.rpc("admin_company_profiles_all", {
      p_company_id: membership.company_id,
    });

    // Antes un fallo de red se mostraba como "No hay empleados en esta
    // empresa", que hace pensar que se han borrado los datos.
    if (error) {
      setLoadError(error.message);
      setPersonas([]);
      setLoading(false);
      return;
    }

    setPersonas((data ?? []) as Persona[]);
    setLoading(false);
  }

  function abrir(d: Dialogo) {
    setDialogo(d);
    setErrorDialogo(null);
    setHecho(null);
    setNombre("");
    setEmail("");
    setPin(d.tipo === "baja" ? "" : generarPin());
    setMotivo(MOTIVOS_BAJA[0]);
    setMotivoOtro("");
  }

  function cerrar() {
    if (enviando) return;
    setDialogo(null);
    setErrorDialogo(null);
  }

  async function confirmar() {
    if (!dialogo || enviando) return;

    setEnviando(true);
    setErrorDialogo(null);

    let resultado;
    let aviso: Hecho;

    if (dialogo.tipo === "alta") {
      resultado = await darDeAlta(nombre.trim(), email.trim(), pin.trim());
      aviso = {
        titulo: resultado.ok && resultado.reactivado
          ? "Ya estaba en el sistema: se ha reactivado con el PIN nuevo"
          : "Alta hecha",
        nombre: nombre.trim(),
        email: email.trim().toLowerCase(),
        pin: pin.trim(),
      };
    } else if (dialogo.tipo === "baja") {
      const texto = motivo === "Otro" ? motivoOtro.trim() || "Otro" : motivo;
      resultado = await darDeBaja(dialogo.persona.id, texto);
      aviso = { titulo: `${nombreDe(dialogo.persona)} ya está de baja` };
    } else if (dialogo.tipo === "reactivar") {
      resultado = await reactivar(dialogo.persona.id, pin.trim());
      aviso = {
        titulo: "Trabajador reactivado",
        nombre: nombreDe(dialogo.persona),
        email: dialogo.persona.email,
        pin: pin.trim(),
      };
    } else {
      resultado = await cambiarPin(dialogo.persona.id, pin.trim());
      aviso = {
        titulo: "PIN cambiado",
        nombre: nombreDe(dialogo.persona),
        email: dialogo.persona.email,
        pin: pin.trim(),
      };
    }

    setEnviando(false);

    if (!resultado.ok) {
      setErrorDialogo(resultado.error);
      return;
    }

    setDialogo(null);
    setHecho(aviso);
    await loadEmployees();
  }

// ======================================================
// PARTE 4/6 — DERIVADOS Y EFECTOS
// ======================================================

  useEffect(() => {
    if (!membership) return;
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membership?.company_id]);

  const coincide = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (p: Persona) =>
      !q ||
      (p.full_name ?? "").toLowerCase().includes(q) ||
      (p.email ?? "").toLowerCase().includes(q);
  }, [search]);

  const activos = useMemo(
    () => personas.filter((p) => p.status === "active" && coincide(p)),
    [personas, coincide],
  );

  const deBaja = useMemo(
    () =>
      personas
        .filter((p) => p.status !== "active" && coincide(p))
        .sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? "")),
    [personas, coincide],
  );

  const totalActivos = personas.filter((p) => p.status === "active").length;

  const pinOk = /^\d{4,8}$/.test(pin.trim());
  const puedeConfirmar =
    !enviando &&
    (dialogo?.tipo === "alta"
      ? nombre.trim().length >= 3 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && pinOk
      : dialogo?.tipo === "baja"
      ? motivo !== "Otro" || motivoOtro.trim().length >= 3
      : pinOk);

// ======================================================
// PARTE 5/6 — ESTADOS BASE
// ======================================================

  if (membershipLoading) {
    return (
      <div style={{ padding: 24, color: adminTheme.colors.text, background: adminTheme.colors.appBg }}>
        Cargando…
      </div>
    );
  }

  if (!membership) {
    return (
      <div style={{ padding: 24, color: adminTheme.colors.text, background: adminTheme.colors.appBg }}>
        Sin empresa activa.
      </div>
    );
  }

// ======================================================
// PARTE 6/6 — UI DE LA PÁGINA
// ======================================================

  return (
    <div className="adminEmpPageUi">
      <style>{`
        .adminEmpPageUi {
          display: grid;
          gap: 12px;
        }

        .adminEmpTopBar {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }

        .adminEmpInput {
          height: 40px;
          padding: 0 12px;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: ${adminTheme.radius.md};
          background: ${adminTheme.colors.panelBg};
          color: ${adminTheme.colors.text};
          outline: none;
          font-weight: 700;
          min-width: 260px;
          box-sizing: border-box;
        }

        .adminEmpInput::placeholder {
          color: ${adminTheme.colors.textMuted};
        }

        .adminEmpBadge {
          height: 40px;
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

        .adminEmpCard {
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 18px;
          background: ${adminTheme.colors.panelBg};
          padding: 16px;
          box-shadow: ${adminTheme.shadow.sm};
        }

        .adminEmpCardTitle {
          margin: 0;
          font-size: 18px;
          font-weight: 800;
          color: ${adminTheme.colors.text};
        }

        .adminEmpCardSub {
          margin: 4px 0 0 0;
          font-size: 13px;
          font-weight: 600;
          color: ${adminTheme.colors.textSoft};
        }

        .adminEmpTableWrap {
          margin-top: 12px;
          overflow: auto;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 14px;
          background: ${adminTheme.colors.panelSoft};
        }

        .adminEmpTable {
          width: 100%;
          border-collapse: collapse;
          min-width: 680px;
        }

        .adminEmpTable th,
        .adminEmpTable td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid ${adminTheme.colors.border};
          font-size: 14px;
          color: ${adminTheme.colors.text};
          vertical-align: middle;
        }

        .adminEmpTable th {
          color: ${adminTheme.colors.textSoft};
          font-weight: 800;
          background: ${adminTheme.colors.panelAlt};
        }

        .adminEmpRight {
          text-align: right;
          white-space: nowrap;
        }

        .adminEmpBtn {
          height: 40px;
          padding: 0 16px;
          border: 1px solid ${adminTheme.colors.primary};
          border-radius: ${adminTheme.radius.md};
          background: ${adminTheme.colors.primary};
          color: ${adminTheme.colors.textOnPrimary};
          font-weight: 700;
          cursor: pointer;
          transition: background .18s ease, border-color .18s ease, color .18s ease;
        }

        .adminEmpBtn:disabled {
          opacity: .5;
          cursor: not-allowed;
        }

        .adminEmpBtnGhost {
          height: 40px;
          padding: 0 14px;
          margin-left: 6px;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: ${adminTheme.radius.md};
          background: ${adminTheme.colors.panelBg};
          color: ${adminTheme.colors.text};
          font-weight: 700;
          cursor: pointer;
        }

        .adminEmpBtnDanger {
          color: #b42318;
          border-color: #f1c0bb;
        }

        .adminEmpEmpty {
          margin-top: 12px;
          color: ${adminTheme.colors.textSoft};
          font-weight: 600;
        }

        .adminEmpTag {
          display: inline-block;
          margin-left: 8px;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          background: ${adminTheme.colors.panelAlt};
          color: ${adminTheme.colors.textSoft};
        }

        .adminEmpOverlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, .45);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          z-index: 50;
        }

        .adminEmpDialog {
          width: 100%;
          max-width: 460px;
          background: ${adminTheme.colors.panelBg};
          border-radius: 18px;
          padding: 20px;
          box-shadow: ${adminTheme.shadow.lg};
          display: grid;
          gap: 12px;
        }

        .adminEmpLabel {
          display: grid;
          gap: 6px;
          font-size: 13px;
          font-weight: 800;
          color: ${adminTheme.colors.textSoft};
        }

        .adminEmpLabel .adminEmpInput {
          min-width: 0;
          width: 100%;
        }

        .adminEmpPinRow {
          display: flex;
          gap: 8px;
        }

        .adminEmpPinRow .adminEmpInput {
          font-family: ui-monospace, monospace;
          font-size: 18px;
          letter-spacing: 3px;
        }

        .adminEmpError {
          padding: 10px 12px;
          border-radius: 12px;
          background: #fef3f2;
          color: #b42318;
          font-weight: 700;
          font-size: 14px;
        }

        .adminEmpOk {
          border: 1px solid #abefc6;
          background: #ecfdf3;
          color: #067647;
          border-radius: 14px;
          padding: 14px 16px;
          display: grid;
          gap: 6px;
          font-weight: 600;
        }

        .adminEmpOk strong {
          font-size: 16px;
        }

        .adminEmpCredenciales {
          font-family: ui-monospace, monospace;
          font-size: 15px;
          color: ${adminTheme.colors.text};
        }

        .adminEmpDialogActions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 4px;
        }

        @media (max-width: 700px) {
          .adminEmpInput {
            min-width: 100%;
          }
        }
      `}</style>

      <section className="adminEmpTopBar">
        <input
          className="adminEmpInput"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre / email"
        />

        <div className="adminEmpBadge">
          De alta: <strong style={{ marginLeft: 6 }}>{totalActivos}</strong>
        </div>

        <button className="adminEmpBtn" onClick={() => abrir({ tipo: "alta" })}>
          + Dar de alta a un trabajador
        </button>
      </section>

      {hecho && (
        <section className="adminEmpOk" role="status">
          <strong>{hecho.titulo}</strong>
          {hecho.pin && (
            <>
              <span>Dale estos datos a {hecho.nombre} para que pueda fichar desde ya:</span>
              <span className="adminEmpCredenciales">
                Correo: {hecho.email}
                <br />
                PIN: {hecho.pin}
              </span>
              <span style={{ fontSize: 13 }}>
                El PIN no se vuelve a mostrar. Si se le olvida, usa "Cambiar PIN".
              </span>
            </>
          )}
          <div>
            <button className="adminEmpBtnGhost" style={{ marginLeft: 0 }} onClick={() => setHecho(null)}>
              Entendido
            </button>
          </div>
        </section>
      )}

      <section className="adminEmpCard">
        <h2 className="adminEmpCardTitle">Plantilla</h2>
        <p className="adminEmpCardSub">
          Abre la ficha de cada trabajador, cambia su PIN o dale de baja.
        </p>

        {loading && <div className="adminEmpEmpty">Cargando empleados…</div>}

        {!loading && loadError && (
          <div className="adminEmpEmpty">No se ha podido cargar el listado: {loadError}</div>
        )}

        {!loading && !loadError && activos.length === 0 && (
          <div className="adminEmpEmpty">
            {search ? "Nadie coincide con la búsqueda." : "No hay trabajadores de alta."}
          </div>
        )}

        {!loading && activos.length > 0 && (
          <div className="adminEmpTableWrap">
            <table className="adminEmpTable">
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Email</th>
                  <th className="adminEmpRight"></th>
                </tr>
              </thead>
              <tbody>
                {activos.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {(p.full_name ?? "").trim() || "—"}
                      {p.role !== "employee" && <span className="adminEmpTag">Administración</span>}
                    </td>
                    <td>{p.email ?? "—"}</td>
                    <td className="adminEmpRight">
                      <button className="adminEmpBtn" onClick={() => navigate(`/admin/worker/${p.id}`)}>
                        Abrir ficha
                      </button>
                      {p.role === "employee" && (
                        <>
                          <button
                            className="adminEmpBtnGhost"
                            onClick={() => abrir({ tipo: "pin", persona: p })}
                          >
                            Cambiar PIN
                          </button>
                          <button
                            className="adminEmpBtnGhost adminEmpBtnDanger"
                            onClick={() => abrir({ tipo: "baja", persona: p })}
                          >
                            Dar de baja
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

      {!loading && deBaja.length > 0 && (
        <section className="adminEmpCard">
          <h2 className="adminEmpCardTitle">De baja</h2>
          <p className="adminEmpCardSub">
            No pueden entrar en la aplicación. Sus fichajes se conservan (obligación legal: 4 años).
          </p>

          <div className="adminEmpTableWrap">
            <table className="adminEmpTable">
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Email</th>
                  <th>Baja</th>
                  <th className="adminEmpRight"></th>
                </tr>
              </thead>
              <tbody>
                {deBaja.map((p) => (
                  <tr key={p.id}>
                    <td>{(p.full_name ?? "").trim() || "—"}</td>
                    <td>{p.email ?? "—"}</td>
                    <td>
                      {p.ended_at ? formatFechaMadrid(p.ended_at) : "—"}
                      {p.end_reason && (
                        <div style={{ fontSize: 12, color: adminTheme.colors.textSoft }}>
                          {p.end_reason}
                        </div>
                      )}
                    </td>
                    <td className="adminEmpRight">
                      <button
                        className="adminEmpBtnGhost"
                        style={{ marginLeft: 0 }}
                        onClick={() => navigate(`/admin/worker/${p.id}`)}
                      >
                        Ver fichajes
                      </button>
                      {p.role === "employee" && (
                        <button
                          className="adminEmpBtnGhost"
                          onClick={() => abrir({ tipo: "reactivar", persona: p })}
                        >
                          Reactivar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {dialogo && (
        <div className="adminEmpOverlay" onClick={cerrar}>
          <div
            className="adminEmpDialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="adminEmpCardTitle">
              {dialogo.tipo === "alta" && "Dar de alta a un trabajador"}
              {dialogo.tipo === "baja" && `Dar de baja a ${nombreDe(dialogo.persona)}`}
              {dialogo.tipo === "reactivar" && `Reactivar a ${nombreDe(dialogo.persona)}`}
              {dialogo.tipo === "pin" && `Nuevo PIN para ${nombreDe(dialogo.persona)}`}
            </h2>

            {dialogo.tipo === "alta" && (
              <>
                <label className="adminEmpLabel">
                  Nombre y apellidos
                  <input
                    className="adminEmpInput"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    autoFocus
                  />
                </label>
                <label className="adminEmpLabel">
                  Correo electrónico (con el que entrará)
                  <input
                    className="adminEmpInput"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              </>
            )}

            {dialogo.tipo === "baja" && (
              <>
                <p className="adminEmpCardSub" style={{ margin: 0 }}>
                  Dejará de poder entrar en la aplicación y de recibir avisos. Sus fichajes se
                  conservan y se pueden seguir consultando y exportando.
                </p>
                <label className="adminEmpLabel">
                  Motivo
                  <select
                    className="adminEmpInput"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                  >
                    {MOTIVOS_BAJA.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                {motivo === "Otro" && (
                  <label className="adminEmpLabel">
                    Explica el motivo
                    <input
                      className="adminEmpInput"
                      value={motivoOtro}
                      onChange={(e) => setMotivoOtro(e.target.value)}
                      autoFocus
                    />
                  </label>
                )}
              </>
            )}

            {dialogo.tipo !== "baja" && (
              <label className="adminEmpLabel">
                PIN (de 4 a 8 cifras)
                <div className="adminEmpPinRow">
                  <input
                    className="adminEmpInput"
                    inputMode="numeric"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  />
                  <button
                    type="button"
                    className="adminEmpBtnGhost"
                    style={{ marginLeft: 0 }}
                    onClick={() => setPin(generarPin())}
                  >
                    Generar otro
                  </button>
                </div>
              </label>
            )}

            {errorDialogo && <div className="adminEmpError">{errorDialogo}</div>}

            <div className="adminEmpDialogActions">
              <button className="adminEmpBtnGhost" onClick={cerrar} disabled={enviando}>
                Cancelar
              </button>
              <button
                className={dialogo.tipo === "baja" ? "adminEmpBtn" : "adminEmpBtn"}
                style={dialogo.tipo === "baja" ? { background: "#b42318", borderColor: "#b42318" } : undefined}
                onClick={confirmar}
                disabled={!puedeConfirmar}
              >
                {enviando
                  ? "Un momento…"
                  : dialogo.tipo === "alta"
                  ? "Dar de alta"
                  : dialogo.tipo === "baja"
                  ? "Confirmar la baja"
                  : dialogo.tipo === "reactivar"
                  ? "Reactivar"
                  : "Guardar PIN"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
