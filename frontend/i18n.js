/**
 * Shared German/English UI translation for the dashboard and the HMI.
 *
 * German is the source language: its strings are the dictionary keys, so markup
 * and code stay readable and anything without an entry simply stays German.
 * Static markup is translated by walking text nodes and a few attributes;
 * JavaScript renders dynamic text through t(). Data from the backend (event
 * titles, mail subjects, error details) is not translated.
 */
(function () {
  const STORAGE_KEY = "sman-lang";
  const LANGUAGES = ["de", "en"];
  const LOCALES = { de: "de-DE", en: "en-GB" };
  const ATTRIBUTES = ["placeholder", "aria-label", "title", "alt"];
  const SKIP_SELECTOR = "[data-i18n-skip], script, style, pre, textarea";

  const EN = {
    // Shared
    "Betrieb": "Operation",
    "Bewegung": "Motion",
    "wartet": "waiting",
    "bereit": "ready",
    "Bereit": "Ready",
    "unbekannt": "unknown",
    "Achsen": "Axes",
    "Geschwindigkeit": "Speed",
    "Demo Daten": "Demo data",
    "Fehler": "Error",
    "Projektteam": "Project team",
    "Smart Manufacturing Projekt 2026 · Elias Bitsch · Viktoriia Ovdiienko · Philip Stix":
      "Smart Manufacturing Project 2026 · Elias Bitsch · Viktoriia Ovdiienko · Philip Stix",
    "Sprache ändern": "Change language",
    "Heller Modus": "Light mode",

    // Dashboard: header and KPI strip
    "Digital Twin und ROS2-Telemetrie live vom Roboter": "Digital twin and ROS2 telemetry live from the robot",
    "Dashboard Ansicht": "Dashboard view",
    "Verbinde...": "Connecting...",
    "Verbunden": "Connected",
    "Getrennt": "Disconnected",
    "Betriebszustand": "Operating state",
    "Aktive Topics": "Active topics",
    "Letztes Paket": "Last packet",
    "Graph Zeitfilter": "Chart time filter",
    "Graphen": "Charts",
    "Zeitbereich": "Time range",
    "Letzte Stunde": "Last hour",
    "7 Tage": "7 days",
    "30 Tage": "30 days",

    // Dashboard: operation view
    "Gesamtzustand": "Overall condition",
    "Live Daten": "Live data",
    "Datenqualität": "Data quality",
    "stabil": "stable",
    "pruefen": "check",
    "unterbrochen": "interrupted",
    "Aktualität": "Freshness",
    "Hinweise": "Issues",
    "kein Stream": "no stream",
    "Stillstand & Zyklus": "Idle & cycle",
    "Stillstand": "Idle time",
    "Zyklus": "Cycle",
    "TCP-Bahn": "TCP path",
    "aktiv": "active",
    "Bewegt": "Moving",
    "Steht": "Stopped",
    "letzte Bewegung {age}": "last motion {age}",
    "Kein Live-Datenstrom": "No live data stream",
    "Live Aktivität": "Live activity",
    "Achsbewegung": "Axis motion",
    "Live Graph Joint Aktivität": "Live chart joint activity",
    "Legende Achsbewegung": "Axis motion legend",
    "Live Graph Update Rate": "Live chart update rate",
    "Positionen": "Positions",
    "Spanne 0.00 rad": "Range 0.00 rad",
    "Spanne {value} rad": "Range {value} rad",
    "Live Balkendiagramm Joint Positionen": "Live bar chart joint positions",
    "Endeffektor": "End effector",
    "Arbeitsraum": "Workspace",
    "TCP Verlauf": "TCP path",
    "Live TCP Verlauf": "Live TCP path",
    "0 Achsen": "0 axes",
    "{count} Achsen": "{count} axes",
    "synchron": "in sync",
    "letzte Pose": "last pose",
    "Aktive Warnungen": "Active warnings",
    "Achse {number}": "Axis {number}",
    "Zeit": "Time",
    "jetzt": "now",
    "Warte auf ROS2-Daten...": "Waiting for ROS2 data...",
    "Noch keine Joint-State-Daten.": "No joint state data yet.",
    "Noch keine Topics empfangen.": "No topics received yet.",
    "konfiguriert": "configured",

    // Dashboard: health checks
    "Hohe Latenz": "High latency",
    "Hoher Jitter": "High jitter",
    "Achse nahe Limit": "Axis near limit",
    "TCP schnell": "TCP fast",
    "Kritisch": "Critical",
    "Warnung": "Warning",
    "Alle Checks stabil": "All checks stable",

    // Dashboard: joint popover
    "Details schliessen": "Close details",
    "Achswinkel": "Joint angle",
    "Grad": "Degrees",
    "Moment": "Torque",
    "Normierter Weg": "Normalized travel",
    "nicht publiziert": "not published",

    // Dashboard: demo pick & place steps
    "Anfahrt Pick": "Approach pick",
    "Absenken": "Lower",
    "Greifen": "Grip",
    "Anheben": "Lift",
    "Ablegen": "Place",
    "Rückzug": "Retract",
    "Warten": "Wait",

    // Dashboard: maintenance view
    "Historie": "History",
    "Wartung & Trends": "Maintenance & trends",
    "Achsweg": "Axis travel",
    "Wear Score je Achse": "Wear score per axis",
    "Grenzbereich": "Limit range",
    "Belastung": "Load",
    "Richtungsw.": "Dir. changes",
    "EGM Last": "EGM load",
    "konservativ": "conservative",
    "Ereignisse": "Events",
    "{distance} rad Weg · {changes} Richtungswechsel": "{distance} rad travel · {changes} direction changes",
    "Keine Ereignisse im gewaehlten Zeitraum.": "No events in the selected time range.",
    "quittiert {time}": "acknowledged {time}",
    "Quittieren": "Acknowledge",
    "Neues Event": "New event",
    "Meldung schließen": "Close notification",
    "Event Meldungen": "Event notifications",
    "Benachrichtigungen": "Notifications",
    "nicht konfiguriert": "not configured",
    "Empfänger verwalten": "Manage recipients",
    "Empfänger hinzufügen": "Add recipients",
    "Mails abonnieren": "Subscribe to mails",
    "Kritische Alarme sofort": "Critical alarms immediately",
    "Tägliche Zusammenfassung": "Daily summary",
    "Wöchentlicher Zustandsreport": "Weekly condition report",
    "Speichern": "Save",
    "Testmail": "Test mail",
    "sendet...": "sending...",
    "gesendet": "sent",
    "Empfaenger fehlt": "Recipient missing",
    "Empfaenger fehlen": "Recipients missing",
    "SMTP fehlt": "SMTP missing",
    "SMTP Fehler": "SMTP error",
    "pausiert": "paused",
    "Ausgang": "Outbox",
    "Keine Mail-Eintraege.": "No mail entries.",
    "Noch keine Empfaenger gespeichert.": "No recipients saved yet.",
    "abonniert": "subscribed",
    "deaktiviert": "disabled",
    "Schließen": "Close",

    // Dashboard: developer view
    "Paketfluss": "Packet flow",
    "Live Graph Paketfluss": "Live chart packet flow",
    "Live Balkendiagramm Topic Freshness": "Live bar chart topic freshness",
    "Latenz & Jitter": "Latency & jitter",
    "Latenz": "Latency",
    "Datenalter": "Data age",
    "Achsen Debug": "Axes debug",
    "Letzte ROS2-Nachricht": "Latest ROS2 message",
    "Alle": "All",
    "Weiter": "Resume",

    // HMI: login and confirmation
    "Geschützter Zugriff": "Protected access",
    "Passwort": "Password",
    "Einloggen": "Log in",
    "Bitte erneut einloggen": "Please log in again",
    "{user} angemeldet": "{user} logged in",
    "Abgemeldet": "Logged out",
    "Home anfahren bestaetigen": "Confirm move to home",
    "Sicherheitsabfrage": "Safety check",
    "Home anfahren?": "Move to home?",
    "Der Roboter faehrt langsam in die Home-Position.": "The robot moves slowly to the home position.",
    "Abbrechen": "Cancel",
    "Home anfahren": "Move to home",

    // HMI: header, status and tiles
    "Verbinde": "Connecting",
    "Roboter online": "Robot online",
    "Dashboard verbunden": "Dashboard connected",
    "Demo-Modus aktiv": "Demo mode active",
    "Letzte Roboterdaten: {age} s": "Last robot data: {age} s",
    "WS Fehler: {message}": "WS error: {message}",
    "Roboterstatus": "Robot status",
    "HMI Bereiche": "HMI sections",
    "Roboter": "Robot",

    // HMI: jog control
    "Achsen bewegen": "Jog axes",
    "TCP linear bewegen": "Jog TCP linearly",
    "Jog Modus": "Jog mode",
    "Mobile Joystick Steuerung": "Mobile joystick control",
    "Joystick Ziel": "Joystick target",
    "Joystick halten und ziehen": "Hold and drag joystick",
    "Joystick bereit": "Joystick ready",
    "Mitte": "Center",
    "Achssteuerung": "Axis control",
    "TCP Linearsteuerung": "TCP linear control",
    "TCP in X und Y bewegen": "Move TCP in X and Y",
    "Vor": "Forward",
    "Links": "Left",
    "Zurück": "Back",
    "Rechts": "Right",
    "TCP Vor": "TCP forward",
    "TCP Links": "TCP left",
    "TCP Zurück": "TCP back",
    "TCP Rechts": "TCP right",
    "Orientierung": "Orientation",
    "Aktuelle Achswerte": "Current joint values",
    "Jog J{axis} bei {speed}%": "Jog J{axis} at {speed}%",
    "Jog Fehler: {message}": "Jog error: {message}",
    "Stop gesendet": "Stop sent",
    "Stop Fehler: {message}": "Stop error: {message}",
    "Home gesendet: {speed}%, {duration} s": "Home sent: {speed}%, {duration} s",
    "Home Fehler: {message}": "Home error: {message}",
    "Logout Fehler: {message}": "Logout error: {message}",

    // HMI: other panels
    "Achsgeschwindigkeit": "Axis speed",
    "Achs-Geschwindigkeiten": "Axis speeds",
    "Zonen & Sichtbarkeit": "Zones & visibility",
    "Im Dashboard öffnen": "Open in dashboard",
  };

  // Reverse lookup for plain entries, used when text rendered in English has to
  // be switched back to German.
  const DE_BY_EN = {};
  for (const [source, english] of Object.entries(EN)) {
    if (!source.includes("{") && !(english in DE_BY_EN)) DE_BY_EN[english] = source;
  }

  function initialLanguage() {
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    if (LANGUAGES.includes(fromUrl)) return fromUrl;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (LANGUAGES.includes(stored)) return stored;
    } catch {
      // Storage can be blocked; German stays the default.
    }
    return "de";
  }

  let lang = initialLanguage();
  const listeners = new Set();
  const textSources = new WeakMap();
  const attributeSources = new WeakMap();

  /**
   * Translate a German source string into the active language.
   *
   * @param {string} source German text, optionally with {placeholders}.
   * @param {object} [params] Values for the placeholders.
   * @returns {string} Translated text, or the German source without an entry.
   */
  function t(source, params) {
    let text = lang === "en" && EN[source] !== undefined ? EN[source] : source;
    if (params) {
      text = text.replace(/\{(\w+)\}/g, (match, key) => (params[key] !== undefined ? String(params[key]) : match));
    }
    return text;
  }

  function locale() {
    return LOCALES[lang];
  }

  // Text that was not seen before is in the previous language: German on first
  // load (the markup), otherwise whatever t() produced before the switch.
  function sourceOf(text, previousLang) {
    return previousLang === "en" ? DE_BY_EN[text] ?? text : text;
  }

  function translateTextNode(node, previousLang) {
    const trimmed = node.nodeValue.trim();
    if (!trimmed) return;
    const source = textSources.get(node)?.rendered === trimmed ? textSources.get(node).source : sourceOf(trimmed, previousLang);
    if (EN[source] === undefined) return;
    const next = t(source);
    textSources.set(node, { source, rendered: next });
    if (next !== trimmed) node.nodeValue = node.nodeValue.replace(trimmed, next);
  }

  function translateAttributes(element, previousLang) {
    const stored = attributeSources.get(element) || {};
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (!value) continue;
      const source = stored[name]?.rendered === value ? stored[name].source : sourceOf(value, previousLang);
      if (EN[source] === undefined) continue;
      const next = t(source);
      stored[name] = { source, rendered: next };
      if (next !== value) element.setAttribute(name, next);
    }
    attributeSources.set(element, stored);
  }

  /**
   * Translate all static and already rendered text below root.
   *
   * @param {ParentNode} [root] Subtree to translate.
   * @param {string} [previousLang] Language the unseen text is currently in.
   * @returns {void}
   */
  function apply(root = document.body, previousLang = "de") {
    document.documentElement.lang = lang;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.currentNode; node; node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches(SKIP_SELECTOR)) continue;
        translateAttributes(node, previousLang);
      } else if (!node.parentElement?.closest(SKIP_SELECTOR)) {
        translateTextNode(node, previousLang);
      }
    }
    updateSwitchers();
  }

  function setLanguage(next) {
    if (!LANGUAGES.includes(next) || next === lang) return;
    const previousLang = lang;
    lang = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Without storage the choice only lasts for this page view.
    }
    apply(document.body, previousLang);
    listeners.forEach((listener) => listener(lang));
  }

  function onChange(listener) {
    listeners.add(listener);
  }

  function updateSwitchers() {
    document.querySelectorAll("[data-lang-switch]").forEach((switcher) => {
      const current = switcher.querySelector("[data-lang-current]");
      if (current) current.textContent = lang.toUpperCase();
      switcher.querySelectorAll("[data-lang]").forEach((item) => {
        item.setAttribute("aria-checked", String(item.dataset.lang === lang));
      });
    });
  }

  function closeMenus(except = null) {
    document.querySelectorAll("[data-lang-switch]").forEach((switcher) => {
      if (switcher === except) return;
      switcher.querySelector(".lang-menu").hidden = true;
      switcher.querySelector(".lang-button").setAttribute("aria-expanded", "false");
    });
  }

  function installSwitchers() {
    document.querySelectorAll("[data-lang-switch]").forEach((switcher) => {
      const button = switcher.querySelector(".lang-button");
      const menu = switcher.querySelector(".lang-menu");
      button.addEventListener("click", () => {
        const open = menu.hidden;
        closeMenus(switcher);
        menu.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
        if (open) menu.querySelector('[aria-checked="true"]')?.focus();
      });
      menu.addEventListener("click", (event) => {
        const item = event.target.closest("[data-lang]");
        if (!item) return;
        setLanguage(item.dataset.lang);
        closeMenus();
        button.focus();
      });
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest?.("[data-lang-switch]")) closeMenus();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenus();
    });
  }

  window.i18n = {
    t,
    locale,
    setLanguage,
    onChange,
    apply,
    get lang() {
      return lang;
    },
  };

  // Deferred scripts run after parsing, so the markup is complete here and is
  // translated before the page scripts render their first dynamic text.
  installSwitchers();
  apply();
})();
