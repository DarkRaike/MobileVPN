export function applySecurityHeaders(
  headers: Headers,
  isProduction: boolean,
): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=()",
  );
  headers.set("X-Permitted-Cross-Domain-Policies", "none");

  if (isProduction) {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
}
