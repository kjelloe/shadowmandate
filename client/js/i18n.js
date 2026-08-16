// client/js/i18n.js — every visible string comes from a catalog (S13).
let catalog = {};
let locale = "en";

export async function loadLocale(preferred) {
  locale = preferred ?? (navigator.language?.startsWith("no") ? "no" : "en");
  const res = await fetch(`i18n/${locale}.json`);
  catalog = await res.json();
  return locale;
}

// A missing key returns the key itself rather than blank: an untranslated
// string should be visibly wrong, not invisibly absent.
export function t(key, ...args) {
  const s = catalog[key];
  if (s === undefined) return key;
  return s.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)] ?? "");
}

export function applyStatic(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.getAttribute("data-i18n"));
  }
}
