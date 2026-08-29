// ======================================================
// DESCARGA COMPLETA POR BLOQUES
// ======================================================
// Supabase devuelve como máximo 1.000 filas por consulta y no
// avisa cuando corta: simplemente devuelve menos datos.
//
// Eso hacía que las exportaciones para inspección salieran
// incompletas en silencio en cuanto el rango era grande, y que
// los totales de horas de las pantallas salieran por debajo de
// los reales.
//
// Esta función repite la consulta en bloques de 1.000 hasta que
// no queda nada, y devuelve el resultado entero.

const TAMANO_BLOQUE = 1000;

// Tope de seguridad para no dejar el navegador colgado si algo
// va mal: 200.000 filas son más de 20 años de fichajes.
const MAXIMO_FILAS = 200000;

type Respuesta<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function fetchAllRows<T>(
  construirConsulta: (desde: number, hasta: number) => PromiseLike<Respuesta<T>>,
): Promise<{ data: T[]; error: { message: string } | null; truncado: boolean }> {
  const todas: T[] = [];
  let desde = 0;

  for (;;) {
    const { data, error } = await construirConsulta(
      desde,
      desde + TAMANO_BLOQUE - 1,
    );

    if (error) {
      return { data: todas, error, truncado: false };
    }

    const bloque = data ?? [];
    todas.push(...bloque);

    // Un bloque incompleto significa que ya no queda nada más.
    if (bloque.length < TAMANO_BLOQUE) {
      return { data: todas, error: null, truncado: false };
    }

    desde += TAMANO_BLOQUE;

    if (desde >= MAXIMO_FILAS) {
      return { data: todas, error: null, truncado: true };
    }
  }
}
