/**
 * 数独纯逻辑引擎 —— 不依赖 DOM / 浏览器 API，可在页面与测试中共用
 * 棋盘为长度 81 的数组，0 表示空格，下标 i = row * 9 + col
 * - 求解：行 / 列 / 宫位掩码 + 「候选最少的格优先」回溯；countSolutions(grid, 2) 找到第二个解即停止
 * - 生成：先随机填出完整答案，再按随机顺序逐格挖空，每挖一格都校验仍只有唯一解
 */
(function (global) {
  'use strict';

  var ALL = 0x3fe; // 数字 1..9 对应位 1..9

  /** 各难度目标提示数（给定数字个数）区间 */
  var TARGET_CLUES = {
    easy: [38, 40],
    medium: [30, 32],
    hard: [24, 27]
  };
  var ATTEMPT_BUDGET_MS = 200;  // 单次生成超时则重新洗牌
  var TOTAL_BUDGET_MS = 1500;   // 总时长上限，超时返回目前提示最少的唯一解题目

  var ROW = new Array(81);
  var COL = new Array(81);
  var BOX = new Array(81);
  var PEERS = new Array(81);
  (function () {
    for (var i = 0; i < 81; i++) {
      ROW[i] = Math.floor(i / 9);
      COL[i] = i % 9;
      BOX[i] = Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3);
    }
    for (var a = 0; a < 81; a++) {
      var peers = [];
      for (var b = 0; b < 81; b++) {
        if (a !== b && (ROW[a] === ROW[b] || COL[a] === COL[b] || BOX[a] === BOX[b])) peers.push(b);
      }
      PEERS[a] = peers;
    }
  })();

  function popcount(x) {
    var n = 0;
    while (x) { x &= x - 1; n++; }
    return n;
  }

  function now() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function isGrid(grid, allowEmpty) {
    if (!Array.isArray(grid) || grid.length !== 81) return false;
    for (var i = 0; i < 81; i++) {
      var v = grid[i];
      if (!Number.isInteger(v) || v < (allowEmpty ? 0 : 1) || v > 9) return false;
    }
    return true;
  }

  /**
   * 回溯搜索。onSolution(g) 返回 true 时停止；rng 存在时随机化候选顺序（用于生成完整答案）
   * 返回 false 表示初始盘面自相矛盾
   */
  function search(grid, onSolution, rng) {
    var g = grid.slice();
    var rows = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    var cols = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    var boxes = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < 81; i++) {
      var v = g[i];
      if (!v) continue;
      var bit = 1 << v;
      if ((rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & bit) return false;
      rows[ROW[i]] |= bit; cols[COL[i]] |= bit; boxes[BOX[i]] |= bit;
    }
    var stop = false;

    function step() {
      var best = -1;
      var bestMask = 0;
      var bestCount = 10;
      for (var k = 0; k < 81; k++) {
        if (g[k]) continue;
        var mask = ALL & ~(rows[ROW[k]] | cols[COL[k]] | boxes[BOX[k]]);
        var cnt = popcount(mask);
        if (cnt === 0) return;      // 死路
        if (cnt < bestCount) {
          best = k; bestMask = mask; bestCount = cnt;
          if (cnt === 1) break;
        }
      }
      if (best === -1) {           // 已填满：找到一个解
        if (onSolution(g)) stop = true;
        return;
      }
      var digits = [];
      for (var d = 1; d <= 9; d++) if (bestMask & (1 << d)) digits.push(d);
      if (rng) shuffle(digits, rng);
      var r = ROW[best], c = COL[best], b = BOX[best];
      for (var m = 0; m < digits.length && !stop; m++) {
        var bit2 = 1 << digits[m];
        g[best] = digits[m];
        rows[r] |= bit2; cols[c] |= bit2; boxes[b] |= bit2;
        step();
        rows[r] &= ~bit2; cols[c] &= ~bit2; boxes[b] &= ~bit2;
      }
      g[best] = 0;
    }

    step();
    return true;
  }

  /** 解的个数，最多数到 limit 为止 */
  function countSolutions(grid, limit) {
    limit = limit || 2;
    if (!isGrid(grid, true)) return 0;
    var count = 0;
    search(grid, function () { count++; return count >= limit; });
    return count;
  }

  /** 求一个解；无解返回 null */
  function solve(grid) {
    if (!isGrid(grid, true)) return null;
    var found = null;
    search(grid, function (g) { found = g.slice(); return true; });
    return found;
  }

  /** 随机生成一个完整合法答案 */
  function randomSolution(rng) {
    var found = null;
    search(new Array(81).fill(0), function (g) { found = g.slice(); return true; }, rng);
    return found;
  }

  /** 完整且符合规则的答案 */
  function isValidSolution(grid) {
    if (!isGrid(grid, false)) return false;
    return conflicts(grid).length === 0;
  }

  /** 与同行 / 列 / 宫其他格子数字重复的格子下标（空格不计） */
  function conflicts(grid) {
    var out = [];
    for (var i = 0; i < 81; i++) {
      var v = grid[i];
      if (!v) continue;
      var peers = PEERS[i];
      for (var k = 0; k < peers.length; k++) {
        if (grid[peers[k]] === v) { out.push(i); break; }
      }
    }
    return out;
  }

  /** 对一个完整答案按随机顺序挖空到目标提示数，始终保持唯一解 */
  function dig(solution, target, rng, deadline) {
    var puzzle = solution.slice();
    var clues = 81;
    var order = shuffle(Array.from({ length: 81 }, function (_, k) { return k; }), rng);
    for (var k = 0; k < order.length && clues > target; k++) {
      if (now() > deadline) break;
      var idx = order[k];
      var keep = puzzle[idx];
      puzzle[idx] = 0;
      if (countSolutions(puzzle, 2) === 1) clues--;
      else puzzle[idx] = keep;
    }
    return { puzzle: puzzle, clues: clues };
  }

  /**
   * 生成题目：{ puzzle, solution, clues, difficulty }
   * 达不到目标提示数时，返回在时间预算内提示最少的唯一解题目
   */
  function generate(difficulty, rng) {
    var range = TARGET_CLUES[difficulty];
    if (!range) throw new Error('unknown difficulty: ' + difficulty);
    rng = typeof rng === 'function' ? rng : Math.random;
    var start = now();
    var best = null;
    do {
      var attemptStart = now();
      var target = range[0] + Math.floor(rng() * (range[1] - range[0] + 1));
      var solution = randomSolution(rng);
      var res = dig(solution, target, rng, Math.min(attemptStart + ATTEMPT_BUDGET_MS, start + TOTAL_BUDGET_MS));
      if (!best || res.clues < best.clues) best = { puzzle: res.puzzle, solution: solution, clues: res.clues };
      if (res.clues <= range[1]) break;
    } while (now() - start < TOTAL_BUDGET_MS);
    best.difficulty = difficulty;
    return best;
  }

  /**
   * 校验并规范化存档：题目与答案一致、答案合法、给定格不可被改动、笔记为 1..9 位掩码
   * 返回规范化后的状态或 null
   */
  function validateState(s) {
    if (!s || typeof s !== 'object' || !TARGET_CLUES[s.difficulty]) return null;
    if (!isGrid(s.puzzle, true) || !isValidSolution(s.solution) || !isGrid(s.values, true)) return null;
    if (!Array.isArray(s.notes) || s.notes.length !== 81) return null;
    var clues = 0;
    for (var i = 0; i < 81; i++) {
      if (s.puzzle[i]) {
        clues++;
        if (s.puzzle[i] !== s.solution[i] || s.values[i] !== s.puzzle[i]) return null;
      }
      var n = s.notes[i];
      if (!Number.isInteger(n) || (n & ~ALL) !== 0) return null;
    }
    if (clues < 17) return null; // 少于 17 个提示的数独不可能有唯一解
    return {
      difficulty: s.difficulty,
      puzzle: s.puzzle.slice(),
      solution: s.solution.slice(),
      values: s.values.slice(),
      notes: s.notes.slice()
    };
  }

  var Sudoku = {
    TARGET_CLUES: TARGET_CLUES,
    PEERS: PEERS,
    ROW: ROW,
    COL: COL,
    BOX: BOX,
    generate: generate,
    solve: solve,
    countSolutions: countSolutions,
    conflicts: conflicts,
    isValidSolution: isValidSolution,
    validateState: validateState
  };

  global.Sudoku = Sudoku;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sudoku;
})(typeof window !== 'undefined' ? window : globalThis);
