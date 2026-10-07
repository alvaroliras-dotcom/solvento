// Agrupa las incidencias por lo que significan, para que la portada y la
// bandeja no enseñen un unico numero grande (173) sin distinguir un olvido
// de fichaje de un aviso de ubicacion.

export type CategoriaClave =
  | "faltan"
  | "jornadas"
  | "ubicacion"
  | "tramo_cero"
  | "trabajador"
  | "otras";

export const CATEGORIAS: Array<{
  clave: CategoriaClave;
  etiqueta: string;
  ayuda: string;
}> = [
  {
    clave: "faltan",
    etiqueta: "Faltan fichajes",
    ayuda: "Falta o llega tarde una entrada, salida a comer, vuelta o salida final",
  },
  {
    clave: "jornadas",
    etiqueta: "Jornadas raras",
    ayuda: "Jornada abierta de otro día, demasiado larga, posible olvido de comida o tercer tramo",
  },
  {
    clave: "ubicacion",
    etiqueta: "Ubicación",
    ayuda: "Fichaje fuera del centro de trabajo o sin ubicación fiable",
  },
  {
    clave: "tramo_cero",
    etiqueta: "Tramos de duración cero",
    ayuda: "Entrada y salida casi a la vez, normalmente un fichaje de prueba o por error",
  },
  {
    clave: "trabajador",
    etiqueta: "Solicitudes del trabajador",
    ayuda: "Correcciones que ha pedido el propio trabajador",
  },
  { clave: "otras", etiqueta: "Otras", ayuda: "Sin clasificar" },
];

export function categoriaDeIncidencia(
  motivo: string | null | undefined,
  origen: "manual" | "automatic" | "time_request",
): CategoriaClave {
  if (origen === "manual") return "trabajador";

  const m = String(motivo ?? "");

  if (/^(missing|late)_.*_incident$/.test(m)) return "faltan";
  if (m === "zero_length_shift") return "tramo_cero";
  if (
    m === "open_entry_crossed_day" ||
    m === "open_entry_exceeded_hours" ||
    m === "possible_missed_lunch_checkout" ||
    m === "extra_daily_entry"
  ) {
    return "jornadas";
  }
  if (
    m === "check_in_outside_workplace" ||
    m === "check_out_outside_workplace" ||
    m === "outside_workplace_radius" ||
    m === "low_accuracy" ||
    m === "no_geolocation"
  ) {
    return "ubicacion";
  }

  // Una solicitud por tramos cuyo motivo es texto libre del trabajador.
  if (origen === "time_request") return "trabajador";
  return "otras";
}

export function etiquetaCategoria(clave: string): string {
  return CATEGORIAS.find((c) => c.clave === clave)?.etiqueta ?? "Otras";
}
