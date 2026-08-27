export function readPrintConfig(env = process.env) {
  const enabled = env.AUTO_PRINT_ENABLED === "true";
  const printer = String(env.CUPS_PRINTER ?? "").trim();
  if (enabled && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}$/.test(printer)) {
    throw new Error("Automatic printing requires a valid CUPS_PRINTER queue name.");
  }
  return { enabled, printer, pollMs: 5000, maxAttempts: 3, retryMs: 30000 };
}

export const printConfig = readPrintConfig();
