import { KirletHttpError } from "@opus-perpetuus/imperium-core-kit";
import { conceptos_capturados, es_error, texto_de_conceptos } from "../../control.ts";
import { definir_recurso } from "../../recurso.ts";

function aplicar_conceptos(row: Record<string, unknown>, base?: Record<string, unknown>) {
  const texto = typeof row.conceptos === "string" ? row.conceptos : null;
  const fuente = texto != null && texto.trim()
    ? texto
    : "items" in row
      ? row.items
      : base?.items ?? [];
  const items = conceptos_capturados(fuente);
  if (es_error(items)) throw new KirletHttpError(400, "validation_error", items.error);
  row.items = items;
  row.conceptos = texto_de_conceptos(items);
  return row;
}

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
    {
      name: "conceptos",
      component: "input-textarea",
      label: "Conceptos",
      required: true,
      column_span: "full",
      help: "Un concepto por línea. Por ejemplo: Frenos",
    },
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
