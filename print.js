// Printing the page of the window in front, and saving it as a PDF. Both
// use Chromium's print path, so Flowplan's print stylesheet (@media print:
// no sidebar, no toolbars) and its @page size apply. "Print…" shows the
// page as it will print in a preview window (Chromium's PDF viewer, whose
// print button opens the system's dialog); "Save as PDF…" asks where with
// the system's save dialog and writes webContents.printToPDF().
//
// The options and the file name are plain functions (test/features.mjs).
const path = require("node:path");

// Letter where it is the custom, A4 everywhere else.
const LETTER_REGIONS = ["US", "CA", "MX", "PH", "CL", "CO", "VE", "GT", "PR"];
function paperFor(locale = "") {
  const region = String(locale).split(/[-_]/)[1];
  return region && LETTER_REGIONS.includes(region.toUpperCase()) ? "Letter" : "A4";
}
function pdfOptions(locale) {
  return {
    pageSize: paperFor(locale),
    printBackground: true,
    // A size from the page's own @page rule wins.
    preferCSSPageSize: true,
    margins: { marginType: "default" },
    generateTaggedPDF: true,
    generateDocumentOutline: true,
  };
}
// The page's title as a file name: no characters file systems refuse.
function pdfFileName(title) {
  const base = String(title || "")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[ .]+|[ .]+$/g, "")
    .slice(0, 120)
    .trim();
  return `${base || "Flowplan"}.pdf`;
}

// "Print…": the page as it will print, in a preview window – Chromium's PDF
// viewer, whose toolbar prints (with the system's dialog) or downloads it.
// The PDF lives in a temporary file that goes with the window.
async function printPreview(window, { BrowserWindow, locale, title }) {
  const data = await window.webContents.printToPDF(pdfOptions(locale));
  const fsp = require("node:fs/promises");
  const dir = await fsp.mkdtemp(path.join(require("node:os").tmpdir(), "flowplan-print-"));
  const file = path.join(dir, pdfFileName(window.webContents.getTitle()));
  await fsp.writeFile(file, data);
  const bounds = window.getBounds();
  const preview = new BrowserWindow({
    parent: window,
    width: Math.min(900, bounds.width),
    height: Math.max(500, bounds.height - 60),
    title,
    autoHideMenuBar: true,
    webPreferences: { plugins: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // Only this file: links in the PDF open nowhere inside the preview.
  preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  preview.webContents.on("will-navigate", (event) => event.preventDefault());
  preview.on("closed", () => void fsp.rm(dir, { recursive: true, force: true }).catch(() => {}));
  await preview.loadFile(file);
  return preview;
}
// "Save as PDF…": the save dialog, then the file.
async function savePdf(window, { dialog, locale, title }) {
  const contents = window.webContents;
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title,
    defaultPath: pdfFileName(contents.getTitle()),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (canceled || !filePath) return null;
  const target = path.extname(filePath).toLowerCase() === ".pdf" ? filePath : `${filePath}.pdf`;
  const data = await contents.printToPDF(pdfOptions(locale));
  await require("node:fs/promises").writeFile(target, data);
  return target;
}

module.exports = { paperFor, pdfOptions, pdfFileName, printPreview, savePdf };
