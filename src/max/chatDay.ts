// 06:00 IST = 00:30 UTC. Independent of each device's configured timezone.
export const chatDay = (time: number) => Math.floor((time - 30 * 60_000) / 86_400_000);
export const chatExpired = (started: string, now = Date.now()) => {
  const timestamp = Date.parse(started);
  return !Number.isFinite(timestamp) || chatDay(timestamp) < chatDay(now);
};
