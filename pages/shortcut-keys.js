// A pressed key combination as an Electron accelerator (settings, the
// setup step): the key with at least one modifier, Shift alone is none.
(function () {
  const KEYS = { Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Backquote: "`" };
  function acceleratorOf(event, mac) {
    let key = null;
    if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
    else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code;
    else key = KEYS[event.code] || null;
    if (!key) return null;
    const mods = [];
    if (mac ? event.metaKey : event.ctrlKey) mods.push("CommandOrControl");
    if (mac && event.ctrlKey) mods.push("Control");
    if (!mac && event.metaKey) mods.push("Super");
    if (event.altKey) mods.push("Alt");
    if (event.shiftKey) mods.push("Shift");
    if (!mods.length || (mods.length === 1 && mods[0] === "Shift")) return null;
    return [...mods, key].join("+");
  }
  window.flowplanShortcut = { acceleratorOf };
})();
