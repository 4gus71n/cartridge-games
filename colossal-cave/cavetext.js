/*
 * Pure text helpers for the Colossal Cave shell (browser + node tests).
 */
(function (root) {
  "use strict";

  // Open Adventure hard-wraps its prose at ~70 columns. On a phone that gives
  // ragged double wraps, so join lines that were wrapped by that limit, while
  // keeping intentional short breaks (inventory lists, verse, etc.).
  var WRAP_MIN = 55;

  function reflow(text) {
    var paras = [];
    var blocks = String(text).replace(/\r/g, "").split(/\n[ \t]*\n+/);
    for (var b = 0; b < blocks.length; b++) {
      var lines = blocks[b].split("\n");
      var outp = "";
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/\s+$/, "");
        if (i === 0) { outp = line; continue; }
        var prev = lines[i - 1].replace(/\s+$/, "");
        var joinable = prev.length >= WRAP_MIN && line.length > 0 && !/^\s/.test(line);
        outp += (joinable ? " " : "\n") + line;
      }
      outp = outp.replace(/^\n+|\n+$/g, "");
      if (outp.trim().length) paras.push(outp);
    }
    return paras;
  }

  // Word (letters/digits/'-) around `offset` in `text`, or "".
  function wordAt(text, offset) {
    var re = /[A-Za-z0-9'\-]/;
    var s = offset, e = offset;
    if (s > 0 && !re.test(text.charAt(s)) && re.test(text.charAt(s - 1))) { s--; e--; }
    if (!re.test(text.charAt(s))) return { word: "", start: offset, end: offset };
    while (s > 0 && re.test(text.charAt(s - 1))) s--;
    while (e < text.length && re.test(text.charAt(e))) e++;
    var w = text.slice(s, e).replace(/^['\-]+|['\-]+$/g, "");
    return { word: w, start: s, end: e };
  }

  // Combine the current input with a tapped word / verb.
  function addWord(input, word) {
    input = String(input || "").replace(/\s+$/, "");
    word = String(word || "").toLowerCase();
    if (!word) return input;
    return input ? input + " " + word : word;
  }

  function setVerb(input, verb) {
    // verb + whatever object words are already typed (drop a previous verb
    // that came from a verb button so tapping TAKE then DROP doesn't stack)
    var rest = String(input || "").trim();
    return rest ? verb + " " + rest : verb + " ";
  }

  function toB64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, i, i + 0x8000));
    }
    return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
  }

  function fromB64(str) {
    var s = typeof atob === "function" ? atob(str) : Buffer.from(str, "base64").toString("binary");
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // Keep the stored transcript bounded (entries: {k, t}).
  function trimTranscript(entries, maxChars) {
    var total = 0, i = entries.length;
    while (i > 0 && total + entries[i - 1].t.length <= maxChars) { total += entries[i - 1].t.length; i--; }
    return entries.slice(i);
  }

  var CaveText = { reflow: reflow, wordAt: wordAt, addWord: addWord, setVerb: setVerb,
    toB64: toB64, fromB64: fromB64, trimTranscript: trimTranscript, WRAP_MIN: WRAP_MIN };
  if (typeof module !== "undefined" && module.exports) module.exports = CaveText;
  else root.CaveText = CaveText;
})(typeof self !== "undefined" ? self : this);
