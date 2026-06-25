const PREFIX = "[youtube-digest]";

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export const log = {
  info: (service: string, msg: string) =>
    console.log(`${PREFIX} ${timestamp()} [${service}] ${msg}`),
  error: (service: string, msg: string, err?: unknown) =>
    console.error(`${PREFIX} ${timestamp()} [${service}] ERROR: ${msg}`, err ?? ""),
  warn: (service: string, msg: string) =>
    console.warn(`${PREFIX} ${timestamp()} [${service}] WARN: ${msg}`),
};
