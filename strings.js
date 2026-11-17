// The app's own words in German, English, French and Simplified Chinese,
// chosen by the system language (app.getLocale(); English when the language is
// another one). The words live in locales/<language>.json (one flat
// { "area.key": "text" } catalogue per language; German is written first,
// English is what translations start from, translate.flowplan.org edits
// them). Used by the main process (require, which reads the catalogues) and
// by the app's own pages (<script>), which get the language in their address
// (?lang=de) and the catalogues from the preload (window.flowplanDesktop
// .strings, asked from main.js once before the page runs: the sandboxed
// pages cannot read files themselves).
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory({
      de: require("./locales/de.json"),
      en: require("./locales/en.json"),
      fr: require("./locales/fr.json"),
      zh: require("./locales/zh.json"),
    });
  else root.flowplanStrings = factory((root.flowplanDesktop && root.flowplanDesktop.strings) || {});
})(typeof self !== "undefined" ? self : this, function (catalogues) {
  const LOCALES = ["de", "en", "fr", "zh"];
  const FALLBACK = "en";
  // Chinese written in Traditional characters (Taiwan, Hong Kong, Macau) gets
  // English rather than Simplified characters it does not read as its own.
  const TRADITIONAL = ["hant", "tw", "hk", "mo"];
  // "de-CH", "fr_CA", "en-US" → "de", "fr", "en"; "zh", "zh-CN", "zh-Hans",
  // "zh-SG" → "zh"; "zh-TW", "zh-HK", "zh-Hant" and anything else → "en".
  function pickLocale(value) {
    const [short, ...rest] = String(value || "")
      .toLowerCase()
      .split(/[-_]/);
    if (short === "zh" && rest.some((part) => TRADITIONAL.includes(part)) && !rest.includes("hans")) return FALLBACK;
    return LOCALES.includes(short) ? short : FALLBACK;
  }
  // The language tag for <html lang> and Intl: "zh-Hans" so Chromium picks
  // Simplified Chinese glyphs and formats.
  const tagOf = (locale) => (locale === "zh" ? "zh-Hans" : locale);
  // The language the instance's shorthand parser knows (de, en, fr): Chinese
  // shorthand is read the English way ("tomorrow 3pm", month/day like 3/15).
  const serverLocale = (locale) => (["de", "en", "fr"].includes(locale) ? locale : FALLBACK);
  // The catalogues as one table, key → [de, en, fr, zh], in English's order.
  // A text that is missing or empty in a catalogue is "" here, and t() takes
  // the English one instead.
  const catalogue = (lang) => (catalogues && typeof catalogues[lang] === "object" && catalogues[lang]) || {};
  const STRINGS = {};
  for (const key of Object.keys(catalogue(FALLBACK)))
    STRINGS[key] = LOCALES.map((lang) => {
      const text = catalogue(lang)[key];
      return typeof text === "string" ? text : "";
    });

  let current = FALLBACK;
  function setLocale(value) {
    current = pickLocale(value);
    return current;
  }
  const locale = () => current;
  function format(template, args) {
    return template.replace(/\{(\d+)\}/g, (match, index) => (index < args.length ? String(args[index]) : match));
  }
  // t("updates.available", "1.2.3") in the current language; a missing key
  // comes back as the key so a typo shows instead of hiding.
  function t(key, ...args) {
    const entry = Object.prototype.hasOwnProperty.call(STRINGS, key) ? STRINGS[key] : null;
    if (!entry) return key;
    const text = entry[LOCALES.indexOf(current)] || entry[LOCALES.indexOf(FALLBACK)];
    return format(text, args);
  }
  // Fills a document: data-i18n (text), data-i18n-placeholder, and the title.
  function apply(doc) {
    doc.documentElement.lang = tagOf(current);
    for (const node of doc.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
    for (const node of doc.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = t(node.dataset.i18nPlaceholder);
    const title = doc.querySelector("title[data-i18n-title]");
    if (title) doc.title = t(title.dataset.i18nTitle);
  }
  return { LOCALES, STRINGS, CATALOGUES: catalogues, pickLocale, setLocale, locale, tagOf, serverLocale, t, apply };
});
