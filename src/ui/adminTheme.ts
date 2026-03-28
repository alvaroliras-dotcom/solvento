import SolventoLogo from "../assets/LOGOTIPO-SOLVENTO-COLOR.svg";
import CerberoLogo from "../assets/LOGOTIPO-CERBERO.svg";

export const adminTheme = {
  brandName: "Solvento",

  logos: {
    main: SolventoLogo,
    secondary: CerberoLogo,
  },

  colors: {
    appBg: "#F5F5F5",
    pageBg: "#F5F5F5",

    panelBg: "#FFFFFF",
    cardBg: "#FFFFFF",
    panelSoft: "#F8F8F8",
    panelAlt: "#EFEFEF",

    text: "#111111",
    textSoft: "#555555",
    textMuted: "#888888",
    textOnPrimary: "#FFFFFF",

    border: "#D9D9D9",
    borderStrong: "#BFBFBF",

    primary: "#4bada9",
    primaryHover: "#3f9793",
    primarySoft: "#dff3f2",
    primaryBorder: "#4bada9",

    secondaryBg: "#F2F2F2",
    secondaryHover: "#E5E5E5",

    success: "#16A34A",
    successSoft: "#DCFCE7",

    warning: "#D97706",
    warningSoft: "#FEF3C7",

    danger: "#B42318",
    dangerHover: "#991B1B",
    dangerSoft: "#FEE4E2",

    info: "#0EA5E9",
    link: "#4bada9",
    overlay: "rgba(0, 0, 0, 0.35)",
  },

  radius: {
    sm: "10px",
    md: "12px",
    lg: "16px",
    xl: "20px",
    pill: "999px",
  },

  shadow: {
    sm: "0 6px 14px rgba(0, 0, 0, 0.06)",
    md: "0 12px 28px rgba(0, 0, 0, 0.08)",
    lg: "0 18px 40px rgba(0, 0, 0, 0.12)",
  },

  shadows: {
    sm: "0 6px 14px rgba(0, 0, 0, 0.06)",
    md: "0 12px 28px rgba(0, 0, 0, 0.08)",
    lg: "0 18px 40px rgba(0, 0, 0, 0.12)",
  },

  layout: {
    pagePadding: "16px",
    sectionGap: "12px",
    cardPadding: "16px",
    sidebarWidth: "170px",
    maxWidth: "1600px",
    headerHeight: "64px",
    controlHeight: "40px",
  },
} as const;