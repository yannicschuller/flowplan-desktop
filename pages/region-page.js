// The screen region overlay (screen-capture.js, Windows and Linux): the
// screenshot of this screen, a region dragged with the mouse. Enter takes
// the whole screen, Esc cancels. Only the rectangle goes back; the picture
// stays in the main process, which crops it.
const desktop = window.flowplanDesktop;
const shot = document.getElementById("shot"),
  box = document.getElementById("box"),
  shade = document.getElementById("shade");
let start = null;
let done = false;
const finish = (rect) => {
  if (done) return;
  done = true;
  void desktop.region.done(rect);
};
desktop.region.onImage((url) => {
  if (typeof url === "string" && url.startsWith("data:image/")) shot.src = url;
});
function draw(a, b) {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  box.hidden = false;
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `${Math.abs(b.x - a.x)}px`;
  box.style.height = `${Math.abs(b.y - a.y)}px`;
  shade.classList.add("selecting");
}
document.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  start = { x: event.clientX, y: event.clientY };
  draw(start, start);
});
document.addEventListener("pointermove", (event) => start && draw(start, { x: event.clientX, y: event.clientY }));
document.addEventListener("pointerup", (event) => {
  if (!start) return;
  const end = { x: event.clientX, y: event.clientY };
  const rect = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  start = null;
  // A click is no region: start again.
  if (rect.width < 4 || rect.height < 4) {
    box.hidden = true;
    shade.classList.remove("selecting");
    return;
  }
  finish(rect);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") finish(null);
  if (event.key === "Enter") finish("all");
});
