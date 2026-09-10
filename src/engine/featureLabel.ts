// A place name is a STRUCTURE, not a sentence. It used to be assembled into an English string at
// generation time — "the Bitter Jungle" — which bakes a decision about language into the world
// data, and it is why a Korean reader got an English map. The parts are kept instead and the
// sentence is built where it is read: the same lesson the chronicle learned on 2026-09-05.
export type FeaturePattern = "adj" | "of" | "attributive";

export interface FeatureLabel {
  pattern: FeaturePattern;
  kind: number;
  adj?: string;
  noun: string;
  proper?: string;
}

export function featureLabel(label: FeatureLabel, lang: "en" | "ko"): string {
  if (lang === "en") {
    if (label.pattern === "adj") return `the ${label.adj} ${label.noun}`;
    if (label.pattern === "of") return `${label.noun} of ${label.proper}`;
    // worldName's bare-nation branch has no noun ({noun: ""}) — the world is just "Sodend", not
    // "Sodend " with a trailing space, so the noun is only appended when there is one.
    return label.noun ? `${label.proper} ${label.noun}` : `${label.proper}`;
  }
  return featureLabel(label, "en");   // Korean arrives in Task 3
}
