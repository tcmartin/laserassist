"use strict";

const SCRIPT_FIELDS = new Set([
  "title", "opening", "questions", "objection_guidance", "next_step",
]);
const CALL_FIELDS = new Set([
  "person_id", "pipeline_id", "event_id", "context_snapshot_id",
  "number_id", "caller_number_id", "script_template_id", "script_revision",
  "mode", "confirmed", "idempotency_key",
]);
const CRITERIA_FIELDS = new Set(["country", "area_code", "phone_number"]);
const ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
const REQUEST_ID_RE = /^request_[0-9a-f]{64}$/;
const CALL_ID_RE = /^call_[0-9a-f]{64}$/;
const MAX_MUTATION_BYTES = 64 * 1024;

function invalid(code = "calling_invalid_request") {
  throw new Error(code);
}

function object(value, code = "calling_invalid_payload") {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(code);
  return value;
}

function strictObject(value, fields) {
  const out = object(value);
  if (Object.keys(out).some((key) => !fields.has(key))) invalid("calling_unknown_field");
  return out;
}

function id(value, name = "id") {
  if (typeof value !== "string" || !ID_RE.test(value.trim())) invalid(`calling_invalid_${name}`);
  return value.trim();
}

function positiveInt(value, name) {
  if (!Number.isInteger(value) || value < 1) invalid(`calling_invalid_${name}`);
  return value;
}

function query(params) {
  const out = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") out.set(key, String(value));
  });
  const text = out.toString();
  return text ? `?${text}` : "";
}

function boundedMutation(value) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch (_) { invalid("calling_invalid_payload"); }
  if (Buffer.byteLength(encoded, "utf8") > MAX_MUTATION_BYTES) invalid("calling_payload_too_large");
  return value;
}

class CallingClient {
  constructor({ transport, getConfig }) {
    if (!transport || typeof transport._request !== "function" || typeof transport._headers !== "function") {
      throw new TypeError("calling_transport_required");
    }
    if (typeof getConfig !== "function") throw new TypeError("calling_config_required");
    this.transport = transport;
    this.getConfig = getConfig;
  }

  _identity() {
    const cfg = this.getConfig() || {};
    const backendUrl = String(cfg.backendUrl || "").trim().replace(/\/+$/, "");
    const tenantId = String(cfg.tenantId || "").trim();
    const jwtToken = String(cfg.jwtToken || "").trim();
    let protocol = "";
    try { protocol = new URL(backendUrl).protocol; } catch (_) { invalid("calling_auth_required"); }
    if (!backendUrl || !tenantId || !jwtToken || !["http:", "https:"].includes(protocol)) {
      invalid("calling_auth_required");
    }
    return { backendUrl, tenantId, jwtToken };
  }

  _sameIdentity(before, after) {
    return before.backendUrl === after.backendUrl
      && before.tenantId === after.tenantId
      && before.jwtToken === after.jwtToken;
  }

  async _request(path, { method = "GET", body } = {}) {
    const before = this._identity();
    const headers = this.transport._headers(body === undefined ? {} : { "Content-Type": "application/json" });
    const options = { method, headers };
    if (body !== undefined) options.body = JSON.stringify(body);
    const result = await this.transport._request(path, options);
    let after;
    try { after = this._identity(); } catch (_) { throw new Error("calling_stale_identity"); }
    if (!this._sameIdentity(before, after)) throw new Error("calling_stale_identity");
    return result;
  }

  getContext(params) {
    const input = strictObject(params, new Set(["personId", "pipelineId", "eventId"]));
    const values = {};
    for (const [key, name] of [["personId", "person_id"], ["pipelineId", "pipeline_id"], ["eventId", "event_id"]]) {
      if (input[key] !== undefined) values[name] = id(input[key], key);
    }
    if (!Object.keys(values).length) invalid("calling_contact_selection_required");
    return this._request(`/api/abm/intelli/call-context${query(values)}`);
  }

  searchPeople(params = {}) {
    const input = strictObject(params, new Set(['query', 'cursor']));
    if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 200)) invalid('calling_invalid_query');
    if (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 4096)) invalid('calling_invalid_cursor');
    return this._request(`/api/abm/people${query({ q: input.query, cursor: input.cursor, limit: 20 })}`);
  }

  listScripts(params = {}) {
    const input = strictObject(params, new Set(["limit", "cursor", "includeArchived"]));
    if (input.limit !== undefined) positiveInt(input.limit, "limit");
    if (input.limit !== undefined && input.limit > 100) invalid("calling_invalid_limit");
    if (input.cursor !== undefined && (typeof input.cursor !== "string" || input.cursor.length > 2048)) invalid("calling_invalid_cursor");
    if (input.includeArchived !== undefined && typeof input.includeArchived !== "boolean") invalid("calling_invalid_include_archived");
    return this._request(`/api/abm/intelli/scripts${query({
      limit: input.limit, cursor: input.cursor,
      include_archived: input.includeArchived === undefined ? undefined : String(input.includeArchived),
    })}`);
  }

  getScript(templateId, params = {}) {
    const input = strictObject(params, new Set(["revision"]));
    const template = id(templateId, "template_id");
    if (input.revision !== undefined) positiveInt(input.revision, "revision");
    return this._request(`/api/abm/intelli/scripts/${encodeURIComponent(template)}${query({ revision: input.revision })}`);
  }

  createScript(payload) {
    return this._request("/api/abm/intelli/scripts", {
      method: "POST", body: boundedMutation(strictObject(payload, SCRIPT_FIELDS)),
    });
  }

  updateScript(templateId, payload) {
    const input = strictObject(payload, new Set([...SCRIPT_FIELDS, "expected_revision"]));
    const template = id(templateId, "template_id");
    if (input.expected_revision === undefined) invalid("calling_expected_revision_required");
    positiveInt(input.expected_revision, "expected_revision");
    return this._request(`/api/abm/intelli/scripts/${encodeURIComponent(template)}`, {
      method: "PUT", body: boundedMutation(input),
    });
  }

  archiveScript(templateId, payload) {
    const input = strictObject(payload, new Set(["expected_revision"]));
    const template = id(templateId, "template_id");
    if (input.expected_revision === undefined) invalid("calling_expected_revision_required");
    positiveInt(input.expected_revision, "expected_revision");
    return this._request(`/api/abm/intelli/scripts/${encodeURIComponent(template)}/archive`, {
      method: "POST", body: boundedMutation(input),
    });
  }

  listNumbers(params = {}) {
    const input = strictObject(params, new Set(["cursor"]));
    if (input.cursor !== undefined && (typeof input.cursor !== "string" || input.cursor.length > 2048)) invalid("calling_invalid_cursor");
    return this._request(`/api/abm/intelli/numbers${query({ cursor: input.cursor })}`);
  }

  getNumberOptions() { return this._request("/api/abm/intelli/numbers/options"); }

  beginCheckout(payload) {
    const input = strictObject(payload, new Set(["criteria", "idempotency_key", "confirmed"]));
    if (input.confirmed !== true) invalid("calling_confirmation_required");
    if (typeof input.idempotency_key !== "string" || input.idempotency_key.trim().length < 1 || input.idempotency_key.length > 200) invalid("calling_invalid_idempotency_key");
    const criteria = strictObject(input.criteria || {}, CRITERIA_FIELDS);
    for (const [key, value] of Object.entries(criteria)) if (typeof value !== "string" || !value.trim() || value.length > 32) invalid(`calling_invalid_${key}`);
    return this._request("/api/abm/intelli/numbers/checkout", { method: "POST", body: boundedMutation({
      criteria, idempotency_key: input.idempotency_key.trim(), confirmed: true,
    }) });
  }

  getNumberRequest(requestId) {
    if (!REQUEST_ID_RE.test(String(requestId || ""))) invalid("calling_invalid_request_id");
    return this._request(`/api/abm/intelli/numbers/requests/${requestId}`);
  }

  reconcileNumber(requestId) {
    if (!REQUEST_ID_RE.test(String(requestId || ""))) invalid("calling_invalid_request_id");
    return this._request(`/api/abm/intelli/numbers/requests/${requestId}/reconcile`, { method: "POST", body: {} });
  }

  prepareCall(payload) {
    const input = strictObject(payload, CALL_FIELDS);
    if (input.confirmed !== true) invalid("calling_confirmation_required");
    for (const key of ["person_id", "pipeline_id", "event_id", "context_snapshot_id", "number_id", "caller_number_id", "script_template_id", "idempotency_key"]) {
      if (input[key] !== undefined) id(input[key], key);
    }
    if (input.mode !== "live" && input.mode !== "local_test") invalid("calling_invalid_mode");
    positiveInt(input.script_revision, "script_revision");
    return this._request("/api/abm/intelli/calls", { method: "POST", body: boundedMutation(input) });
  }

  getCall(callId) {
    if (!CALL_ID_RE.test(String(callId || ""))) invalid("calling_invalid_call_id");
    return this._request(`/api/abm/intelli/calls/${callId}`);
  }

  cancelCall(callId) {
    if (!CALL_ID_RE.test(String(callId || ""))) invalid("calling_invalid_call_id");
    return this._request(`/api/abm/intelli/calls/${callId}/cancel`, { method: "POST", body: {} });
  }
}

module.exports = { CallingClient };
