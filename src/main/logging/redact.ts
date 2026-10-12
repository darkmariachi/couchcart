const REDACTED = '[redacted]';

const PATTERNS: [RegExp, string][] = [
  // Authorization header values
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`],
  // Anything shaped like a JWT, wherever it appears
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, REDACTED],
  // key=value and "key": "value" pairs with a sensitive key
  [
    /("?(?:password|passwd|access_token|refresh_token|raw_token|client_secret|token)"?\s*[=:]\s*)("[^"]*"|[^\s&,;}]+)/gi,
    `$1${REDACTED}`,
  ],
];

/** Scrubs credentials from text on its way to a log. */
export function redact(text: string): string {
  return PATTERNS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );
}
