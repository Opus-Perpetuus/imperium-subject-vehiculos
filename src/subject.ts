import { define_subject } from "@opus-perpetuus/imperium-core-kit";
import pkg from "../package.json" with { type: "json" };
import { vehicle_module } from "./modules/vehicle/vehicle.routes.ts";
import { seed_demo } from "./seed.ts";

export const SUBJECT = define_subject({
  id: "SUBJECT-vehiculos",
  name: "Vehículos",
  version: pkg.version,
  image: `ghcr.io/opus-perpetuus/subject-vehiculos:${pkg.version}`,
  compat: { nox: ">=0.5.0", kit: "^0.5.0" },
  schema_version: 1,
  menu_root: {
    id: "vehiculos.root",
    label: "Vehículos",
    order: 0,
  },
  modules: [vehicle_module],
  seed: seed_demo,
});

export const KIRLET = SUBJECT;
