export function createStatusScheduler(
  settings: () => { callsign: string; status: string; statusInterval: string },
  send: () => Promise<void>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const schedule = (retry = false) => {
    clearTimeout(timer);
    const current = ++generation;
    const station = settings();
    const minutes = Number.parseInt(station.statusInterval, 10);
    if (!station.callsign || !station.status.trim() || ![30, 60, 120].includes(minutes)) return;
    timer = setTimeout(async () => {
      try {
        await send();
        if (generation === current) schedule();
      } catch (error) {
        console.error('Automatic status not sent:', error);
        if (generation === current) schedule(true);
      }
    }, retry ? 60_000 : minutes * 60_000);
    timer.unref();
  };
  return { schedule, dispose() { generation++; clearTimeout(timer); } };
}
