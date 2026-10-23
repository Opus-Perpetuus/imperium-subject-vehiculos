// Búsqueda, orden y páginas para listados que no salen directo de una tabla.
type Fila = Record<string, unknown>;

export type ConsultaLista = { q?: string; take: number; skip: number; sort?: string };

function plano(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function comparar(a: unknown, b: unknown): number {
  if (a == null || a === "") return b == null || b === "" ? 0 : 1;
  if (b == null || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "es", { numeric: true });
}

/**
 * Filtra por `q` (sin acentos, en cualquier texto de la fila), ordena por
 * `campo:asc|desc` si se pide y corta la página. Sin orden pedido respeta el
 * que ya traen las filas. Los vacíos van al final.
 */
export function paginar<T extends Fila>(
  filas: readonly T[],
  consulta: ConsultaLista,
): { data: T[]; total_elementos: number } {
  const q = consulta.q ? plano(consulta.q) : "";
  let lista = q
    ? filas.filter((fila) =>
        Object.values(fila).some(
          (value) => (typeof value === "string" || typeof value === "number") && plano(value).includes(q),
        ),
      )
    : [...filas];
  const orden = /^([a-zA-Z_][a-zA-Z0-9_]*):(asc|desc)$/.exec(consulta.sort ?? "");
  if (orden) {
    const [, campo, dir] = orden;
    const signo = dir === "desc" ? -1 : 1;
    lista = lista
      .map((fila, indice) => ({ fila, indice }))
      .sort((a, b) => {
        const va = a.fila[campo!];
        const vb = b.fila[campo!];
        const vacio_a = va == null || va === "";
        const vacio_b = vb == null || vb === "";
        if (vacio_a || vacio_b) return comparar(va, vb) || a.indice - b.indice;
        return signo * comparar(va, vb) || a.indice - b.indice;
      })
      .map(({ fila }) => fila);
  }
  return {
    data: lista.slice(consulta.skip, consulta.skip + consulta.take),
    total_elementos: lista.length,
  };
}

const PARAMETROS_LISTA = ["q", "termino", "take", "limite", "skip", "desde", "sort", "campoSort"];

/** Sin parámetros de lista se devuelve todo, como antes de paginar. */
export function pide_pagina(query: URLSearchParams): boolean {
  return PARAMETROS_LISTA.some((nombre) => query.has(nombre));
}
