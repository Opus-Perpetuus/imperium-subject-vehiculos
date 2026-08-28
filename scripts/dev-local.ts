/**
 * Levanta ESTE app en desarrollo contra un núcleo v13 ya en marcha.
 *
 *   bun run local
 *
 * Instala deps, espera http://127.0.0.1:3100, para el contenedor Docker del
 * app (si el stack compose está up), registra la URL local en el núcleo,
 * instala el schema de esta app y arranca bun --watch.
 *
 * Requiere `yarn dev:modular-stack` (o el núcleo en :3100). Override:
 *   CORE_URL  PORT  CORE_SUBJECT_GATEWAY_SECRET  IMPERIUM_MODULAR_ROOT
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const ROOT = resolve(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  name?: string;
};
const slug = String(pkg.name ?? "")
  .replace(/^subject-/, "")
  .replace(/^imperium-subject-/, "");
if (!slug) {
  console.error("subject-dev-local: package.json.name no es subject-<slug>");
  process.exit(1);
}

const CORE = (process.env.CORE_URL ?? "http://127.0.0.1:3100").replace(
  /\/$/,
  "",
);
const SECRET =
  process.env.CORE_SUBJECT_GATEWAY_SECRET ?? "imperium-subject-dev-secret";
const CATALOG_ORDER = [
  "almacen",
  "configuraciones-de-vista",
  "configuracion",
  "control-hospitalario",
  "control-emergencias",
  "control-escolar",
  "control-municipal",
  "dispositivos-fisicos",
  "facturacion-electronica",
  "logistica",
  "pos",
  "pagos",
  "rh",
  "reportes",
  "planeacion",
  "tableros-dinamicos",
  "turnos",
  "vehiculos",
  "ventas",
];
const idx = CATALOG_ORDER.indexOf(slug);
const PORT = Number(
  process.env.PORT ?? (idx >= 0 ? 3201 + idx : 3299),
);

function find_compose(): string | null {
  const pinned = process.env.IMPERIUM_MODULAR_ROOT;
  if (pinned) {
    const yml = join(pinned, "docker-compose.yml");
    if (existsSync(yml)) return yml;
  }
  let dir = ROOT;
  for (let i = 0; i < 8; i++) {
    const yml = join(dir, "modular", "docker-compose.yml");
    if (existsSync(yml)) return yml;
    const here = join(dir, "docker-compose.yml");
    if (existsSync(here) && existsSync(join(dir, "catalog.json"))) return here;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function wait_core(ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const res = await fetch(`${CORE}/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await Bun.sleep(400);
  }
  console.error(
    `subject-dev-local: el núcleo no responde en ${CORE}/health.\n` +
      "Arranca antes: yarn dev:modular-stack",
  );
  process.exit(1);
}

async function sh(
  cmd: string[],
  opts: { cwd?: string; ok_fail?: boolean } = {},
): Promise<number> {
  const proc = spawn(cmd[0]!, cmd.slice(1), {
    cwd: opts.cwd ?? ROOT,
    stdio: "inherit",
  });
  const code: number = await new Promise((resolve_p) => {
    proc.on("exit", (c) => resolve_p(c ?? 1));
  });
  if (code !== 0 && !opts.ok_fail) {
    console.error(`subject-dev-local: falló ${cmd.join(" ")} (exit ${code})`);
    process.exit(code);
  }
  return code;
}

async function compose(
  compose_yml: string,
  args: string[],
  ok_fail = true,
) {
  return sh(
    ["docker", "compose", "-f", compose_yml, ...args],
    { ok_fail },
  );
}

async function attach(url: string | null) {
  const res = await fetch(`${CORE}/api/subjects/dev-attach`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-core-subject-gateway-secret": SECRET,
    },
    body: JSON.stringify({ slug, url }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`subject-dev-local: dev-attach ${res.status}: ${text}`);
    process.exit(1);
  }
}

async function main() {
  if (!existsSync(join(ROOT, "node_modules"))) {
    console.log("subject-dev-local: bun install…");
    await sh(["bun", "install"]);
  }

  console.log(`subject-dev-local: ${slug} → :${PORT}  core ${CORE}`);
  await wait_core();

  const compose_yml = find_compose();
  let core_is_docker = false;
  if (compose_yml) {
    const inspect = Bun.spawnSync(
      [
        "docker",
        "compose",
        "-f",
        compose_yml,
        "ps",
        "-q",
        "core",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    core_is_docker = inspect.exitCode === 0 && inspect.stdout.toString().trim().length > 0;
    if (core_is_docker) {
      console.log(`subject-dev-local: parando contenedor subject-${slug}`);
      await compose(compose_yml, ["stop", `subject-${slug}`]);
    }
  }

  const public_url = core_is_docker
    ? `http://host.docker.internal:${PORT}`
    : `http://127.0.0.1:${PORT}`;

  const child = spawn(
    "bun",
    ["--watch", "run", "src/server.ts"],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(PORT),
        SUBJECT_TECHNICAL_ID: `subject-${slug}`,
        KIRLET_TECHNICAL_ID: `subject-${slug}`,
        CORE_DATA_URL: CORE,
        NOX_DATA_URL: CORE,
        CORE_SUBJECT_GATEWAY_SECRET: SECRET,
        NOX_KIRLET_GATEWAY_SECRET: SECRET,
        SUBJECT_AUTH: "off",
        KIRLET_AUTH: "off",
      },
    },
  );

  const ready_t0 = Date.now();
  let up = false;
  while (Date.now() - ready_t0 < 20_000) {
    try {
      const h = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (h.ok) {
        up = true;
        break;
      }
    } catch {
      /* retry */
    }
    await Bun.sleep(200);
  }
  if (!up) {
    console.error("subject-dev-local: la app no levantó /health");
    child.kill("SIGTERM");
    process.exit(1);
  }

  await attach(public_url);
  const inst = await fetch(
    `${CORE}/api/subjects/install-schemas/subject-${slug}`,
    { method: "POST" },
  );
  console.log(
    `subject-dev-local: schema ${inst.status}  adjunto ${public_url}`,
  );

  const cleanup = async () => {
    try {
      await attach(null);
    } catch {
      /* ignore */
    }
    if (compose_yml && core_is_docker) {
      await compose(compose_yml, ["start", `subject-${slug}`]);
    }
    child.kill("SIGTERM");
  };
  process.on("SIGINT", () => {
    void cleanup().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void cleanup().then(() => process.exit(0));
  });

  const code: number = await new Promise((resolve_p) => {
    child.on("exit", (c) => resolve_p(c ?? 0));
  });
  await cleanup();
  process.exit(code);
}

await main();
