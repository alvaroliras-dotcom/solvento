import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { adminTheme } from "./adminTheme";

// ======================================================
// PARTE 1/5 — TIPOS Y METADATOS
// ======================================================

type AdminPageMeta = {
  title: string;
  subtitle: string;
};

function getAdminPageMeta(pathname: string): AdminPageMeta {
  if (pathname === "/admin") {
    return {
      title: "Panel de administración",
      subtitle: "Resumen general",
    };
  }

  if (pathname.startsWith("/admin/incidents")) {
    return {
      title: "Panel de incidencias",
      subtitle: "Gestión y revisión",
    };
  }

  if (pathname.startsWith("/admin/employees")) {
    return {
      title: "Panel de empleados",
      subtitle: "Listado y acceso a fichas",
    };
  }

  if (pathname.startsWith("/admin/exports")) {
    return {
      title: "Panel de exportaciones",
      subtitle: "Descarga y control de datos",
    };
  }

  if (pathname.startsWith("/admin/settings")) {
    return {
      title: "Panel de configuración",
      subtitle: "Calendario laboral y ajustes",
    };
  }

  if (pathname.startsWith("/admin/worker/")) {
    return {
      title: "Ficha de trabajador",
      subtitle: "Detalle individual",
    };
  }

  return {
    title: "Panel de administración",
    subtitle: "Gestión de empresa",
  };
}

// ======================================================
// PARTE 2/5 — ICONOS
// ======================================================

function HomeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 10.5 12 4l9 6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 9.5V20h14V9.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9 20v-6h6v6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IncidentsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 8.5v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 16.5h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M10.3 4.8 2.8 18.2A2 2 0 0 0 4.5 21h15a2 2 0 0 0 1.7-2.8L13.7 4.8a2 2 0 0 0-3.4 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmployeesIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M5 20a7 7 0 0 1 14 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ExportsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M8.5 10.5 12 14l3.5-3.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5 18.5h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 9.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.1a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.1a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.1a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a2 2 0 1 1 0 4h-.1a1 1 0 0 0-.9.6Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ======================================================
// PARTE 3/5 — COMPONENTE
// ======================================================

export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const pageMeta = getAdminPageMeta(location.pathname);

  const isActive = (path: string) => {
    if (path === "/admin") return location.pathname === "/admin";
    return location.pathname.startsWith(path);
  };

  return (
    <div className="cerbAdmRoot">
      <style>{`
        .cerbAdmRoot {
          min-height: 100vh;
          background: linear-gradient(180deg, ${adminTheme.colors.appBg} 0%, ${adminTheme.colors.panelSoft} 100%);
          color: ${adminTheme.colors.text};
          padding: ${adminTheme.layout.pagePadding};
        }

        .cerbAdmRoot * {
          box-sizing: border-box;
        }

        .cerbAdmShell {
          max-width: ${adminTheme.layout.maxWidth};
          margin: 0 auto;
          display: grid;
          grid-template-columns: ${adminTheme.layout.sidebarWidth} minmax(0, 1fr);
          gap: ${adminTheme.layout.sectionGap};
          align-items: start;
        }

        .cerbAdmSidebar {
          min-height: calc(100vh - 32px);
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 22px;
          background: linear-gradient(180deg, ${adminTheme.colors.panelBg} 0%, ${adminTheme.colors.panelSoft} 100%);
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          box-shadow: ${adminTheme.shadow.md};
        }

        .cerbAdmNavBtn {
          width: 100%;
          height: 56px;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 14px;
          background: ${adminTheme.colors.panelBg};
          color: ${adminTheme.colors.textSoft};
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex: 0 0 auto;
          transition: background .18s ease, border-color .18s ease, color .18s ease, transform .18s ease;
        }

        .cerbAdmNavBtn:hover {
          background: ${adminTheme.colors.panelAlt};
          color: ${adminTheme.colors.text};
          transform: translateY(-1px);
        }

        .cerbAdmNavBtn.isActive {
          background: ${adminTheme.colors.primarySoft};
          border-color: ${adminTheme.colors.primary};
          color: ${adminTheme.colors.primary};
          box-shadow: inset 0 0 0 1px ${adminTheme.colors.primary};
        }

        .cerbAdmSidebarSpacer {
          flex: 1 1 auto;
        }

        .cerbAdmSidebarBrand {
          border-top: 1px solid ${adminTheme.colors.border};
          padding-top: 14px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          flex: 0 0 auto;
        }

        .cerbAdmCerberoLogo {
          width: 120px;
          max-width: 100%;
          height: auto;
          display: block;
          filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.08));
        }

        .cerbAdmVersion {
          font-size: 11px;
          color: ${adminTheme.colors.primary};
          font-weight: 900;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          padding: 4px 10px;
          border-radius: 999px;
          background: ${adminTheme.colors.primarySoft};
          border: 1px solid ${adminTheme.colors.primaryBorder};
        }

        .cerbAdmMain {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: ${adminTheme.layout.sectionGap};
        }

        .cerbAdmHeader {
          height: ${adminTheme.layout.headerHeight};
          min-height: ${adminTheme.layout.headerHeight};
          max-height: ${adminTheme.layout.headerHeight};
          overflow: hidden;
          border: 1px solid ${adminTheme.colors.border};
          border-radius: 22px;
          background: linear-gradient(90deg, ${adminTheme.colors.panelBg} 0%, ${adminTheme.colors.panelSoft} 100%);
          padding: 8px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex: 0 0 auto;
          box-shadow: ${adminTheme.shadow.md};
        }

        .cerbAdmHeaderText {
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 2px;
        }

        .cerbAdmHeaderTitle {
          margin: 0;
          font-size: 18px;
          line-height: 1;
          font-weight: 900;
          color: ${adminTheme.colors.text};
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cerbAdmHeaderSubtitle {
          margin: 0;
          font-size: 11px;
          line-height: 1;
          color: ${adminTheme.colors.textSoft};
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cerbAdmHeaderLogoWrap {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          flex: 0 0 auto;
          height: 100%;
          min-width: 150px;
        }

        .cerbAdmSolventoLogo {
          height: 42px;
          max-height: 42px;
          width: auto;
          display: block;
          object-fit: contain;
          filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.10));
        }

        .cerbAdmBody {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: ${adminTheme.layout.sectionGap};
        }

        @media (max-width: 1100px) {
          .cerbAdmShell {
            grid-template-columns: 1fr;
          }

          .cerbAdmSidebar {
            min-height: auto;
            flex-direction: row;
            align-items: center;
          }

          .cerbAdmNavBtn {
            width: 56px;
            min-width: 56px;
          }

          .cerbAdmSidebarBrand {
            display: none;
          }
        }
      `}</style>

      <div className="cerbAdmShell">
        <aside className="cerbAdmSidebar">
          <button
            className={`cerbAdmNavBtn ${isActive("/admin") ? "isActive" : ""}`}
            title="Administración"
            onClick={() => navigate("/admin")}
          >
            <HomeIcon />
          </button>

          <button
            className={`cerbAdmNavBtn ${isActive("/admin/incidents") ? "isActive" : ""}`}
            title="Incidencias"
            onClick={() => navigate("/admin/incidents")}
          >
            <IncidentsIcon />
          </button>

          <button
            className={`cerbAdmNavBtn ${isActive("/admin/employees") ? "isActive" : ""}`}
            title="Empleados"
            onClick={() => navigate("/admin/employees")}
          >
            <EmployeesIcon />
          </button>

          <button
            className={`cerbAdmNavBtn ${isActive("/admin/exports") ? "isActive" : ""}`}
            title="Exportaciones"
            onClick={() => navigate("/admin/exports")}
          >
            <ExportsIcon />
          </button>

          <button
            className={`cerbAdmNavBtn ${isActive("/admin/settings") ? "isActive" : ""}`}
            title="Configuración"
            onClick={() => navigate("/admin/settings")}
          >
            <SettingsIcon />
          </button>

          <div className="cerbAdmSidebarSpacer" />

          <div className="cerbAdmSidebarBrand">
			  <img
				className="cerbAdmCerberoLogo"
				src={adminTheme.logos.secondary}
				alt="Cerbero"
			  />
			  <div className="cerbAdmVersion">DEMO</div>
		  </div>
        </aside>

        <main className="cerbAdmMain">
          <header className="cerbAdmHeader">
            <div className="cerbAdmHeaderText">
              <h1 className="cerbAdmHeaderTitle">{pageMeta.title}</h1>
              <p className="cerbAdmHeaderSubtitle">{pageMeta.subtitle}</p>
            </div>

            <div className="cerbAdmHeaderLogoWrap">
              <img
                className="cerbAdmSolventoLogo"
                src={adminTheme.logos.main}
                alt={adminTheme.brandName}
              />
            </div>
          </header>

          <div className="cerbAdmBody">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}