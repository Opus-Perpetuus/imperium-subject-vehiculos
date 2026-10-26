import { define_subject } from "@opus-perpetuus/imperium-core-kit";
import pkg from "../package.json" with { type: "json" };
import { carga_combustible_module } from "./modules/carga-combustible/carga-combustible.routes.ts";
import { bitacora_module } from "./modules/bitacora/bitacora.routes.ts";
import { envio_revision_module } from "./modules/envio-revision/envio-revision.routes.ts";
import { documento_vehiculo_module } from "./modules/documento-vehiculo/documento-vehiculo.routes.ts";
import { falla_module } from "./modules/falla/falla.routes.ts";
import { lectura_uso_module } from "./modules/lectura-uso/lectura-uso.routes.ts";
import { mantenimiento_correctivo_module } from "./modules/mantenimiento-correctivo/mantenimiento-correctivo.routes.ts";
import { mantenimiento_preventivo_module } from "./modules/mantenimiento-preventivo/mantenimiento-preventivo.routes.ts";
import { plantilla_revision_module } from "./modules/plantilla-revision/plantilla-revision.routes.ts";
import { servicio_programado_module } from "./modules/servicio-programado/servicio-programado.routes.ts";
import { vehicle_module } from "./modules/vehicle/vehicle.routes.ts";
import { seed_demo } from "./seed.ts";

export const SUBJECT = define_subject({
  id: "SUBJECT-vehiculos",
  name: "Vehículos",
  version: pkg.version,
  image: `ghcr.io/opus-perpetuus/subject-vehiculos:${pkg.version}`,
  compat: { nox: ">=0.5.0", kit: "^0.5.0" },
  schema_version: 3,
  public: true,
  menu_root: {
    id: "vehiculos.root",
    label: "Vehículos",
    order: 0,
  },
  modules: [
    vehicle_module,
    plantilla_revision_module,
    bitacora_module,
    envio_revision_module,
    falla_module,
    mantenimiento_correctivo_module,
    mantenimiento_preventivo_module,
    servicio_programado_module,
    lectura_uso_module,
    carga_combustible_module,
    documento_vehiculo_module,
  ],
  seed: seed_demo,
});

export const KIRLET = SUBJECT;
