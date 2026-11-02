import { describe, expect, test } from "bun:test";
import { field_name_denied } from "./field-values-rule.js";
import { field_values_denied } from "./define-crud.js";

describe("field_name_denied: credenciales, PII y blobs; no metadatos", () => {
  test("credenciales siguen negadas (también camelCase)", () => {
    for (const f of [
      "password", "reset_password_token_hash", "pin_hash", "pin", "pin_code", "api_key", "apiKey",
      "clientSecret", "accessToken", "token_value", "smtp_pass", "secretKey", "private_key", "credentials",
    ]) expect([f, field_name_denied(f)]).toEqual([f, true]);
  });

  test("metadatos y hashes de contenido NO se niegan", () => {
    for (const f of [
      "pin_type", "pin_length", "pin_version", "token_type", "reset_password_kind", "reset_password_expires",
      "html_element_hash", "foto_hash", "hash", "event_type", "domicilio_id", "whatsapp_activo",
      "tokenizer_model", "firmado_at", "pinned", "passport_no", "nssa", "clientName", "estado", "banco",
      "ubicacion", "ubicacion_destino", "cuenta_contable", "direccionamiento",
    ]) expect([f, field_name_denied(f)]).toEqual([f, false]);
  });

  test("PII: fiscal, firmas, contacto, domicilio, nacimiento, salario, cuenta, coordenadas", () => {
    for (const f of [
      "rfc", "receptor_rfc", "emisorRfc", "proveedor_rfc", "curp", "nss", "clabe",
      "firma", "firma_digital", "firmaDigital", "nombre_medico_firma", "withdrawalSignature", "img_signature_owner",
      "email", "customer_email", "citizenEmail", "correo", "email_contacto",
      "telefono", "telefono_paciente", "citizen_phone", "celular", "alertante_telefono",
      "domicilio_completo", "pedido_contacto_domicilio", "direccion", "direccion_exacta", "delivery_address_coordinates",
      "fecha_nacimiento", "birthdate", "salario_diario", "salary",
      "cuenta", "numero_cuenta", "bank_account",
      "lat", "lng", "lon", "latitude", "longitud", "coordinates",
    ]) expect([f, field_name_denied(f)]).toEqual([f, true]);
  });

  test("blobs json por nombre", () => {
    for (const f of ["config_json", "custom_data", "payload", "spec_json", "images_json", "attributesJson"]) {
      expect([f, field_name_denied(f)]).toEqual([f, true]);
    }
  });

  test("define_crud: field_values:true abre; secret y list:false niegan", () => {
    expect(field_values_denied("email", { type: "string", field_values: true })).toBe(false);
    expect(field_values_denied("receptor_rfc", { type: "string", field_values: true })).toBe(false);
    expect(field_values_denied("pin_type", { type: "string" })).toBe(false);
    expect(field_values_denied("pin_type", { type: "string", secret: true })).toBe(true);
    expect(field_values_denied("foto", { type: "string", list: false })).toBe(true);
  });
});
