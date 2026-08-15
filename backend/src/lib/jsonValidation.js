/**
 * JSON schema validation utilities.
 * Validates parsed JSON objects against expected schemas to prevent
 * prototype pollution and type confusion attacks.
 */

/**
 * Check if an object has a dangerous prototype chain.
 * @param {any} obj - The object to check
 * @returns {boolean}
 */
export function hasDangerousPrototype(obj) {
  if (obj === null || typeof obj !== 'object') return false;
  return obj.__proto__ !== Object.prototype || obj.constructor !== Object;
}

/**
 * Deep clone an object, stripping dangerous prototype properties.
 * @param {any} obj - The object to clone
 * @returns {any}
 */
export function safeClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(safeClone);
  
  // Use Object.create(null) to avoid prototype pollution
  const clean = Object.create(null);
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    clean[key] = safeClone(obj[key]);
  }
  return clean;
}

/**
 * Validate that a value is a plain object (not null, not array, not polluted).
 * @param {any} value - The value to validate
 * @param {string} fieldName - Name of the field for error messages
 * @returns {{ ok: boolean, error?: string, sanitized?: object }}
 */
export function validatePlainObject(value, fieldName = 'object') {
  if (value === null || typeof value !== 'object') {
    return { ok: false, error: `${fieldName} must be an object` };
  }
  if (Array.isArray(value)) {
    return { ok: false, error: `${fieldName} must be an object, not an array` };
  }
  if (hasDangerousPrototype(value)) {
    return { ok: false, error: `${fieldName} has invalid prototype chain` };
  }
  return { ok: true, sanitized: safeClone(value) };
}

/**
 * Validate that a value is an array of plain objects.
 * @param {any} value - The value to validate
 * @param {string} fieldName - Name of the field for error messages
 * @returns {{ ok: boolean, error?: string, sanitized?: any[] }}
 */
export function validateObjectArray(value, fieldName = 'array') {
  if (!Array.isArray(value)) {
    return { ok: false, error: `${fieldName} must be an array` };
  }
  const sanitized = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `${fieldName}[${i}] must be an object` };
    }
    if (hasDangerousPrototype(item)) {
      return { ok: false, error: `${fieldName}[${i}] has invalid prototype chain` };
    }
    sanitized.push(safeClone(item));
  }
  return { ok: true, sanitized };
}

/**
 * Validate a layout JSON structure.
 * @param {any} layoutJson - The layout_json to validate
 * @returns {{ ok: boolean, error?: string, sanitized?: any }}
 */
export function validateLayoutJson(layoutJson) {
  if (!layoutJson || typeof layoutJson !== 'object') {
    return { ok: false, error: 'layout_json must be an object' };
  }

  const objResult = validatePlainObject(layoutJson.objects, 'layout_json.objects');
  if (!objResult.ok) {
    return objResult;
  }

  const obj = objResult.sanitized;
  const hasBag = obj.bag && typeof obj.bag === 'object' && !Array.isArray(obj.bag);
  const hasThreats = Array.isArray(obj.threats);
  const hasNonThreats = Array.isArray(obj['non-threats']);

  if (!hasBag && !hasThreats && !hasNonThreats) {
    return { ok: false, error: 'layout_json.objects must contain at least one of bag, threats, or non-threats' };
  }

  if (obj.threats && !Array.isArray(obj.threats)) {
    return { ok: false, error: 'layout_json.objects.threats must be an array' };
  }

  if (obj['non-threats'] && !Array.isArray(obj['non-threats'])) {
    return { ok: false, error: 'layout_json.objects.non-threats must be an array' };
  }

  return { ok: true, sanitized: { ...layoutJson, objects: obj } };
}
