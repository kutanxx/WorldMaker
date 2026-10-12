// The daily world — one shared seed per calendar day. Everyone whose date reads the same gets the
// same world. The day is the READER's: it was the UTC date once, and in Korea that offered
// yesterday's world until nine in the morning. The link names its date outright, so a shared daily
// opens the same world anywhere, whatever the clock where it is opened.
export function dailyName(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `daily-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

// map.html, because play.html does not exist: the games were deleted and this repo is the atlas
// now. `nameTargets` was moved across at the time and this was missed, so the front page shipped
// two buttons of which one led to a GitHub Pages 404.
export function dailyTarget(d: Date): string {
  return `map.html#seed=${dailyName(d)}`;
}
