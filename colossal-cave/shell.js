/*
 * Colossal Cave — Cartridge web shell.
 *
 * Drives the Open Adventure wasm build (advent.js via engine.js / CaveSession)
 * and renders a mobile-first terminal: scrolling transcript, native input,
 * compass + verb pad, tap-a-word, command history, autosave to localStorage.
 */
(function () {
  "use strict";
  var T = window.CaveText;
  var $ = function (id) { return document.getElementById(id); };

  var KEY = {
    save: "cave.save.v1", log: "cave.log.v1", hist: "cave.hist.v1",
    ended: "cave.ended.v1", lang: "cave.lang", size: "cave.size",
  };
  var MAX_LOG_CHARS = 60000;
  var MAX_HIST = 40;

  // ---------------------------------------------------------------- i18n
  var STR = {
    en: {
      title: "Colossal Cave", menu: "Menu", newGame: "New game", language: "Language",
      textSize: "Text size", credits: "Credits & license", close: "Close",
      placeholder: "Type a command…", send: "Send", history: "Command history",
      historyEmpty: "No commands yet.", ended: "Your adventure is over.", playAgain: "Play again",
      newGameConfirm: "Start over? Your current adventure will be lost.", cancel: "Cancel",
      startOver: "Start over", loading: "Lighting the lamp…", resumed: "Adventure resumed",
      newStarted: "New adventure",
      tip: "Tap any word in the story to add it to your command. Verb buttons wait for an object: tap TAKE, then tap “lamp”. Your game saves after every move.",
      loadError: "The game engine could not be loaded.", esNote: "",
      creditsBody: "The game text, puzzles and engine are the original 1977/1995 adventure, compiled unchanged to WebAssembly.",
      creditsShell: "Mobile shell, touch controls and autosave: Cartridge Studio.",
      yes: "YES", no: "NO",
    },
    es: {
      title: "La Cueva Colosal", menu: "Menú", newGame: "Nueva partida", language: "Idioma",
      textSize: "Tamaño de texto", credits: "Créditos y licencia", close: "Cerrar",
      placeholder: "Escribe una orden…", send: "Enviar", history: "Historial de órdenes",
      historyEmpty: "Aún no hay órdenes.", ended: "Tu aventura ha terminado.", playAgain: "Jugar de nuevo",
      newGameConfirm: "¿Empezar de nuevo? Perderás la aventura actual.", cancel: "Cancelar",
      startOver: "Empezar", loading: "Encendiendo la lámpara…", resumed: "Aventura reanudada",
      newStarted: "Nueva aventura",
      tip: "El texto del juego está en inglés, como el original de 1977. Toca cualquier palabra del relato para añadirla a tu orden; los botones de verbo esperan un objeto (toca TAKE y luego “lamp”). La partida se guarda tras cada movimiento.",
      loadError: "No se pudo cargar el motor del juego.",
      esNote: "Nota: el juego (descripciones y órdenes) está en inglés, tal como se escribió en 1977. Solo la interfaz está traducida; los botones muestran la orden inglesa con su traducción debajo.",
      creditsBody: "El texto, los acertijos y el motor son la aventura original de 1977/1995, compilada sin cambios a WebAssembly.",
      creditsShell: "Interfaz móvil, controles táctiles y autoguardado: Cartridge Studio.",
      yes: "SÍ", no: "NO",
    },
  };
  // Spanish glosses shown under the English command words.
  var GLOSS = {
    TAKE: "coger", DROP: "soltar", OPEN: "abrir", LIGHT: "encender", OFF: "apagar",
    INVENTORY: "inventario", LOOK: "mirar", UP: "subir", DOWN: "bajar", IN: "entrar",
    OUT: "salir", BACK: "volver", CLOSE: "cerrar", UNLOCK: "abrir llave", LOCK: "cerrar llave",
    READ: "leer", EAT: "comer", DRINK: "beber", FILL: "llenar", POUR: "verter", WAVE: "agitar",
    THROW: "lanzar", ATTACK: "atacar", FEED: "alimentar", FIND: "buscar", SCORE: "puntos",
    HELP: "ayuda", QUIT: "abandonar",
  };

  function sysLang() {
    var l = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
    return /^es/i.test(l) ? "es" : "en";
  }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* quota/private */ } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  var lang = load(KEY.lang) || sysLang();
  if (!STR[lang]) lang = "en";
  function t(k) { return (STR[lang] && STR[lang][k] !== undefined) ? STR[lang][k] : STR.en[k]; }

  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t("title");
    document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (el) { el.placeholder = t(el.getAttribute("data-i18n-ph")); });
    document.querySelectorAll("[data-i18n-aria]").forEach(function (el) { el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria"))); });
    document.querySelectorAll("#langSeg button").forEach(function (b) { b.classList.toggle("on", b.dataset.lang === lang); });
    buildPad();
    renderChips();
  }

  // ---------------------------------------------------------------- text size
  var size = parseInt(load(KEY.size), 10) || 17;
  function applySize() {
    document.documentElement.style.setProperty("--fs", size + "px");
    document.querySelectorAll("#sizeSeg button").forEach(function (b) { b.classList.toggle("on", +b.dataset.size === size); });
  }

  // ---------------------------------------------------------------- transcript
  var log = $("log");
  var entries = []; // {k: "out"|"cmd"|"note"|"sep", t}
  try { entries = JSON.parse(load(KEY.log) || "[]") || []; } catch (e) { entries = []; }
  var history = [];
  try { history = JSON.parse(load(KEY.hist) || "[]") || []; } catch (e) { history = []; }

  function addEntry(k, text, persist) {
    var p = document.createElement("p");
    p.className = k;
    p.textContent = text;
    log.appendChild(p);
    if (persist !== false) entries.push({ k: k, t: text });
    return p;
  }
  function scrollDown() {
    requestAnimationFrame(function () { log.scrollTop = log.scrollHeight; });
  }
  function saveLog() {
    entries = T.trimTranscript(entries, MAX_LOG_CHARS);
    store(KEY.log, JSON.stringify(entries));
  }
  function renderAll() {
    log.textContent = "";
    entries.forEach(function (e) { addEntry(e.k, e.t, false); });
    scrollDown();
  }

  // ---------------------------------------------------------------- engine session
  var session = null;
  var gen = 0;
  var pending = "";   // engine output not yet rendered
  var lastOut = "";   // last rendered output block (for yes/no detection)
  var ended = false;
  var busy = true;

  function flushOutput() {
    if (!pending) return;
    var paras = T.reflow(pending);
    pending = "";
    paras.forEach(function (para) { addEntry("out", para); });
    if (paras.length) lastOut = paras[paras.length - 1];
    scrollDown();
  }

  function startGame(fresh) {
    var my = ++gen;
    ended = false;
    busy = true;
    $("endcard").hidden = true;
    app.classList.remove("over");
    var saveB64 = fresh ? null : load(KEY.save);
    var saveBytes = null;
    if (saveB64) { try { saveBytes = T.fromB64(saveB64); } catch (e) { saveBytes = null; } }
    if (!saveBytes) {
      // brand new adventure: drop any old transcript
      entries = [];
      log.textContent = "";
      addEntry("sep", t("newStarted"));
      addEntry("note", t("tip"));
    } else {
      addEntry("sep", t("resumed"));
    }
    saveLog();
    var loading = addEntry("loading", t("loading"), false);
    scrollDown();
    window.CaveSession.start({
      createAdvent: window.createAdvent,
      save: saveBytes,
      echo: false,
      onOutput: function (s) { if (my === gen) pending += s; },
      onIdle: function () {
        if (my !== gen) return;
        if (loading.parentNode) loading.parentNode.removeChild(loading);
        flushOutput();
        saveLog();
        busy = false;
        renderChips();
      },
      onSave: function (bytes) {
        if (my !== gen) return;
        store(KEY.save, T.toB64(bytes));
      },
      onExit: function () {
        if (my !== gen) return;
        if (loading.parentNode) loading.parentNode.removeChild(loading);
        flushOutput();
        ended = true;
        busy = false;
        store(KEY.save, null);
        store(KEY.ended, "1");
        saveLog();
        showEnd();
      },
    }).then(function (s) {
      if (my === gen) session = s;
    }, function (err) {
      if (my !== gen) return;
      if (loading.parentNode) loading.parentNode.removeChild(loading);
      addEntry("note", t("loadError") + " " + (err && err.message ? err.message : err), false);
      console.warn(err);
    });
  }

  function showEnd() {
    $("endcard").hidden = false;
    app.classList.add("over");
    input.blur();
    renderChips();
    scrollDown();
  }

  function newGame() {
    store(KEY.save, null);
    store(KEY.ended, null);
    store(KEY.log, null);
    history = [];
    store(KEY.hist, "[]");
    session = null;
    startGame(true);
  }

  function send(cmd) {
    cmd = String(cmd || "").replace(/\s+/g, " ").trim();
    if (!cmd || !session || ended) return;
    if (busy && !session.waiting) return;
    disarm();
    $("cmd").value = "";
    syncClear();
    addEntry("cmd", cmd);
    lastOut = "";
    if (history[history.length - 1] !== cmd) history.push(cmd);
    if (history.length > MAX_HIST) history = history.slice(-MAX_HIST);
    store(KEY.hist, JSON.stringify(history));
    histPos = history.length;
    busy = true;
    renderChips();
    scrollDown();
    session.send(cmd);
  }

  // ---------------------------------------------------------------- input row
  var input = $("cmd");
  var armed = null; // verb button element waiting for an object
  var histPos = history.length;

  function syncClear() { $("clearBtn").hidden = !input.value; }
  function disarm() {
    if (armed) armed.classList.remove("armed");
    armed = null;
  }
  $("inputRow").addEventListener("submit", function (e) {
    e.preventDefault();
    send(input.value);
  });
  input.addEventListener("input", function () { syncClear(); if (!input.value.trim()) disarm(); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (!history.length) return;
      e.preventDefault();
      histPos = Math.max(0, Math.min(history.length, histPos + (e.key === "ArrowUp" ? -1 : 1)));
      input.value = history[histPos] || "";
      syncClear();
    }
  });
  $("clearBtn").addEventListener("click", function () { input.value = ""; disarm(); syncClear(); });

  // ---------------------------------------------------------------- pad
  var COMPASS = [
    ["NW", "dir"], ["N", "dir card"], ["NE", "dir"],
    ["W", "dir card"], ["LOOK", "look"], ["E", "dir card"],
    ["SW", "dir"], ["S", "dir card"], ["SE", "dir"],
  ];
  var VERTICAL = ["UP", "DOWN", "IN"];
  var VERBS = ["INVENTORY", "TAKE", "DROP", "OPEN", "LIGHT", "OFF"];
  var NEEDS_OBJECT = { TAKE: 1, DROP: 1, OPEN: 1, CLOSE: 1, UNLOCK: 1, LOCK: 1, READ: 1, EAT: 1,
    DRINK: 1, FILL: 1, POUR: 1, WAVE: 1, THROW: 1, ATTACK: 1, FEED: 1, FIND: 1 };
  var EXTRA = ["OUT", "BACK", "CLOSE", "UNLOCK", "READ", "FILL", "POUR", "DRINK", "EAT", "WAVE",
    "THROW", "ATTACK", "FEED", "FIND", "SCORE", "HELP"];
  var SEND_AS = { UP: "u", DOWN: "d", INVENTORY: "inventory", LOOK: "look" };
  var LOOK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>';

  function key(label, cls, small, text) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "k " + cls;
    b.dataset.word = label;
    var span = document.createElement("span");
    span.textContent = text || (label === "INVENTORY" ? "INVENT." : label);
    if (label === "LOOK") b.innerHTML = LOOK_SVG;
    b.appendChild(span);
    if (small) {
      var s = document.createElement("small");
      s.textContent = small;
      b.appendChild(s);
    }
    b.setAttribute("aria-label", label);
    return b;
  }
  function gloss(w) { return lang === "es" ? GLOSS[w] || "" : ""; }

  function buildPad() {
    var pad = $("pad");
    var armedWord = armed ? armed.dataset.word : null;
    armed = null;
    pad.textContent = "";
    // 3 compass columns + 1 vertical column + 2 verb columns, 3 rows
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var d = COMPASS[r * 3 + c];
        pad.appendChild(key(d[0], d[1], ""));
      }
      pad.appendChild(key(VERTICAL[r], "dir vert", gloss(VERTICAL[r])));
      pad.appendChild(key(VERBS[r * 2], "verb", gloss(VERBS[r * 2])));
      pad.appendChild(key(VERBS[r * 2 + 1], "verb", gloss(VERBS[r * 2 + 1])));
    }
    if (armedWord) {
      var again = pad.querySelector('[data-word="' + armedWord + '"]');
      if (again) { armed = again; again.classList.add("armed"); }
    }
  }

  function isQuestion() {
    if (ended || busy) return false;
    var last = lastOut.split("\n").pop();
    return /\?\s*$/.test(last) && !/^\s*(what|where|which|how)\b/i.test(last.replace(/^.*[.!]\s+/, ""));
  }

  function renderChips() {
    var chips = $("chips");
    chips.textContent = "";
    if (isQuestion()) {
      chips.appendChild(key("YES", "yn", "", t("yes")));
      chips.appendChild(key("NO", "yn", "", t("no")));
    }
    EXTRA.forEach(function (w) { chips.appendChild(key(w, "", gloss(w))); });
    chips.scrollLeft = 0;
  }

  function flash(b) {
    b.classList.add("flash");
    setTimeout(function () { b.classList.remove("flash"); }, 140);
  }

  function onKey(e) {
    var b = e.target.closest(".k");
    if (!b) return;
    flash(b);
    var w = b.dataset.word;
    if (NEEDS_OBJECT[w]) {
      var verb = w.toLowerCase();
      if (armed && armed.dataset.word === w) { send(verb); return; } // second tap: bare verb
      var rest = input.value.trim();
      if (armed) rest = rest.replace(new RegExp("^" + armed.dataset.word + "\\b\\s*", "i"), "");
      disarm();
      if (rest) { send(verb + " " + rest); return; }
      input.value = verb + " ";
      syncClear();
      armed = b;
      b.classList.add("armed");
      return;
    }
    send(SEND_AS[w] || w.toLowerCase());
  }
  $("pad").addEventListener("click", onKey);
  $("chips").addEventListener("click", onKey);

  // ---------------------------------------------------------------- tap a word
  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    if (document.caretRangeFromPoint) {
      var r = document.caretRangeFromPoint(x, y);
      return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
    return null;
  }
  var hlTimer = 0;
  function highlight(node, s, e) {
    if (!window.CSS || !CSS.highlights || typeof Highlight === "undefined") return;
    var r = document.createRange();
    r.setStart(node, s);
    r.setEnd(node, e);
    CSS.highlights.set("tapword", new Highlight(r));
    clearTimeout(hlTimer);
    hlTimer = setTimeout(function () { CSS.highlights.delete("tapword"); }, 600);
  }
  log.addEventListener("click", function (e) {
    var sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) return; // user is selecting text
    var p = e.target.closest("p");
    if (!p || p.classList.contains("sep") || p.classList.contains("note")) return;
    if (p.classList.contains("cmd")) {
      // tapping an old command puts it back into the input
      input.value = p.textContent;
      disarm();
      syncClear();
      return;
    }
    var c = caretAt(e.clientX, e.clientY);
    if (!c || !c.node || c.node.nodeType !== 3 || !p.contains(c.node)) return;
    var hit = T.wordAt(c.node.data, c.offset);
    if (!hit.word || hit.word.length < 2) return;
    highlight(c.node, hit.start, hit.end);
    if (armed) {
      send(armed.dataset.word.toLowerCase() + " " + hit.word.toLowerCase());
      return;
    }
    input.value = T.addWord(input.value, hit.word) + " ";
    syncClear();
  });

  // ---------------------------------------------------------------- history sheet
  $("histBtn").addEventListener("click", function () {
    var list = $("histList");
    list.textContent = "";
    if (!history.length) {
      var p = document.createElement("p");
      p.className = "small";
      p.textContent = t("historyEmpty");
      list.appendChild(p);
    }
    history.slice().reverse().forEach(function (h) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "row hist";
      b.textContent = h;
      b.addEventListener("click", function () {
        input.value = h;
        disarm();
        syncClear();
        $("histSheet").hidden = true;
      });
      list.appendChild(b);
    });
    $("histSheet").hidden = false;
  });
  $("closeHist").addEventListener("click", function () { $("histSheet").hidden = true; });

  // ---------------------------------------------------------------- menu / overlays
  $("menuBtn").addEventListener("click", function () { $("sheet").hidden = false; });
  $("closeSheet").addEventListener("click", function () { $("sheet").hidden = true; });
  $("newBtn").addEventListener("click", function () { $("sheet").hidden = true; $("confirm").hidden = false; });
  $("confirmNo").addEventListener("click", function () { $("confirm").hidden = true; });
  $("confirmYes").addEventListener("click", function () { $("confirm").hidden = true; newGame(); });
  $("againBtn").addEventListener("click", newGame);
  $("creditsBtn").addEventListener("click", function () { $("sheet").hidden = true; $("credits").hidden = false; });
  $("closeCredits").addEventListener("click", function () { $("credits").hidden = true; });
  document.querySelectorAll(".overlay").forEach(function (o) {
    o.addEventListener("click", function (e) { if (e.target === o) o.hidden = true; });
  });
  $("langSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    lang = b.dataset.lang;
    store(KEY.lang, lang);
    applyLang();
  });
  $("sizeSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    size = +b.dataset.size;
    store(KEY.size, String(size));
    applySize();
    scrollDown();
  });

  // ---------------------------------------------------------------- soft keyboard
  // Keep the input row glued above the on-screen keyboard: size #app to the
  // visual viewport and hide the button pad while the keyboard is up.
  var app = $("app");
  function fitViewport() {
    var vv = window.visualViewport;
    var h = vv ? vv.height : window.innerHeight;
    var top = vv ? vv.offsetTop : 0;
    app.style.height = h + "px";
    app.style.transform = top ? "translateY(" + top + "px)" : "";
    var full = Math.max(window.innerHeight, document.documentElement.clientHeight, fullH);
    var kbd = document.activeElement === input && full - h > 150;
    app.classList.toggle("kbd", kbd);
    scrollDown();
  }
  var fullH = window.innerHeight;
  window.addEventListener("orientationchange", function () { fullH = 0; setTimeout(function () { fullH = window.innerHeight; }, 400); });
  if (window.visualViewport) {
    visualViewport.addEventListener("resize", fitViewport);
    visualViewport.addEventListener("scroll", fitViewport);
  }
  window.addEventListener("resize", fitViewport);
  input.addEventListener("focus", function () { setTimeout(fitViewport, 60); setTimeout(fitViewport, 400); });
  input.addEventListener("blur", function () { setTimeout(fitViewport, 60); });

  // ---------------------------------------------------------------- boot
  applySize();
  applyLang();
  fitViewport();
  if (load(KEY.ended) === "1" && !load(KEY.save) && entries.length) {
    renderAll();
    ended = true;
    busy = false;
    showEnd();
  } else {
    if (load(KEY.save)) renderAll();
    startGame(false);
  }

  // automation hook (smoke / poster capture)
  window.cave = {
    state: function () { return { busy: busy, ended: ended, entries: entries.length, saved: !!load(KEY.save) }; },
    send: send,
  };
})();
