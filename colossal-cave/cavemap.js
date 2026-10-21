/*
 * CaveMap — the auto-mapping minimap.
 *
 * Colossal Cave has no map: players traditionally drew one on paper. This
 * builds it as you walk. After every turn the shell reads the player's location
 * out of the engine's save file (`CaveMap.locFromSave`) and reports it here with
 * the command that caused the move; we record rooms, the links between them and
 * which compass direction each link used, then lay the graph out on a grid.
 *
 * Layout: the first room sits at 0,0. A room reached by a compass move is placed
 * one step that way from where you came from; up/down also step vertically and
 * mark a new depth level. Taken cells push the newcomer outward in a spiral, so
 * rooms never overlap. Moves with no direction (xyzzy, plugh, falling) still
 * link the rooms, drawn as a dashed line.
 *
 * Pure logic, no DOM: tests/map.test.js drives it directly, and the shell draws
 * the result on a canvas.
 */
(function (root) {
  "use strict";

  var SAVE_LOC_OFFSET = 128; // save_t: magic[16] + version + canary + 26 int32 fields

  var DIRS = {
    n: [0, -1, 0], s: [0, 1, 0], e: [1, 0, 0], w: [-1, 0, 0],
    ne: [1, -1, 0], nw: [-1, -1, 0], se: [1, 1, 0], sw: [-1, 1, 0],
    u: [0, -1, 1], d: [0, 1, -1],
    "in": [1, 0, 0], out: [-1, 0, 0],
  };

  // Everything the game accepts for a direction, mapped to our 12 keys.
  var WORDS = {
    n: "n", north: "n", s: "s", south: "s", e: "e", east: "e", w: "w", west: "w",
    ne: "ne", northeast: "ne", nw: "nw", northwest: "nw",
    se: "se", southeast: "se", sw: "sw", southwest: "sw",
    u: "u", up: "u", upward: "u", upwards: "u", climb: "u", ascend: "u",
    d: "d", down: "d", downward: "d", downwards: "d", descend: "d",
    "in": "in", inside: "in", enter: "in", inward: "in",
    out: "out", outside: "out", exit: "out", outward: "out", leave: "out",
  };

  /** Reads the player's location out of Open Adventure save bytes. */
  function locFromSave(bytes) {
    if (!bytes || bytes.length < SAVE_LOC_OFFSET + 4) return null;
    var b = bytes;
    return (b[SAVE_LOC_OFFSET]) | (b[SAVE_LOC_OFFSET + 1] << 8) |
      (b[SAVE_LOC_OFFSET + 2] << 16) | (b[SAVE_LOC_OFFSET + 3] << 24);
  }

  /** "go west" / "WEST" / "w" -> "w"; anything else -> "". */
  function dirOf(command) {
    var words = String(command || "").toLowerCase().replace(/[^a-z ]/g, " ").trim().split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      if (words[i] === "go" || words[i] === "walk" || words[i] === "move") continue;
      return WORDS[words[i]] || "";
    }
    return "";
  }

  function key(x, y) { return x + "," + y; }

  function CaveMap(labels) {
    this.labels = labels || [];
    this.reset();
  }

  CaveMap.prototype.reset = function () {
    this.rooms = {};   // loc -> {loc, x, y, z, visits}
    this.links = [];   // {a, b, dir}
    this.taken = {};   // "x,y" -> loc
    this.loc = null;
    this.order = [];   // locs in first-visit order
  };

  /** First free cell at or spiralling out from x,y. */
  CaveMap.prototype._free = function (x, y) {
    if (!this.taken[key(x, y)]) return [x, y];
    for (var r = 1; r <= 12; r++) {
      for (var dx = -r; dx <= r; dx++) {
        for (var dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!this.taken[key(x + dx, y + dy)]) return [x + dx, y + dy];
        }
      }
    }
    return [x, y];
  };

  CaveMap.prototype._add = function (loc, from, dir) {
    var base = from ? [from.x, from.y, from.z] : [0, 0, 0];
    var step = DIRS[dir] || [0, 0, 0];
    if (from && !DIRS[dir]) step = [1, 1, 0]; // unknown move: just offset a bit
    var spot = this._free(base[0] + step[0], base[1] + step[1]);
    var room = { loc: loc, x: spot[0], y: spot[1], z: base[2] + step[2], visits: 0 };
    this.rooms[loc] = room;
    this.taken[key(spot[0], spot[1])] = loc;
    this.order.push(loc);
    return room;
  };

  CaveMap.prototype._link = function (a, b, dir) {
    if (a === null || a === b) return;
    for (var i = 0; i < this.links.length; i++) {
      var l = this.links[i];
      if ((l.a === a && l.b === b) || (l.a === b && l.b === a)) {
        if (!l.dir && dir) l.dir = dir;
        return;
      }
    }
    this.links.push({ a: a, b: b, dir: dir || "" });
  };

  /**
   * Records where the player is after a turn.
   * @param {number} loc engine location id
   * @param {string} command the command that produced it ("" when unknown)
   * @returns {boolean} true when the map changed (room or link added)
   */
  CaveMap.prototype.visit = function (loc, command) {
    if (typeof loc !== "number" || loc <= 0) return false;
    var dir = dirOf(command);
    var from = this.loc !== null ? this.rooms[this.loc] : null;
    var known = !!this.rooms[loc];
    var before = this.links.length;
    var room = known ? this.rooms[loc] : this._add(loc, from, dir);
    if (this.loc !== null && this.loc !== loc) this._link(this.loc, loc, dir);
    room.visits++;
    this.loc = loc;
    return !known || this.links.length !== before;
  };

  CaveMap.prototype.label = function (loc) { return this.labels[loc] || ("Room " + loc); };
  CaveMap.prototype.size = function () { return this.order.length; };

  /** Rooms and links for drawing, plus the grid bounds. */
  CaveMap.prototype.view = function () {
    var self = this;
    var rooms = this.order.map(function (l) { return self.rooms[l]; });
    var bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
    rooms.forEach(function (r, i) {
      if (i === 0) { bounds = { x0: r.x, y0: r.y, x1: r.x, y1: r.y }; return; }
      bounds.x0 = Math.min(bounds.x0, r.x); bounds.y0 = Math.min(bounds.y0, r.y);
      bounds.x1 = Math.max(bounds.x1, r.x); bounds.y1 = Math.max(bounds.y1, r.y);
    });
    return { rooms: rooms, links: this.links, bounds: bounds, loc: this.loc };
  };

  CaveMap.prototype.toJSON = function () {
    return { v: 1, rooms: this.order.map(function (l) {
      var r = this.rooms[l];
      return [r.loc, r.x, r.y, r.z, r.visits];
    }, this), links: this.links.map(function (l) { return [l.a, l.b, l.dir]; }), loc: this.loc };
  };

  CaveMap.prototype.load = function (data) {
    this.reset();
    if (!data || data.v !== 1 || !Array.isArray(data.rooms)) return false;
    try {
      data.rooms.forEach(function (r) {
        var room = { loc: r[0], x: r[1], y: r[2], z: r[3], visits: r[4] || 0 };
        this.rooms[room.loc] = room;
        this.taken[key(room.x, room.y)] = room.loc;
        this.order.push(room.loc);
      }, this);
      (data.links || []).forEach(function (l) {
        this.links.push({ a: l[0], b: l[1], dir: l[2] || "" });
      }, this);
      this.loc = typeof data.loc === "number" ? data.loc : null;
      return true;
    } catch (e) {
      this.reset();
      return false;
    }
  };

  CaveMap.locFromSave = locFromSave;
  CaveMap.dirOf = dirOf;
  CaveMap.SAVE_LOC_OFFSET = SAVE_LOC_OFFSET;

  if (typeof module !== "undefined" && module.exports) module.exports = CaveMap;
  else root.CaveMap = CaveMap;
})(typeof self !== "undefined" ? self : this);
