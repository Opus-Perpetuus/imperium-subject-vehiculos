//   #region FIELD-VALUES: nombres que no se listan
//
// Una sola regla para el kit (define_crud) y el núcleo (CRUD y tracker global):
// `GET …/field-values/<campo>` devuelve los valores distintos de una columna a
// cualquiera con lectura del recurso. Credenciales, PII y blobs no salen por
// ahí; el filtro de esa columna en la lista pasa a texto libre (`fv_denied`).

/** `clientSecret` → `client_secret`; `APIKey` → `api_key`. */
export function snake_field_name(field: string): string {
  return field
    .trim()
    .replace(/([A-Z]+)([A-Z][a-z0-9])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

/** Credenciales: el valor mismo es el secreto. */
const CREDENTIAL_WORDS = [
  "password", "passwd", "pwd", "pass", "secret", "secrets", "token", "tokens",
  "api_key", "apikey", "private_key", "secret_key", "credential", "credentials", "pin",
];

/** PII: identificadores fiscales y bancarios, firmas, contacto, domicilio, nacimiento, salario, coordenadas. */
const PII_WORDS = [
  "rfc", "curp", "nss", "clabe", "firma", "firmas", "signature", "signatures",
  "email", "emails", "e_mail", "correo", "phone", "telefono", "celular", "movil", "mobile",
  "domicilio", "direccion", "address",
  "nacimiento", "birth", "birthday", "birthdate", "dob",
  "salario", "salary", "sueldo",
  "lat", "lng", "lon", "latitude", "longitude", "latitud", "longitud",
  "coords", "coordinates", "coordenadas",
];

/** Cuenta bancaria: solo nombres completos (`cuenta` sola es ambigua en contabilidad). */
const WHOLE_NAMES = new Set([
  "cuenta", "cuenta_bancaria", "numero_cuenta", "no_cuenta", "num_cuenta",
  "bank_account", "account_number",
]);

/**
 * Último segmento que describe al dato sin ser el dato: `pin_type`,
 * `token_type`, `pin_length`, `reset_password_kind`, `domicilio_id`,
 * `whatsapp_activo`. `token_value` y `pin_hash` no entran: son el secreto.
 */
const METADATA_SUFFIXES = new Set([
  "type", "types", "kind", "length", "len", "version", "count", "format", "mode",
  "id", "ids", "ref", "activo", "active", "enabled", "required", "expires", "at",
]);

/** Blobs json por nombre: configuración con credenciales o documentos enteros. */
export const JSON_BLOB_FIELDS: ReadonlySet<string> = new Set(["config_json", "custom_data", "payload", "spec_json"]);

function word_re(words: readonly string[]): RegExp {
  return new RegExp(`(^|_)(${words.join("|")})(_|$)`);
}
const CREDENTIAL_RE = word_re(CREDENTIAL_WORDS);
const PII_RE = word_re(PII_WORDS);

/** Un segmento (sin puntos) que por su nombre no admite field-values. */
export function field_name_denied(field: string): boolean {
  const snake = snake_field_name(field);
  if (!snake) return false;
  if (JSON_BLOB_FIELDS.has(snake) || snake.endsWith("_json")) return true;
  if (WHOLE_NAMES.has(snake)) return true;
  const parts = snake.split("_").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  if (parts.length > 1 && METADATA_SUFFIXES.has(last)) return false;
  return CREDENTIAL_RE.test(snake) || PII_RE.test(snake);
}
//   #endregion
