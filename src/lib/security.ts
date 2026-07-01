/**
 * Security utilities for XSS prevention and data sanitization.
 */

/**
 * Escapes characters that can be used for script injection in JSON-LD or other
 * contexts where JSON is embedded in HTML.
 *
 * Note: We do NOT escape double quotes (") here because they are structural
 * delimiters in JSON. JSON.stringify already escapes double quotes INSIDE
 * string values as \".
 */
export function escapeJsonForHtml(jsonString: string): string {
  return jsonString
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/'/g, "\\u0027");
}
