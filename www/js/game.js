/**
 * 2048 纯逻辑引擎 —— 不依赖 DOM / 浏览器 API，可在页面与测试中共用
 */
(function (global) {
  'use strict';

  var DIRECTIONS = ['up', 'down', 'left', 'right'];

  function Game2048(size, fourProb) {
    size = size === undefined ? 4 : size;
    if (!Number.isInteger(size) || size < 3 || size > 6) {
      throw new Error('size must be an integer between 3 and 6');
    }
    // 难度参数：新方块刷出 4 的概率，默认 0.1（与经典原版一致），非法值回退默认
    if (typeof fourProb !== 'number' || isNaN(fourProb) || fourProb < 0 || fourProb > 1) {
      fourProb = 0.1;
    }
    this.size = size;
    this.fourProb = fourProb;
    this.reset();
  }

  /** 深拷贝棋盘（{id, value} 逐格映射），防止快照/存档与运行态共享引用 */
  function cloneGrid(grid) {
    return grid.map(function (row) {
      return row.map(function (t) { return t ? { id: t.id, value: t.value } : null; });
    });
  }

  /** 记录撤销快照（道具操作前调用；move 内部保持原有内联实现） */
  Game2048.prototype.saveSnapshot = function () {
    this.snapshot = { grid: cloneGrid(this.grid), score: this.score };
  };

  /** 按当前尺寸重开并清空撤销快照 */
  Game2048.prototype.reset = function () {
    this.grid = [];
    for (var r = 0; r < this.size; r++) {
      var row = [];
      for (var c = 0; c < this.size; c++) row.push(null);
      this.grid.push(row);
    }
    this.score = 0;
    this.nextId = 1;
    this.snapshot = null;
    this.addRandomTile();
    this.addRandomTile();
  };

  Game2048.prototype.getState = function () {
    return { grid: this.grid, score: this.score, size: this.size };
  };

  /** 在随机空格生成 2（90%）或 4（10%），返回新方块或 null */
  Game2048.prototype.addRandomTile = function () {
    var empty = [];
    for (var r = 0; r < this.size; r++) {
      for (var c = 0; c < this.size; c++) {
        if (!this.grid[r][c]) empty.push([r, c]);
      }
    }
    if (!empty.length) return null;
    var cell = empty[Math.floor(Math.random() * empty.length)];
    var tile = { id: this.nextId++, value: Math.random() < (1 - this.fourProb) ? 2 : 4 };
    this.grid[cell[0]][cell[1]] = tile;
    return tile;
  };

  /** 按方向构造“线”列表：每条线是移动方向上从前到后的格子坐标序列 */
  Game2048.prototype.buildLines = function (direction) {
    var lines = [];
    var size = this.size;
    for (var i = 0; i < size; i++) {
      var line = [];
      for (var j = 0; j < size; j++) {
        var r, c;
        if (direction === 'left') { r = i; c = j; }
        else if (direction === 'right') { r = i; c = size - 1 - j; }
        else if (direction === 'up') { r = j; c = i; }
        else { r = size - 1 - j; c = i; } // down
        line.push([r, c]);
      }
      lines.push(line);
    }
    return lines;
  };

  /**
   * 执行一次移动
   * 返回 { moved, scoreGained, won, over, tiles, consumed }
   * tiles:    [{ id, value, row, col, isNew, merged }] 当前存活方块（驱动渲染）
   * consumed: [{ id, value, row, col }] 被合并消除的方块，row/col 为滑入目标位（驱动合并动画）
   */
  Game2048.prototype.move = function (direction) {
    if (DIRECTIONS.indexOf(direction) === -1) throw new Error('invalid direction: ' + direction);

    var hadTarget = this.hasTarget();
    var prevGrid = this.grid.map(function (row) {
      return row.map(function (t) { return t ? { id: t.id, value: t.value } : null; });
    });
    var prevScore = this.score;

    var moved = false;
    var scoreGained = 0;
    var mergedIds = {};
    var consumed = [];
    var size = this.size;

    var lines = this.buildLines(direction);
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      var tiles = [];
      for (var j = 0; j < size; j++) {
        var t = this.grid[line[j][0]][line[j][1]];
        if (t) tiles.push(t);
      }
      // 压缩-合并-压缩
      var mergedLine = [];
      for (var i = 0; i < tiles.length; i++) {
        var cur = tiles[i];
        if (i + 1 < tiles.length && tiles[i + 1].value === cur.value) {
          var eaten = tiles[i + 1];
          var dest = line[mergedLine.length]; // 合并后方块落点
          cur.value *= 2;
          scoreGained += cur.value;
          mergedIds[cur.id] = true;
          consumed.push({ id: eaten.id, value: eaten.value, row: dest[0], col: dest[1] });
          i++; // 跳过一个方块只能合并一次
        }
        mergedLine.push(cur);
      }
      // 写回并检测变化
      for (var k = 0; k < size; k++) {
        var r = line[k][0];
        var c = line[k][1];
        var next = k < mergedLine.length ? mergedLine[k] : null;
        var prev = this.grid[r][c];
        if ((prev ? prev.id : 0) !== (next ? next.id : 0)) moved = true;
        this.grid[r][c] = next;
      }
    }

    if (!moved) {
      return { moved: false, scoreGained: 0, won: false, over: this.isOver(), tiles: this.tiles(), consumed: [] };
    }

    this.snapshot = { grid: prevGrid, score: prevScore };
    this.score += scoreGained;
    var spawned = this.addRandomTile();

    return {
      moved: true,
      scoreGained: scoreGained,
      won: !hadTarget && this.hasTarget(),
      over: this.isOver(),
      tiles: this.tiles(spawned ? spawned.id : -1, mergedIds),
      consumed: consumed
    };
  };

  /** 回退一步，返回是否成功 */
  Game2048.prototype.undo = function () {
    if (!this.snapshot) return false;
    this.grid = this.snapshot.grid;
    this.score = this.snapshot.score;
    this.snapshot = null;
    return true;
  };

  /* ---------- 道具操作（均先存快照，支持撤销棋盘状态） ---------- */

  /** 锤子：敲除指定格的方块，返回被删方块 {id, value} 或 null（空格/越界） */
  Game2048.prototype.removeTileAt = function (row, col) {
    if (row < 0 || col < 0 || row >= this.size || col >= this.size) return null;
    var t = this.grid[row][col];
    if (!t) return null;
    this.saveSnapshot();
    this.grid[row][col] = null;
    return { id: t.id, value: t.value };
  };

  /** 洗牌：所有方块位置随机重排（Fisher-Yates），方块少于 2 个时返回 false */
  Game2048.prototype.shuffleTiles = function () {
    var tiles = [];
    var positions = [];
    for (var r = 0; r < this.size; r++) {
      for (var c = 0; c < this.size; c++) {
        if (this.grid[r][c]) tiles.push(this.grid[r][c]);
        positions.push([r, c]);
      }
    }
    if (tiles.length < 2) return false;
    this.saveSnapshot();
    var idx = [];
    for (var k = 0; k < positions.length; k++) idx.push(k);
    for (var m = idx.length - 1; m > 0; m--) {
      var n = Math.floor(Math.random() * (m + 1));
      var tmp = idx[m]; idx[m] = idx[n]; idx[n] = tmp;
    }
    for (var i = 0; i < this.size; i++) {
      for (var j = 0; j < this.size; j++) this.grid[i][j] = null;
    }
    for (var p = 0; p < tiles.length; p++) {
      var pos = positions[idx[p]];
      this.grid[pos[0]][pos[1]] = tiles[p];
    }
    return true;
  };

  /** 刷新：指定格方块重新随机为 2/4（按当前难度概率），返回该方块或 null */
  Game2048.prototype.refreshTileAt = function (row, col) {
    if (row < 0 || col < 0 || row >= this.size || col >= this.size) return null;
    var t = this.grid[row][col];
    if (!t) return null;
    this.saveSnapshot();
    t.value = Math.random() < (1 - this.fourProb) ? 2 : 4;
    return { id: t.id, value: t.value };
  };

  /**
   * 从序列化状态恢复（深拷贝，防引用共享）
   * state: { grid, score, nextId, snapshot }，字段缺失时给安全默认
   */
  Game2048.prototype.restore = function (state) {
    if (!state || !Array.isArray(state.grid) || state.grid.length !== this.size) return false;
    for (var r = 0; r < this.size; r++) {
      if (!Array.isArray(state.grid[r]) || state.grid[r].length !== this.size) return false;
    }
    this.grid = cloneGrid(state.grid);
    this.score = typeof state.score === 'number' && state.score >= 0 ? state.score : 0;
    var maxId = 0;
    for (var i = 0; i < this.size; i++) {
      for (var j = 0; j < this.size; j++) {
        var t = this.grid[i][j];
        if (t && t.id > maxId) maxId = t.id;
      }
    }
    this.nextId = Number.isInteger(state.nextId) && state.nextId > maxId ? state.nextId : maxId + 1;
    if (state.snapshot && Array.isArray(state.snapshot.grid) && state.snapshot.grid.length === this.size) {
      this.snapshot = { grid: cloneGrid(state.snapshot.grid), score: state.snapshot.score || 0 };
    } else {
      this.snapshot = null;
    }
    return true;
  };

  /** 展开当前存活方块列表，标记新出现与刚合并的方块 */
  Game2048.prototype.tiles = function (newId, mergedIds) {
    newId = newId === undefined ? -1 : newId;
    mergedIds = mergedIds || {};
    var out = [];
    for (var r = 0; r < this.size; r++) {
      for (var c = 0; c < this.size; c++) {
        var t = this.grid[r][c];
        if (t) {
          out.push({
            id: t.id,
            value: t.value,
            row: r,
            col: c,
            isNew: t.id === newId,
            merged: !!mergedIds[t.id]
          });
        }
      }
    }
    return out;
  };

  Game2048.prototype.hasTarget = function (target) {
    target = target || 2048;
    for (var r = 0; r < this.size; r++) {
      for (var c = 0; c < this.size; c++) {
        var t = this.grid[r][c];
        if (t && t.value >= target) return true;
      }
    }
    return false;
  };

  /** 无空格且四方向均无相邻可合并时判负 */
  Game2048.prototype.isOver = function () {
    for (var r = 0; r < this.size; r++) {
      for (var c = 0; c < this.size; c++) {
        var t = this.grid[r][c];
        if (!t) return false;
        var right = c + 1 < this.size ? this.grid[r][c + 1] : null;
        var down = r + 1 < this.size ? this.grid[r + 1][c] : null;
        if ((right && right.value === t.value) || (down && down.value === t.value)) return false;
      }
    }
    return true;
  };

  global.Game2048 = Game2048;
  if (typeof module !== 'undefined' && module.exports) module.exports = Game2048;
})(typeof window !== 'undefined' ? window : globalThis);
