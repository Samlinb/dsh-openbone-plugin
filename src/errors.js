export class Failure extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export function requireThat(condition, code, message, status) {
  if (!condition) throw new Failure(code, message, status);
}
export function object(value) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Expected an object.');
  return value;
}
export function fields(value, allowed, required = []) {
  object(value);
  requireThat(Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)), 'INVALID_INPUT', `Missing or unknown fields. Allowed: ${allowed.join(', ')||'(none)'}. Required: ${required.join(', ')||'(none)'}.`);
  return value;
}
export function id(value) {
  requireThat(typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100 && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:-|$)/i.test(value), 'INVALID_ID', 'Expected a stable lowercase identifier.');
  return value;
}
export function text(value, max = 1000) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= max, 'INVALID_INPUT', 'Expected bounded nonempty text.');
  return value;
}
