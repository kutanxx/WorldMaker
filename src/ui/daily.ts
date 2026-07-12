// The daily world — one shared seed per UTC day (the Spelunky Daily pact). Everyone who clicks
// today gets the same world, so the per-seed legacy annals double as today's hall of fame.
export function dailyName(d: Date): string {
  return `daily-${d.toISOString().slice(0, 10)}`;
}

export function dailyTarget(d: Date): string {
  return `play.html#seed=${dailyName(d)}`;
}
