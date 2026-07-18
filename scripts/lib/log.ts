export function step(message: string) {
  console.log(`\n▶ ${message}`);
}

export function info(message: string) {
  console.log(`  ${message}`);
}

export function success(message: string) {
  console.log(`  ✔ ${message}`);
}

export function warn(message: string) {
  console.warn(`  ⚠ ${message}`);
}

/** Prints Square API error details (they're nested under `errors`) instead of a bare stack trace. */
export function logSquareError(context: string, error: unknown) {
  const body = (error as { body?: { errors?: unknown } })?.body;
  if (body?.errors) {
    console.error(`✘ ${context}:`, JSON.stringify(body.errors, null, 2));
  } else {
    console.error(`✘ ${context}:`, error);
  }
}
