export function createShellyQueueIndicator({ host, hasOpenTickets, request = fetch, logger = console }) {
  let timer;
  let running = false;
  let failed = false;
  const relay = host ? new URL('http://' + host + '/relay/0') : null;

  async function read(url) {
    const response = await request(url, { signal: AbortSignal.timeout(2000), redirect: "error" });
    if (!response.ok) throw new Error("Shelly request failed");
    return (await response.json()).ison;
  }

  async function sync() {
    if (!relay || running) return;
    running = true;
    try {
      const actual = await read(relay);
      if (typeof actual !== "boolean") throw new Error("Invalid relay status");
      const desired = hasOpenTickets();
      if (actual !== desired) {
        const command = new URL(relay);
        command.searchParams.set("turn", desired ? "on" : "off");
        if (await read(command) !== desired) throw new Error("Relay did not reach requested state");
      }
      if (failed) logger.info("Shelly queue indicator reconnected.");
      failed = false;
    } catch {
      if (!failed) logger.warn("Shelly queue indicator unavailable; will retry.");
      failed = true;
    } finally {
      running = false;
    }
  }

  return {
    sync,
    start() {
      if (!relay || timer) return;
      void sync();
      timer = setInterval(sync, 5000);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
