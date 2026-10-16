/*
 * CaveSession — thin driver around the Open Adventure wasm build (advent.js).
 * Shared by the browser shell (shell.js) and the node tests (tests/*.test.js).
 *
 *   const s = await CaveSession.start({ createAdvent, save, onOutput, onIdle, onSave, onExit });
 *   s.send("enter building");      // queue one input line
 *   await s.idle();                // resolves when the game waits for input (or exited)
 *
 * The game runs `advent -a /advent.sav` (ADVENT_AUTOSAVE build): if `save`
 * bytes are given they are restored, and before every main command the game
 * rewrites the save file and we hand the bytes to onSave().
 */
(function (root) {
  "use strict";
  var SAVE_PATH = "/advent.sav";

  function start(opts) {
    var queue = [];
    var waiting = null; // {deliver, prompt}
    var exited = false;
    var exitCode = null;
    var idleWaiters = [];
    var echo = opts.echo !== false;
    var mod = null;
    var out = opts.onOutput || function () {};

    function fireIdle() {
      var w = idleWaiters;
      idleWaiters = [];
      w.forEach(function (f) { f(); });
      if (opts.onIdle && !exited) opts.onIdle(waiting ? waiting.prompt : "");
    }

    var cfg = {
      arguments: ["-a", SAVE_PATH],
      print: function (s) { out(s + "\n"); },
      printErr: function (s) { out(s + "\n"); },
      preRun: [function (M) {
        mod = M;
        if (opts.save && opts.save.length) M.FS.writeFile(SAVE_PATH, opts.save);
      }],
      readLine: function (prompt) {
        return new Promise(function (resolve) {
          var deliver = function (line) {
            if (line !== null && echo && line.charAt(0) !== "#") out(prompt + line + "\n");
            resolve(line);
          };
          if (queue.length) {
            deliver(queue.shift());
          } else {
            waiting = { deliver: deliver, prompt: prompt };
            // let the current wasm call unwind before notifying
            Promise.resolve().then(fireIdle);
          }
        });
      },
      onTurn: function () {
        if (!opts.onSave) return;
        try { opts.onSave(mod.FS.readFile(SAVE_PATH)); } catch (e) { /* no save yet */ }
      },
      onExit: function (code) {
        exited = true;
        exitCode = code;
        waiting = null;
        Promise.resolve().then(function () {
          fireIdle();
          if (opts.onExit) opts.onExit(code);
        });
      },
    };
    if (opts.locateFile) cfg.locateFile = opts.locateFile;
    if (opts.wasmBinary) cfg.wasmBinary = opts.wasmBinary;

    var api = {
      send: function (line) {
        if (exited) return false;
        if (line !== null) line = String(line).replace(/[\r\n]+/g, " "); // null = EOF
        if (waiting) {
          var w = waiting;
          waiting = null;
          w.deliver(line);
        } else {
          queue.push(line);
        }
        return true;
      },
      idle: function () {
        if (exited || (waiting && !queue.length)) return Promise.resolve();
        return new Promise(function (r) { idleWaiters.push(r); });
      },
      get exited() { return exited; },
      get exitCode() { return exitCode; },
      get waiting() { return !!waiting; },
      readSave: function () {
        try { return mod.FS.readFile(SAVE_PATH); } catch (e) { return null; }
      },
    };

    return opts.createAdvent(cfg).then(function (m) {
      mod = m;
      return api;
    });
  }

  var CaveSession = { start: start, SAVE_PATH: SAVE_PATH };
  if (typeof module !== "undefined" && module.exports) module.exports = CaveSession;
  else root.CaveSession = CaveSession;
})(typeof self !== "undefined" ? self : this);
