// The app's own pages in the system language: main.js puts it in the
// address (?lang=de), strings.js (loaded before this) holds the words.
window.flowplanStrings.setLocale(new URLSearchParams(location.search).get("lang"));
window.flowplanStrings.apply(document);
