/**
 * Error raised when user input cannot be processed.
 *
 * The core modules are UI- and language-agnostic: instead of human-readable
 * messages they expose a stable `code` plus interpolation `params`, which the
 * UI layer translates into the active language.
 */
export class ValidationError extends Error {
  /**
   * @param {string} code   Translation key, e.g. "ipv4.invalidOctet".
   * @param {Record<string, string | number>} [params] Values interpolated into the message.
   */
  constructor(code, params = {}) {
    super(code);
    this.name = 'ValidationError';
    this.code = code;
    this.params = params;
  }
}
