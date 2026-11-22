// The picture between two profiles (switch-cover.js): the target profile's
// name on the app's background. Its words come in the address (the page has
// no bridge); #out fades it away.
const params = new URLSearchParams(location.search);
document.documentElement.lang = params.get("lang") === "zh" ? "zh-Hans" : params.get("lang") || "en";
document.getElementById("name").textContent = params.get("name") || "";
document.getElementById("text").textContent = params.get("text") || "";
document.title = params.get("text") || "Flowplan";
document.body.classList.add(params.get("phase") === "in" ? "in" : "cover");
const leave = () => {
  if (location.hash === "#out") document.body.classList.add("out");
};
leave();
window.addEventListener("hashchange", leave);
