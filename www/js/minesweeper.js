/**
 * 扫雷纯逻辑引擎 —— 不依赖 DOM / 浏览器 API，可在页面与测试中共用
 * 棋盘为一维数组，下标 i = row * cols + col
 * 状态：ready（未布雷）→ playing → won | lost
 * 首次翻开时才布雷，并保证首击格及周围八格无雷；连锁展开用显式栈，避免递归栈溢出
 * 每个操作返回 { changed: 变化格下标[], state }，界面只需重绘变化的格子
 */
(function (global) {
  'use strict';

  var LEVELS = {
    beginner: { rows: 9, cols: 9, mines: 10 },
    intermediate: { rows: 16, cols: 16, mines: 40 },
    expert: { rows: 16, cols: 30, mines: 99 }
  };

  var HIDDEN = 0;
  var OPEN = 1;
  var FLAG = 2;

  function Minesweeper(rows, cols, mines, rng) {
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 5 || cols < 5 || rows > 40 || cols > 40) {
      throw new Error('rows and cols must be integers between 5 and 40');
    }
    if (!Number.isInteger(mines) || mines < 1 || mines > rows * cols - 9) {
      throw new Error('mines must leave room for a safe 3x3 first click');
    }
    this.rows = rows;
    this.cols = cols;
    this.mines = mines;
    this.rng = typeof rng === 'function' ? rng : Math.random;
    this.reset();
  }

  Minesweeper.LEVELS = LEVELS;

  Minesweeper.prototype.reset = function () {
    var n = this.rows * this.cols;
    this.mine = new Array(n).fill(false);
    this.adj = new Array(n).fill(0);
    this.cell = new Array(n).fill(HIDDEN);
    this.state = 'ready';
    this.revealed = 0;
    this.flags = 0;
    this.exploded = -1;
  };

  Minesweeper.prototype.size = function () {
    return this.rows * this.cols;
  };

  /** 周围格下标（最多 8 个） */
  Minesweeper.prototype.neighbors = function (i) {
    var r = Math.floor(i / this.cols);
    var c = i % this.cols;
    var out = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        var nr = r + dr;
        var nc = c + dc;
        if (nr >= 0 && nc >= 0 && nr < this.rows && nc < this.cols) out.push(nr * this.cols + nc);
      }
    }
    return out;
  };

  Minesweeper.prototype.computeAdjacency = function () {
    var n = this.size();
    for (var i = 0; i < n; i++) {
      var count = 0;
      var nb = this.neighbors(i);
      for (var k = 0; k < nb.length; k++) if (this.mine[nb[k]]) count++;
      this.adj[i] = count;
    }
  };

  /** 在排除首击 3×3 区域后的格子中随机布雷（部分 Fisher-Yates） */
  Minesweeper.prototype.placeMines = function (safe) {
    var excluded = {};
    excluded[safe] = true;
    var nb = this.neighbors(safe);
    for (var k = 0; k < nb.length; k++) excluded[nb[k]] = true;
    var candidates = [];
    for (var i = 0; i < this.size(); i++) if (!excluded[i]) candidates.push(i);
    for (var m = 0; m < this.mines; m++) {
      var j = m + Math.floor(this.rng() * (candidates.length - m));
      var tmp = candidates[m];
      candidates[m] = candidates[j];
      candidates[j] = tmp;
      this.mine[candidates[m]] = true;
    }
    this.computeAdjacency();
  };

  function result(game, changed) {
    return { changed: changed, state: game.state };
  }

  function inRange(game, i) {
    return Number.isInteger(i) && i >= 0 && i < game.size();
  }

  function finished(game) {
    return game.state === 'won' || game.state === 'lost';
  }

  /** 踩雷：记录引爆格，并把所有雷与错旗标记为变化，方便界面一次性揭示 */
  function explode(game, i, changed) {
    game.state = 'lost';
    game.exploded = i;
    game.cell[i] = OPEN;
    for (var k = 0; k < game.size(); k++) {
      if (game.mine[k] || game.cell[k] === FLAG) changed.push(k);
    }
  }

  /** 胜利：所有非雷格已翻开；未插旗的雷自动补旗 */
  function checkWin(game, changed) {
    if (game.revealed !== game.size() - game.mines) return;
    game.state = 'won';
    for (var k = 0; k < game.size(); k++) {
      if (game.mine[k] && game.cell[k] !== FLAG) {
        game.cell[k] = FLAG;
        game.flags++;
        changed.push(k);
      }
    }
  }

  /** 从 start 开始翻开；数字为 0 的格子继续向周围扩散（显式栈迭代，O(格子数)） */
  function flood(game, start, changed) {
    var stack = [start];
    while (stack.length) {
      var j = stack.pop();
      if (game.cell[j] !== HIDDEN || game.mine[j]) continue;
      game.cell[j] = OPEN;
      game.revealed++;
      changed.push(j);
      if (game.adj[j] === 0) {
        var nb = game.neighbors(j);
        for (var k = 0; k < nb.length; k++) {
          if (game.cell[nb[k]] === HIDDEN && !game.mine[nb[k]]) stack.push(nb[k]);
        }
      }
    }
  }

  Minesweeper.prototype.reveal = function (i) {
    var changed = [];
    if (!inRange(this, i) || finished(this) || this.cell[i] !== HIDDEN) return result(this, changed);
    if (this.state === 'ready') {
      this.placeMines(i);
      this.state = 'playing';
    }
    if (this.mine[i]) {
      changed.push(i);
      explode(this, i, changed);
      return result(this, changed);
    }
    flood(this, i, changed);
    checkWin(this, changed);
    return result(this, changed);
  };

  Minesweeper.prototype.toggleFlag = function (i) {
    var changed = [];
    if (!inRange(this, i) || finished(this)) return result(this, changed);
    if (this.cell[i] === HIDDEN) {
      this.cell[i] = FLAG;
      this.flags++;
      changed.push(i);
    } else if (this.cell[i] === FLAG) {
      this.cell[i] = HIDDEN;
      this.flags--;
      changed.push(i);
    }
    return result(this, changed);
  };

  /** 快速翻开：已翻开的数字格周围旗数等于数字时，翻开其余未插旗的相邻格 */
  Minesweeper.prototype.chord = function (i) {
    var changed = [];
    if (!inRange(this, i) || this.state !== 'playing' || this.cell[i] !== OPEN || this.adj[i] === 0) {
      return result(this, changed);
    }
    var nb = this.neighbors(i);
    var flagged = 0;
    for (var k = 0; k < nb.length; k++) if (this.cell[nb[k]] === FLAG) flagged++;
    if (flagged !== this.adj[i]) return result(this, changed);
    for (var m = 0; m < nb.length; m++) {
      var j = nb[m];
      if (this.cell[j] !== HIDDEN) continue;
      if (this.mine[j]) {
        changed.push(j);
        explode(this, j, changed);
        return result(this, changed);
      }
      flood(this, j, changed);
    }
    checkWin(this, changed);
    return result(this, changed);
  };

  /** 剩余雷数（总雷数 − 旗数，可为负表示插多了） */
  Minesweeper.prototype.remaining = function () {
    return this.mines - this.flags;
  };

  /** 格子视图：'hidden' | 'flag' | 'open'，以及是否为雷、周围雷数 */
  Minesweeper.prototype.view = function (i) {
    var s = this.cell[i];
    return {
      status: s === OPEN ? 'open' : s === FLAG ? 'flag' : 'hidden',
      mine: this.mine[i],
      count: this.adj[i],
      exploded: i === this.exploded
    };
  };

  /** 序列化（仅 ready / playing 可恢复）：雷位下标数组 + 格子状态字符串 */
  Minesweeper.prototype.serialize = function () {
    var mines = [];
    for (var i = 0; i < this.size(); i++) if (this.mine[i]) mines.push(i);
    return {
      rows: this.rows,
      cols: this.cols,
      mines: this.mines,
      state: this.state,
      mineAt: mines,
      cells: this.cell.join('')
    };
  };

  /** 严格校验后恢复；失败返回 false 且不改动当前状态 */
  Minesweeper.prototype.restore = function (s) {
    if (!s || typeof s !== 'object') return false;
    if (s.rows !== this.rows || s.cols !== this.cols || s.mines !== this.mines) return false;
    if (s.state !== 'ready' && s.state !== 'playing') return false;
    var n = this.size();
    if (typeof s.cells !== 'string' || s.cells.length !== n || !/^[012]*$/.test(s.cells)) return false;
    if (!Array.isArray(s.mineAt)) return false;

    var mine = new Array(n).fill(false);
    if (s.state === 'ready') {
      if (s.mineAt.length !== 0 || s.cells.indexOf('1') !== -1) return false;
    } else {
      if (s.mineAt.length !== this.mines) return false;
      for (var k = 0; k < s.mineAt.length; k++) {
        var m = s.mineAt[k];
        if (!Number.isInteger(m) || m < 0 || m >= n || mine[m]) return false;
        mine[m] = true;
      }
    }

    var cell = new Array(n);
    var revealed = 0;
    var flags = 0;
    for (var i = 0; i < n; i++) {
      cell[i] = s.cells.charCodeAt(i) - 48;
      if (cell[i] === OPEN) {
        if (mine[i]) return false; // 进行中的对局不可能翻开过雷
        revealed++;
      } else if (cell[i] === FLAG) {
        flags++;
      }
    }
    if (s.state === 'playing' && revealed === 0) return false;
    if (revealed >= n - this.mines) return false; // 已胜利的局不应被保存为进行中

    this.mine = mine;
    this.cell = cell;
    this.revealed = revealed;
    this.flags = flags;
    this.state = s.state;
    this.exploded = -1;
    this.computeAdjacency();
    return true;
  };

  global.Minesweeper = Minesweeper;
  if (typeof module !== 'undefined' && module.exports) module.exports = Minesweeper;
})(typeof window !== 'undefined' ? window : globalThis);
