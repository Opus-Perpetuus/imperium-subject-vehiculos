import { KirletHttpError } from "@opus-perpetuus/imperium-core-kit";
import { es_error, normalizar_plantilla } from "../../control.ts";
import { definir_recurso } from "../../recurso.ts";

export const plantilla_revision_module = definir_recurso({
  resource: "plantilla-revision",
  table: "plantilla_revision",
  singular: "Plantilla de revisión",
  plural: "Plantillas de revisión",
  order: 20,
  subtitle: "Conceptos que una bitácora puede tomar sin volver a capturarlos",
  columns: [{ name: "items", type: "json" }],
  fields: {
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
      name: "items",
      component: "input-json",
      label: "Conceptos",
      help: "Lista de conceptos. Ejemplo: [{\"concepto\":\"Frenos\"}].",
    },
  ],
  hooks: {
    before_create(_ctx, row) {
      const items = normalizar_plantilla(row.items ?? []);
      if (es_error(items)) throw new KirletHttpError(400, "validation_error", items.error);
      row.items = items;
      return row;
    },
    before_update(_ctx, _id, patch) {
      if (!("items" in patch)) return patch;
      const items = normalizar_plantilla(patch.items);
      if (es_error(items)) throw new KirletHttpError(400, "validation_error", items.error);
      return { ...patch, items };
    },
  },
});
