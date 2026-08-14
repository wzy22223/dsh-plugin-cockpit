try {
  const stored = window.localStorage.getItem("cockpit.theme");
  const mode = stored === "light" || stored === "dark" ? stored : "system";
  const dark = mode === "dark"
    || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "cockpit-dark" : "cockpit";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = "cockpit";
  document.documentElement.style.colorScheme = "light";
}
