/**
 * 数字华容道（数字推盘 15-Puzzle）纯逻辑引擎 —— 不依赖 DOM / 浏览器 API，可在页面与测试中共用
 * 棋盘为一维数组 board[0..n²-1]：1..n²-1 为数字块，0 为空格
 */
(function (global) {
  'use strict';

  var DIRECTIONS = ['up', 'down', 'left', 'right'];
  var OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  /** 各尺寸打乱步数（随尺寸递增，保证打乱充分） */
  var SHUFFLE_STEPS = { 3: 80, 4: 200, 5: 400, 6: 600, 7: 850, 8: 1100, 9: 1400, 10: 1700 };

  function HuarongDao(size) {
    size = size === undefined ? 4 : size;
    if (!Number.isInteger(size) || size < 3 || size > 10) {
      throw new Error('size must be an integer between 3 and 10');
    }
    this.size = size;
    this.reset();
  }

  /** 重开：摆好已解态后随机打乱，步数与快照清零 */
  HuarongDao.prototype.reset = function () {
    var len = this.size * this.size;
    this.board = [];
    for (var i = 0; i < len - 1; i++) this.board.push(i + 1);
    this.board.push(0); // 空格在末位
    this.blank = len - 1;
    this.moves = 0;
    this.snapshot = null;
    this.shuffle();
  };

  /**
   * 随机合法移动打乱：从已解状态出发，天然保证可解；
   * 禁止连续反向移动保证打乱质量；步数随尺寸递增（80~1700 步）
   */
  HuarongDao.prototype.shuffle = function () {
    var steps = SHUFFLE_STEPS[this.size];
    do {
      var lastDir = null;
      for (var s = 0; s < steps; s++) {
        var dirs = [];
        for (var i = 0; i < DIRECTIONS.length; i++) {
          var d = DIRECTIONS[i];
          if (lastDir && d === OPPOSITE[lastDir]) continue; // 禁止立即回退
          if (this.canMoveBlank(d)) dirs.push(d);
        }
        if (!dirs.length) break;
        var pick = dirs[Math.floor(Math.random() * dirs.length)];
        this.moveBlankRaw(pick);
        lastDir = pick;
      }
    } while (this.isSolved()); // 极小概率打回原状，重来
  };

  /** 空格能否往 dir 方向移动（不越界） */
  HuarongDao.prototype.canMoveBlank = function (dir) {
    var r = Math.floor(this.blank / this.size);
    var c = this.blank % this.size;
    if (dir === 'up') return r > 0;
    if (dir === 'down') return r < this.size - 1;
    if (dir === 'left') return c > 0;
    return c < this.size - 1; // right
  };

  /**
   * 空格往 dir 方向移动一步（即反方向的相邻块滑入空格）。
   * 内部操作：不计步、不存快照。返回 { value, from, to } 或 null
   */
  HuarongDao.prototype.moveBlankRaw = function (dir) {
    if (!this.canMoveBlank(dir)) return null;
    var r = Math.floor(this.blank / this.size);
    var c = this.blank % this.size;
    var nr = r;
    var nc = c;
    if (dir === 'up') nr = r - 1;
    else if (dir === 'down') nr = r + 1;
    else if (dir === 'left') nc = c - 1;
    else nc = c + 1;
    var from = nr * this.size + nc;
    var value = this.board[from];
    this.board[this.blank] = value;
    this.board[from] = 0;
    var info = { value: value, from: from, to: this.blank };
    this.blank = from;
    return info;
  };

  /** 记录撤销快照（棋盘 + 步数） */
  HuarongDao.prototype.saveSnapshot = function () {
    this.snapshot = { board: this.board.slice(), blank: this.blank, moves: this.moves };
  };

  /**
   * 滑动（连滑）：dir 为滑块移动方向（'up' 即空格下方的整列块一起上移）。
   * 空格沿反方向连续移动到该行/列边缘，途中所有块依次反向滑动一格。
   * 一次操作计 1 步。返回 { moved, tiles: [{ value, from, to }…] }，无法移动返回 moved:false
   */
  HuarongDao.prototype.slide = function (dir) {
    if (DIRECTIONS.indexOf(dir) === -1) throw new Error('invalid direction: ' + dir);
    var blankDir = OPPOSITE[dir]; // 块往 dir 移 = 空格往反方向移
    if (!this.canMoveBlank(blankDir)) return { moved: false, tiles: [] };
    this.saveSnapshot();
    var tiles = [];
    var info;
    while ((info = this.moveBlankRaw(blankDir))) tiles.push(info);
    this.moves++;
    return { moved: true, tiles: tiles };
  };

  /**
   * 点击 index 格（连滑）：该块与空格同行或同列时，两者之间的所有块（含被点击块）
   * 一起朝空格方向滑动一格，空格落至被点击块原位置；否则不动。
   * 一次操作计 1 步。返回 { moved, tiles: [{ value, from, to }…] }
   */
  HuarongDao.prototype.tapCell = function (index) {
    var len = this.size * this.size;
    if (!Number.isInteger(index) || index < 0 || index >= len) return { moved: false, tiles: [] };
    if (index === this.blank) return { moved: false, tiles: [] };
    var r = Math.floor(index / this.size);
    var c = index % this.size;
    var br = Math.floor(this.blank / this.size);
    var bc = this.blank % this.size;
    if (r !== br && c !== bc) return { moved: false, tiles: [] }; // 非同行同列不可移
    var dir = r === br ? (c > bc ? 'right' : 'left') : (r > br ? 'down' : 'up'); // 空格走向被点击块
    this.saveSnapshot();
    var tiles = [];
    while (this.blank !== index) {
      var info = this.moveBlankRaw(dir);
      if (!info) break; // 防御兜底（同行/同列逐格走必合法，正常不可达）
      tiles.push(info);
    }
    if (!tiles.length) return { moved: false, tiles: [] };
    this.moves++;
    return { moved: true, tiles: tiles };
  };

  /** 是否复原（1..n²-1 顺序排列，空格在末位） */
  HuarongDao.prototype.isSolved = function () {
    var len = this.board.length;
    for (var i = 0; i < len - 1; i++) {
      if (this.board[i] !== i + 1) return false;
    }
    return this.board[len - 1] === 0;
  };

  /** 回退一步（棋盘 + 步数），返回是否成功 */
  HuarongDao.prototype.undo = function () {
    if (!this.snapshot) return false;
    this.board = this.snapshot.board;
    this.blank = this.snapshot.blank;
    this.moves = this.snapshot.moves;
    this.snapshot = null;
    return true;
  };

  /** 展开非空滑块列表 [{ value, row, col }] */
  HuarongDao.prototype.tiles = function () {
    var out = [];
    for (var i = 0; i < this.board.length; i++) {
      var v = this.board[i];
      if (v) out.push({ value: v, row: Math.floor(i / this.size), col: i % this.size });
    }
    return out;
  };

  HuarongDao.prototype.getState = function () {
    return { size: this.size, board: this.board, blank: this.blank, moves: this.moves };
  };

  /** 校验棋盘数组（长度/整数/值域/无重复），通过则返回空格下标，否则 -1 */
  function validateBoard(board, len) {
    if (!Array.isArray(board) || board.length !== len) return -1;
    var seen = {};
    var blank = -1;
    for (var i = 0; i < len; i++) {
      var v = board[i];
      if (!Number.isInteger(v) || v < 0 || v >= len || seen[v]) return -1;
      seen[v] = true;
      if (v === 0) blank = i;
    }
    return blank;
  }

  /**
   * 从序列化状态恢复（严格校验，失败返回 false 且不改动当前状态）
   * state: { board, moves, snapshot? }，snapshot: { board, moves }
   */
  HuarongDao.prototype.restore = function (state) {
    if (!state || typeof state !== 'object') return false;
    var len = this.size * this.size;
    var blank = validateBoard(state.board, len);
    if (blank === -1) return false;

    var snapshot = null;
    if (state.snapshot && typeof state.snapshot === 'object') {
      var sBlank = validateBoard(state.snapshot.board, len);
      if (sBlank !== -1) {
        var sMoves = state.snapshot.moves;
        snapshot = {
          board: state.snapshot.board.slice(),
          blank: sBlank,
          moves: Number.isInteger(sMoves) && sMoves >= 0 ? sMoves : 0
        };
      }
    }

    this.board = state.board.slice();
    this.blank = blank;
    this.moves = Number.isInteger(state.moves) && state.moves >= 0 ? state.moves : 0;
    this.snapshot = snapshot;
    return true;
  };

  global.HuarongDao = HuarongDao;
  if (typeof module !== 'undefined' && module.exports) module.exports = HuarongDao;
})(typeof window !== 'undefined' ? window : globalThis);
