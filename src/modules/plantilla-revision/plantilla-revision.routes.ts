import {
  KirletHttpError,
  type FeatureShellFieldDescriptor,
} from "@opus-perpetuus/imperium-core-kit";
import { es_error, normalizar_plantilla, texto_de_conceptos } from "../../control.ts";
import { definir_recurso } from "../../recurso.ts";

function aplicar_conceptos(row: Record<string, unknown>, base?: Record<string, unknown>) {
  const texto = typeof row.conceptos === "string" ? row.conceptos : null;
  const fuente = texto != null && texto.trim()
    ? texto
    : "items" in row
      ? row.items
      : base?.items ?? [];
  const items = normalizar_plantilla(fuente);
  if (es_error(items)) throw new KirletHttpError(400, "validation_error", items.error);
  row.items = items;
  row.conceptos = texto_de_conceptos(items);
  return row;
}

const PARTIDAS = {
  name: "items",
  component: "input-hidden",
  label: "Partidas",
  column_span: "full",
  help: "Agrega cada concepto. En cada partida puedes cambiar las opciones y cuál queda preseleccionada.",
  partidas: "plantilla",
} as FeatureShellFieldDescriptor;

export const plantilla_revision_module = definir_recurso({
  resource: "plantilla-revision",
  table: "plantilla_revision",
  singular: "Plantilla de revisión",
  plural: "Plantillas de revisión",
  order: 20,
  subtitle: "Conceptos que una bitácora puede tomar sin volver a capturarlos",
  columns: [
    { name: "conceptos", type: "text" },
    { name: "items", type: "json" },
  ],
  fields: {
    conceptos: { type: "string", search: true },
    items: { type: "json" },
  },
  list: [
    { key: "name", label: "Nombre" },
    { key: "description", label: "Descripción" },
  ],
  form: [
    { name: "name", component: "input-text", label: "Nombre", required: true },
    { name: "description", component: "input-textarea", label: "Descripción" },
    PARTIDAS,
  ],
  hooks: {
    before_create(_ctx, row) {
      return aplicar_conceptos(row);
    },
    before_update(_ctx, _id, patch, existing) {
      if (!("conceptos" in patch) && !("items" in patch)) return patch;
      return aplicar_conceptos(patch, existing);
    },
  },
});
