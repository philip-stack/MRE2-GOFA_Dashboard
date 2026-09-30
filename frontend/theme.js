/**
 * Shared light/dark theme switch for the dashboard and the HMI.
 *
 * Loaded without defer in <head> so data-theme is set before the first paint and
 * the page does not flash dark before switching to light. Dark stays the
 * default; the choice is remembered per browser.
 */
(function () {
  const STORAGE_KEY = "sman-theme";
  const THEMES = ["dark", "light"];
  const root = document.documentElement;
  const listeners = new Set();

  function storedTheme() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (THEMES.includes(stored)) return stored;
    } catch {
      // Storage can be blocked; dark stays the default.
    }
    return "dark";
  }

  let theme = storedTheme();
  root.dataset.theme = theme;

  function updateToggles() {
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-pressed", String(theme === "light"));
    });
  }

  function setTheme(next) {
    if (!THEMES.includes(next) || next === theme) return;
    theme = next;
    root.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Without storage the choice only lasts for this page view.
    }
    updateToggles();
    listeners.forEach((listener) => listener(theme));
  }

  window.uiTheme = {
    setTheme,
    onChange(listener) {
      listeners.add(listener);
    },
    get theme() {
      return theme;
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => setTheme(theme === "light" ? "dark" : "light"));
    });
    updateToggles();
  });
})();
