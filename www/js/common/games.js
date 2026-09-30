/**
 * 游戏注册表 —— 合集中每款游戏只在这里登记一次：名称、入口、存储前缀、主页 logo、进度摘要
 * summarize(get) 为纯函数：get(key, fallback) 读取该游戏命名空间下的本地存档（直接解析各游戏已有格式）
 * 返回 { kind: 'resume' | 'best', text } 或 null（从未玩过 / 数据异常 → 主页卡片显示简介）
 * 兼容 Node 测试：module.exports 导出 { GAMES, formatTime }
 */
(function (global) {
  'use strict';

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec) || 0);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var mmss = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    return h > 0 ? h + ':' + mmss : mmss;
  }

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isCount(v) { return Number.isInteger(v) && v >= 0; }
  function isSeconds(v) { return typeof v === 'number' && isFinite(v) && v >= 0; }
  function sizeLabel(n) { return n + '×' + n; }

  /** 挑选要展示的最佳纪录：优先上次选择的档位，否则取第一个有纪录的档位 */
  function pickBest(get, keys, preferred, isValid) {
    var order = preferred !== undefined && keys.indexOf(preferred) !== -1
      ? [preferred].concat(keys.filter(function (k) { return k !== preferred; }))
      : keys;
    for (var i = 0; i < order.length; i++) {
      var v = get('best_' + order[i], null);
      if (isValid(v)) return { key: order[i], value: v };
    }
    return null;
  }

  /* ---------- 2048：存档 game2048_save { size, grid, score }；最高分 best_<size> ---------- */
  var SIZES_2048 = [3, 4, 5, 6];

  function over2048(grid, size) {
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var t = grid[r][c];
        if (!t) return false;
        var right = c + 1 < size ? grid[r][c + 1] : null;
        var down = r + 1 < size ? grid[r + 1][c] : null;
        if ((right && right.value === t.value) || (down && down.value === t.value)) return false;
      }
    }
    return true;
  }

  function summarize2048(get) {
    var s = get('save', null);
    if (isObj(s) && SIZES_2048.indexOf(s.size) !== -1 && isSeconds(s.score) && Array.isArray(s.grid) &&
        s.grid.length === s.size && s.grid.every(function (row) { return Array.isArray(row) && row.length === s.size; })) {
      var tiles = 0;
      s.grid.forEach(function (row) { row.forEach(function (t) { if (t) tiles++; }); });
      var started = s.score > 0 || tiles > 2;
      if (started && !over2048(s.grid, s.size)) {
        return { kind: 'resume', text: '继续 · ' + sizeLabel(s.size) + ' · ' + s.score + ' 分' };
      }
    }
    var best = pickBest(get, SIZES_2048, get('last_size', null), function (v) { return isCount(v) && v > 0; });
    return best ? { kind: 'best', text: '最高分 ' + best.value + ' · ' + sizeLabel(best.key) } : null;
  }

  /* ---------- 数字华容道：存档 huarong_save { size, moves, elapsed }；最少步数 best_<size> ---------- */
  var SIZES_HR = [3, 4, 5, 6, 7, 8, 9, 10];

  function summarizeHuarong(get) {
    var s = get('save', null);
    if (isObj(s) && SIZES_HR.indexOf(s.size) !== -1 && isCount(s.moves) && s.moves > 0 && isSeconds(s.elapsed) && s.won !== true) {
      return { kind: 'resume', text: '继续 · ' + sizeLabel(s.size) + ' · ' + s.moves + ' 步 · ' + formatTime(s.elapsed) };
    }
    var best = pickBest(get, SIZES_HR, get('last_size', null), function (v) { return isCount(v) && v > 0; });
    return best ? { kind: 'best', text: sizeLabel(best.key) + ' 最佳 ' + best.value + ' 步' } : null;
  }

  /* ---------- 扫雷：存档 minesweeper_save { level, state, elapsed }；最短用时 best_<level>（秒） ---------- */
  var MS_LEVELS = ['beginner', 'intermediate', 'expert'];
  var MS_LABELS = { beginner: '初级', intermediate: '中级', expert: '高级' };

  function summarizeMinesweeper(get) {
    var s = get('save', null);
    if (isObj(s) && MS_LEVELS.indexOf(s.level) !== -1 && s.state === 'playing' && isSeconds(s.elapsed)) {
      return { kind: 'resume', text: '继续 · ' + MS_LABELS[s.level] + ' · ' + formatTime(s.elapsed) };
    }
    var best = pickBest(get, MS_LEVELS, get('last_level', null), function (v) { return isSeconds(v) && v > 0; });
    return best ? { kind: 'best', text: MS_LABELS[best.key] + '最佳 ' + formatTime(best.value) } : null;
  }

  /* ---------- 数独：存档 sudoku_save { difficulty, elapsed }；最短用时 best_<difficulty>（秒） ---------- */
  var SD_LEVELS = ['easy', 'medium', 'hard'];
  var SD_LABELS = { easy: '简单', medium: '中等', hard: '困难' };

  function summarizeSudoku(get) {
    var s = get('save', null);
    if (isObj(s) && SD_LEVELS.indexOf(s.difficulty) !== -1 && isSeconds(s.elapsed) && s.solved !== true) {
      return { kind: 'resume', text: '继续 · ' + SD_LABELS[s.difficulty] + ' · ' + formatTime(s.elapsed) };
    }
    var best = pickBest(get, SD_LEVELS, get('last_difficulty', null), function (v) { return isSeconds(v) && v > 0; });
    return best ? { kind: 'best', text: SD_LABELS[best.key] + '最佳 ' + formatTime(best.value) } : null;
  }

  /* ---------- 主页 logo 数据（配色见 menu.css） ---------- */
  function hrLogoCells() {
    var cells = [];
    for (var v = 1; v <= 8; v++) cells.push({ text: String(v) });
    cells.push({ text: '', cls: 'hr-blank' });
    return cells;
  }

  var GAMES = [
    {
      id: '2048',
      name: '2048',
      desc: '滑动合并相同数字，冲击 2048',
      url: '2048/',
      storagePrefix: 'game2048_',
      accent: '#a0602c',
      logo: 'card-logo-2048',
      cells: [
        { text: '2', cls: 'l2' },
        { text: '0', cls: 'l0' },
        { text: '4', cls: 'l4' },
        { text: '8', cls: 'l8' }
      ],
      summarize: summarize2048
    },
    {
      id: 'huarongdao',
      name: '数字华容道',
      desc: '滑动方块，将数字按顺序复原',
      url: 'huarongdao/',
      storagePrefix: 'huarong_',
      accent: '#785d46',
      logo: 'card-logo-hr',
      cells: hrLogoCells(),
      summarize: summarizeHuarong
    },
    {
      id: 'minesweeper',
      name: '扫雷',
      desc: '根据数字推理，避开所有地雷',
      url: 'minesweeper/',
      storagePrefix: 'minesweeper_',
      accent: '#5e7d62',
      logo: 'card-logo-ms',
      cells: [
        { text: '1', cls: 'open n1' }, { text: '', cls: 'open' }, { text: '1', cls: 'open n1' },
        { text: '2', cls: 'open n2' }, { text: '', cls: 'flag' }, { text: '', cls: 'closed' },
        { text: '', cls: 'closed' }, { text: '', cls: 'closed' }, { text: '', cls: 'closed' }
      ],
      summarize: summarizeMinesweeper
    },
    {
      id: 'sudoku',
      name: '数独',
      desc: '在每行、每列、每宫填入 1–9',
      url: 'sudoku/',
      storagePrefix: 'sudoku_',
      accent: '#4d6b7d',
      logo: 'card-logo-sd',
      cells: [
        { text: '5' }, { text: '' }, { text: '3', cls: 'given' },
        { text: '' }, { text: '7', cls: 'given' }, { text: '' },
        { text: '9', cls: 'given' }, { text: '' }, { text: '1' }
      ],
      summarize: summarizeSudoku
    }
  ];

  var api = { GAMES: GAMES, formatTime: formatTime };
  global.MGGames = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
