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
 *   CORE_URL  PORT  CORE_SUBJECT_GATEWAY_SECRET (maestro)  IMPERIUM_MODULAR_ROOT
 *   SUBJECT_AUTH=off SUBJECT_DEV_ADMIN=1  → admin sintético para curl directo a la app
 *
 * dev-attach e install-schemas van siempre con el maestro. La app arranca con el
 * secreto que el núcleo sabe verificar según su /health: `secret_mode: "strict"`
 * → su derivado; `compat` o sin `secret_mode` (núcleo 13.46.0 o anterior) → el
 * maestro, porque ese núcleo firma la identidad con él.
 */
import { createHmac } from "node:crypto";
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
const MASTER =
  process.env.CORE_SUBJECT_GATEWAY_SECRET ?? "imperium-subject-dev-secret";
// Misma fórmula que modular/core/src/imperium/subject-secret.ts.
const DERIVED = createHmac("sha256", MASTER)
  .update(`imperium-subject-gateway:v1:subject-${slug}`)
  .digest("hex");
const AUTH = process.env.SUBJECT_AUTH ?? "on";
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
  "tienda",
  "database-manager",
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

/** Cuerpo de /health, o null si respondió algo que no es JSON. */
async function wait_core(ms = 60_000): Promise<{ secret_mode?: unknown } | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const res = await fetch(`${CORE}/health`);
      if (res.ok) return await res.json().catch(() => null);
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

/** null = hecho; si no, el motivo. */
async function attach(url: string | null): Promise<string | null> {
  const res = await fetch(`${CORE}/api/subjects/dev-attach`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-core-subject-gateway-secret": MASTER,
    },
    body: JSON.stringify({ slug, url }),
  });
  if (res.ok) return null;
  const text = await res.text();
  // Sin CORE_SUBJECT_DEV_ATTACH=1 el núcleo responde como si la ruta no existiera.
  const hint =
    res.status === 404 && text.includes('"not found"')
      ? " (el núcleo necesita CORE_SUBJECT_DEV_ATTACH=1)"
      : "";
  return `dev-attach ${res.status}: ${text}${hint}`;
}

async function main() {
  if (!existsSync(join(ROOT, "node_modules"))) {
    console.log("subject-dev-local: bun install…");
    await sh(["bun", "install"]);
  }

  console.log(`subject-dev-local: ${slug} → :${PORT}  core ${CORE}`);
  const health = await wait_core();
  const mode = health?.secret_mode;
  let app_secret = MASTER;
  if (mode === "strict") {
    app_secret = DERIVED;
    console.log("subject-dev-local: núcleo en strict → secreto derivado");
  } else if (health === null) {
    app_secret = DERIVED;
    console.warn(
      `subject-dev-local: ${CORE}/health no devolvió JSON; arranco con el secreto derivado ` +
        "(si la app da 401/403, el núcleo no está en strict).",
    );
  } else {
    console.log(
      mode === "compat"
        ? "subject-dev-local: núcleo en compat → secreto maestro"
        : "subject-dev-local: el núcleo no anuncia secret_mode (13.46.0 o anterior) → secreto maestro",
    );
  }

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
        CORE_SUBJECT_GATEWAY_SECRET: app_secret,
        NOX_KIRLET_GATEWAY_SECRET: app_secret,
        SUBJECT_AUTH: AUTH,
        KIRLET_AUTH: AUTH,
      },
    },
  );

  // Si no llega a adjuntarse: sin esto la app queda huérfana en el puerto y el
  // contenedor del stack, parado.
  const abort = async (msg: string): Promise<never> => {
    console.error(`subject-dev-local: ${msg}`);
    child.kill("SIGTERM");
    if (compose_yml && core_is_docker) {
      await compose(compose_yml, ["start", `subject-${slug}`]);
    }
    process.exit(1);
  };

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
  if (!up) await abort("la app no levantó /health");

  const attached = await attach(public_url).catch((e) => String(e));
  if (attached) await abort(attached);
  const inst = await fetch(
    `${CORE}/api/subjects/install-schemas/subject-${slug}`,
    {
      method: "POST",
      headers: { "x-core-subject-gateway-secret": MASTER },
    },
  );
  console.log(
    `subject-dev-local: schema ${inst.status}  adjunto ${public_url}`,
  );
  // El núcleo responde 200 aunque no aplique el schema; el motivo va por app.
  const inst_data = (
    (await inst.json().catch(() => null)) as { data?: unknown } | null
  )?.data;
  const own = Array.isArray(inst_data)
    ? (inst_data as { id?: string; ok?: boolean; error?: string; status?: number }[])
        .find((r) => r?.id === `subject-${slug}`)
    : undefined;
  if (own?.ok === false) {
    console.warn(
      `subject-dev-local: AVISO: el núcleo no aplicó el schema: ${own.error ?? `su GET /schema a la app dio ${own.status}`}`,
    );
  }

  const cleanup = async () => {
    await attach(null).catch(() => null);
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
