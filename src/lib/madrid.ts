// ======================================================
// FECHAS Y HORAS SIEMPRE EN HORA DE MADRID
// ======================================================
// Antes las pantallas y los CSV formateaban con getHours() o
// toLocaleString() sin zona, es decir, con la zona del navegador
// de quien miraba. Un administrador con el portatil en otra zona
// (o un navegador mal configurado) veia y exportaba horas que no
// eran las del centro de trabajo. Ahora todo pasa por aqui y se
// formatea en Europe/Madrid, que es la hora legal del registro.

const ZONA_MADRID = "Europe/Madrid";

const formateadorPartes = new Intl.DateTimeFormat("es-ES", {
  timeZone: ZONA_MADRID,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type PartesMadrid = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

function partesMadrid(value: string | Date | null | undefined): PartesMadrid | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  const partes: Record<string, string> = {};
  for (const p of formateadorPartes.formatToParts(d)) {
    partes[p.type] = p.value;
  }

  // Algunos motores devuelven "24" para la medianoche aun con h23.
  const hour = partes.hour === "24" ? "00" : partes.hour;

  return {
    year: partes.year,
    month: partes.month,
    day: partes.day,
    hour,
    minute: partes.minute,
    second: partes.second,
  };
}

// "dd/mm/aaaa" en hora de Madrid. Cadena vacia si la fecha no es valida.
export function formatFechaMadrid(iso: string | Date | null | undefined) {
  const p = partesMadrid(iso);
  return p ? `${p.day}/${p.month}/${p.year}` : "";
}

// "HH:mm" en hora de Madrid. Cadena vacia si la fecha no es valida.
export function formatHoraMadrid(iso: string | Date | null | undefined) {
  const p = partesMadrid(iso);
  return p ? `${p.hour}:${p.minute}` : "";
}

// "dd/mm/aaaa HH:mm" en hora de Madrid. Cadena vacia si la fecha no es valida.
export function formatFechaHoraMadrid(iso: string | Date | null | undefined) {
  const p = partesMadrid(iso);
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : "";
}

// "AAAA-MM-DD" del dia de Madrid al que pertenece el instante.
// Sirve para agrupar fichajes por dia natural del centro de trabajo.
export function claveDiaMadrid(iso: string | Date | null | undefined) {
  const p = partesMadrid(iso);
  return p ? `${p.year}-${p.month}-${p.day}` : "";
}

// Desfase de Madrid respecto a UTC en minutos para ese instante
// (60 en invierno, 120 en verano).
export function desfaseMadridMinutos(instante: Date) {
  const p = partesMadrid(instante);
  if (!p) return 0;
  const comoUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  const real = Math.floor(instante.getTime() / 1000) * 1000;
  return Math.round((comoUtc - real) / 60000);
}

// Convierte una fecha y hora "de pared" de Madrid (AAAA-MM-DD, HH, mm)
// al instante real. Se recalcula el desfase sobre el resultado para
// acertar tambien en los dias de cambio de hora.
export function instanteDesdeMadrid(
  fecha: string,
  hora: number,
  minuto: number,
): Date | null {
  const [y, m, d] = fecha.split("-").map(Number);
  if (!y || !m || !d) return null;
  const comoUtc = Date.UTC(y, m - 1, d, hora, minuto, 0, 0);
  if (Number.isNaN(comoUtc)) return null;

  let instante = new Date(comoUtc - desfaseMadridMinutos(new Date(comoUtc)) * 60000);
  instante = new Date(comoUtc - desfaseMadridMinutos(instante) * 60000);
  return Number.isNaN(instante.getTime()) ? null : instante;
}

// ISO del inicio (00:00 de Madrid) del dia de hoy en Madrid.
export function inicioHoyMadridIso() {
  const hoy = claveDiaMadrid(new Date());
  return (instanteDesdeMadrid(hoy, 0, 0) ?? new Date()).toISOString();
}
