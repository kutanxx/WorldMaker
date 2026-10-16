// What every test file gets: a jsdom that lets go of the pages a test made.
//
// jsdom answers `querySelectorAll` through nwsapi, and nwsapi keeps, for every selector string it has ever
// compiled, the NODES of the first query it answered (`selectResolvers[selector].results`, nwsapi 2.2) —
// so a page a test threw away stayed whole in the document's selector cache, hung from a button a selector
// once found, until the same selector ran on another page. app.test.ts opens 96 pages, each with its own
// world, and the file's worker died of memory on CI with no failed test (2026-10-16; the heap snapshot:
// Window._document → DocumentImpl._nwsapi → selectResolvers → "button" → results → the page). After each
// test the two caches are emptied: the selectors compile again on their next use, which is cheap.
import { afterEach } from "vitest";

afterEach(() => {
  if (typeof document === "undefined") return;
  const impl = Object.getOwnPropertySymbols(document).map((s) => (document as unknown as Record<symbol, unknown>)[s]).find((v) => v && typeof v === "object" && "_nwsapi" in (v as object)) as
    { _nwsapi?: Caches; _nwsapiDontThrow?: Caches } | undefined;
  for (const api of [impl?._nwsapi, impl?._nwsapiDontThrow]) {
    if (!api) continue;
    for (const k of Object.keys(api.selectResolvers)) delete api.selectResolvers[k];
    for (const k of Object.keys(api.matchResolvers)) delete api.matchResolvers[k];
  }
});

interface Caches { selectResolvers: Record<string, unknown>; matchResolvers: Record<string, unknown> }
