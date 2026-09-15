#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# release.sh — sube la versión de una app (subject) por conventional commits.
#
# Fuente canónica: modular/scripts/subject-release.sh del monorepo. El
# generador (`generate_subjects.py`) lo copia a cada app como `scripts/release.sh`;
# no editar la copia de una app, se pisa en la siguiente instalación.
#
# Por qué existe: el workflow etiquetaba la imagen con la versión de
# `package.json`, y nadie subía esa versión. Veinte apps llevaban `0.1.0` desde
# que nacieron y cada push reescribía la MISMA etiqueta de GHCR. Con
# `pull_policy: if_not_present` en el compose, cualquier máquina que ya tuviera
# esa etiqueta en caché se quedaba con el build viejo sin decir nada.
#
# Reglas (las mismas que standard-version, que es lo que usa el monorepo):
#   feat                      → minor
#   fix | perf                → patch
#   BREAKING CHANGE | tipo!   → major, salvo en 0.x, donde es minor
#   solo chore/docs/style/... → nada que liberar
#
# Códigos de salida:
#   0  — se subió la versión; escribe la nueva en $GITHUB_OUTPUT si existe
#   78 — AVISO: no hay nada liberable. No es error: el llamador salta la imagen.
#   1  — error real (no es worktree, package.json ilegible, commit no convencional)
# ---------------------------------------------------------------------------
set -euo pipefail

readonly SKIP=78
readonly TIPOS='build|chore|ci|docs|feat|fix|merge|perf|refactor|revert|style|test'

die() { echo "release: $*" >&2; exit 1; }
aviso() { echo "release: $*" >&2; }

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "no es un worktree git"
[ -f package.json ] || die "sin package.json en $(pwd)"

# ── Rango de commits ───────────────────────────────────────────────────────
# Sin tag previo el rango es toda la historia: una app recién instalada no
# puede quedarse sin su primer release por no tener de dónde contar.
ultimo_tag="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)"
if [ -n "$ultimo_tag" ]; then
	rango="${ultimo_tag}..HEAD"
else
	rango="HEAD"
fi

mapfile -t asuntos < <(git log --no-merges --format='%s' "$rango" 2>/dev/null || true)
cuerpos="$(git log --no-merges --format='%B' "$rango" 2>/dev/null || true)"

if [ "${#asuntos[@]}" -eq 0 ]; then
	aviso "sin commits nuevos desde ${ultimo_tag:-el inicio}"
	exit "$SKIP"
fi

# ── Conventional commits ───────────────────────────────────────────────────
# Con un tag previo, la historia ya vive bajo esta regla y un asunto suelto es
# un error que hay que ver. Sin tag es la historia vieja de la app —escrita
# antes de que esto existiera— y rechazarla dejaría a las veinte apps sin poder
# liberar nunca: ahí solo se avisa.
no_convencionales=()
for asunto in "${asuntos[@]}"; do
	if ! printf '%s' "$asunto" | grep -Eq "^(${TIPOS})(\([^)]+\))?!?: .+"; then
		no_convencionales+=("$asunto")
	fi
done

if [ "${#no_convencionales[@]}" -gt 0 ]; then
	printf 'release: commit sin conventional commit:\n' >&2
	printf '  %s\n' "${no_convencionales[@]}" >&2
	if [ -n "$ultimo_tag" ]; then
		die "arregla el mensaje (git commit --amend) o etiqueta a mano"
	fi
	aviso "historia previa a esta regla; se ignoran para calcular la versión"
fi

# ── Qué bump toca ──────────────────────────────────────────────────────────
bump=""
for asunto in "${asuntos[@]}"; do
	if printf '%s' "$asunto" | grep -Eq "^(${TIPOS})(\([^)]+\))?!: "; then
		bump="major"
		break
	fi
done
if [ -z "$bump" ] && printf '%s' "$cuerpos" | grep -q "^BREAKING CHANGE"; then
	bump="major"
fi
if [ -z "$bump" ]; then
	for asunto in "${asuntos[@]}"; do
		if printf '%s' "$asunto" | grep -Eq "^feat(\([^)]+\))?: "; then
			bump="minor"
			break
		fi
	done
fi
if [ -z "$bump" ]; then
	for asunto in "${asuntos[@]}"; do
		if printf '%s' "$asunto" | grep -Eq "^(fix|perf)(\([^)]+\))?: "; then
			bump="patch"
			break
		fi
	done
fi

if [ -z "$bump" ]; then
	aviso "solo chore/docs/refactor desde ${ultimo_tag:-el inicio}: nada que liberar"
	exit "$SKIP"
fi

# ── Versión nueva ──────────────────────────────────────────────────────────
actual="$(node -p "require('./package.json').version" 2>/dev/null || true)"
[ -n "$actual" ] || die "package.json sin version legible"
printf '%s' "$actual" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
	|| die "version '$actual' no es semver limpia"

IFS='.' read -r ma mi pa <<<"$actual"

# En 0.x un cambio incompatible es minor, no major: la versión 1.0.0 la declara
# una persona, no un mensaje de commit. Es lo que hace standard-version.
if [ "$bump" = "major" ] && [ "$ma" -eq 0 ]; then
	bump="minor"
fi

case "$bump" in
	major) nueva="$((ma + 1)).0.0" ;;
	minor) nueva="${ma}.$((mi + 1)).0" ;;
	patch) nueva="${ma}.${mi}.$((pa + 1))" ;;
esac

# ── Escribir ───────────────────────────────────────────────────────────────
node -e "
const fs = require('node:fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.version = process.argv[1];
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
" "$nueva"

# El Dockerfile hace COPY de VERSION: si falta, la imagen no construye.
[ -f VERSION ] && printf '%s\n' "$nueva" > VERSION

# `manifest.json` está versionado y lleva dentro la versión y la etiqueta de la
# imagen (`src/subject.ts` las saca de package.json). Sin actualizarlo, la app
# publicaría un manifiesto que miente sobre su propia imagen.
#
# Se parchean los dos campos en vez de correr `manifest:emit`: emitirlo necesita
# bun y las dependencias instaladas, y el manifiesto entero se regeneraría —un
# cambio ajeno a subir la versión— en un paso que además puede fallar en CI.
if [ -f manifest.json ]; then
	node -e "
const fs = require('node:fs');
const nueva = process.argv[1];
const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
m.version = nueva;
if (typeof m.image === 'string' && m.image.includes(':')) {
	m.image = m.image.slice(0, m.image.lastIndexOf(':')) + ':' + nueva;
}
fs.writeFileSync('manifest.json', JSON.stringify(m, null, 2) + '\n');
" "$nueva"
fi

echo "release: $actual → $nueva ($bump)"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
	{
		echo "version=$nueva"
		echo "released=true"
	} >> "$GITHUB_OUTPUT"
fi
