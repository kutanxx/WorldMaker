// The daily world — one shared seed per UTC day (the Spelunky Daily pact). Everyone who clicks
// today gets the same world, so the per-seed legacy annals double as today's hall of fame.
export function dailyName(d: Date): string {
  return `daily-${d.toISOString().slice(0, 10)}`;
}

// map.html, because play.html does not exist: the games were deleted and this repo is the atlas
// now. `nameTargets` was moved across at the time and this was missed, so the front page shipped
// two buttons of which one led to a GitHub Pages 404.
export function dailyTarget(d: Date): string {
  return `map.html#seed=${dailyName(d)}`;
}
