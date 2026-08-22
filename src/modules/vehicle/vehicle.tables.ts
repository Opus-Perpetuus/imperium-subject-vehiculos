import type { KirletTableDecl } from "@opus-perpetuus/imperium-core-kit";

export const vehicle_tables: KirletTableDecl[] = [
  {
    name: "vehicle",
    columns: [
      { name: "id", type: "text", primaryKey: true },
      { name: "name", type: "text", notNull: true },
      { name: "description", type: "text" },
      { name: "is_active", type: "boolean", notNull: true, default: true },
      { name: "state", type: "text" },
      { name: "ref", type: "text", unique: true },
      { name: "search_field", type: "text" },
      { name: "created_by", type: "text" },
      { name: "custom_data", type: "json" },
      { name: "payload", type: "json" },
      { name: "created_at", type: "text", notNull: true },
      { name: "updated_at", type: "text", notNull: true },
      { name: "foto", type: "text" },
      { name: "placas", type: "text" },
      { name: "numero_economico", type: "text" },
      { name: "marca", type: "text" },
      { name: "modelo", type: "text" },
      { name: "color", type: "text" },
      { name: "anio", type: "real" },
      { name: "capacidad_carga_kg", type: "real" },
      { name: "tipo_unidad", type: "text" },
      { name: "estado_operativo", type: "text" },
      { name: "chofer", type: "text" },
      { name: "chofer_nombre", type: "text" },
    ],
    indexes: [
      { name: "idx_vehicle_name", columns: ["name"] },
      { name: "idx_vehicle_active", columns: ["is_active"] },
    ],
  },
];
