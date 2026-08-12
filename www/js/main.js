/**
 * 2048 视图交互层 —— 渲染、手势、道具、设置、存档、UI 状态
 */
(function () {
  'use strict';

  var LS_PREFIX = 'game2048_';
  var SETTINGS_KEY = 'settings';
  var SAVE_KEY = 'save';
  var SWIPE_RATIO = 1.2;      // 长轴/短轴比，防对角误判
  var VALID_SIZES = [3, 4, 5, 6];

  /* 设置档位表 */
  var SENSITIVITY = { low: 32, standard: 20, high: 12 };        // 滑动判定阈值(px)
  var DIFFICULTY = { easy: 0.05, standard: 0.1, hard: 0.25, expert: 0.4 }; // 新方块刷 4 概率
  var TARGETS = [1024, 2048, 4096];
  var ANIMS = {                                                 // css 过渡时长 + 手势锁时长（锁须略大于过渡）
    fast: { css: '0.08s', ms: 110 },
    standard: { css: '0.11s', ms: 150 },
    slow: { css: '0.16s', ms: 200 }
  };
  var PROP_NAMES = ['hammer', 'shuffle', 'refresh'];

  var boardEl = document.getElementById('board');
  var gridCellsEl = document.getElementById('grid-cells');
  var tilesEl = document.getElementById('tiles');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var scoreBoxEl = document.getElementById('score-box');
  var hintEl = document.getElementById('hint');
  var overlayEl = document.getElementById('overlay');
  var overlayMsgEl = document.getElementById('overlay-message');
  var btnContinue = document.getElementById('btn-continue');
  var btnRetry = document.getElementById('btn-retry');
  var btnHome = document.getElementById('btn-home');
  var btnNew = document.getElementById('btn-new');
  var btnUndo = document.getElementById('btn-undo');
  var btnSettings = document.getElementById('btn-settings');
  var startScreenEl = document.getElementById('start-screen');
  var startSizeGrid = document.getElementById('start-size-grid');
  var btnStart = document.getElementById('btn-start');
  var settingsModal = document.getElementById('settings-modal');
  var btnSettingsClose = document.getElementById('btn-settings-close');
  var difficultyNote = document.getElementById('difficulty-note');
  var toolBtns = {
    hammer: document.getElementById('tool-hammer'),
    shuffle: document.getElementById('tool-shuffle'),
    refresh: document.getElementById('tool-refresh')
  };

  /* ---------- 本地存储（异常降级为内存态，不阻断游戏） ---------- */
  var storage = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(LS_PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set: function (key, value) {
      try {
        localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
      } catch (e) { /* 隐私模式等场景下静默降级 */ }
    },
    remove: function (key) {
      try {
        localStorage.removeItem(LS_PREFIX + key);
      } catch (e) { /* 静默降级 */ }
    }
  };

  /* ---------- 设置：加载 / 校验 / 应用 / 持久化 ---------- */
  function loadSettings() {
    var def = { sensitivity: 'standard', difficulty: 'standard', target: 2048, animSpeed: 'standard' };
    var s = storage.get(SETTINGS_KEY, null);
    if (!s || typeof s !== 'object') return def;
    return {
      sensitivity: SENSITIVITY[s.sensitivity] !== undefined ? s.sensitivity : def.sensitivity,
      difficulty: DIFFICULTY[s.difficulty] !== undefined ? s.difficulty : def.difficulty,
      target: TARGETS.indexOf(s.target) !== -1 ? s.target : def.target,
      animSpeed: ANIMS[s.animSpeed] !== undefined ? s.animSpeed : def.animSpeed
    };
  }

  var settings = loadSettings();
  var SWIPE_THRESHOLD = SENSITIVITY[settings.sensitivity]; // 灵敏度档位：立即生效
  var ANIM_MS = ANIMS[settings.animSpeed].ms;              // 动画速度档位：立即生效

  function applyAnimSpeed() {
    var a = ANIMS[settings.animSpeed];
    ANIM_MS = a.ms;
    document.documentElement.style.setProperty('--tile-ms', a.css);
  }

  /* ---------- 存档：校验 / 恢复 ---------- */
  function loadSave() {
    var s = storage.get(SAVE_KEY, null);
    if (!s || typeof s !== 'object') return null;
    if (VALID_SIZES.indexOf(s.size) === -1) return null;
    if (!Array.isArray(s.grid) || s.grid.length !== s.size) return null;
    for (var r = 0; r < s.size; r++) {
      var row = s.grid[r];
      if (!Array.isArray(row) || row.length !== s.size) return null;
      for (var c = 0; c < s.size; c++) {
        var t = row[c];
        if (t === null) continue;
        if (!t || typeof t !== 'object') return null;
        if (!Number.isInteger(t.id) || t.id < 1) return null;
        if (!Number.isInteger(t.value) || t.value < 2 || (t.value & (t.value - 1)) !== 0) return null;
      }
    }
    if (typeof s.score !== 'number' || !(s.score >= 0)) return null;
    return s;
  }

  /* ---------- 运行状态 ---------- */
  var save = loadSave();
  var size = save ? save.size : storage.get('last_size', 4);
  if (VALID_SIZES.indexOf(size) === -1) size = 4;
  // 当前局实际生效的难度：恢复存档时沿用存档难度，否则用设置难度
  var appliedDifficulty = (save && DIFFICULTY[save.difficulty] !== undefined) ? save.difficulty : settings.difficulty;
  var game = new Game2048(size, DIFFICULTY[appliedDifficulty]);
  var best = storage.get('best_' + size, 0);
  var restored = false;
  var wonShown = false;      // 本局是否已展示过胜利弹窗
  var propsUsed = { hammer: false, shuffle: false, refresh: false };
  if (save && game.restore(save)) {
    restored = true;
    wonShown = save.wonShown === true;
    if (save.propsUsed && typeof save.propsUsed === 'object') {
      propsUsed.hammer = save.propsUsed.hammer === true;
      propsUsed.shuffle = save.propsUsed.shuffle === true;
      propsUsed.refresh = save.propsUsed.refresh === true;
    }
  }
  var startScreenVisible = false; // 开始页显隐：可见时禁止存档与棋盘手势
  var pendingSize = size;    // 开始页当前选中的棋盘尺寸
  var aiming = null;         // 瞄准态：null | 'hammer' | 'refresh'
  var tileEls = new Map();   // id -> 外层定位元素
  var pendingRemoval = [];   // 待移除的被合并方块 id
  var metrics = null;        // { boardW, gap, cell }
  var lock = false;          // 手势锁
  var queuedDir = null;      // 锁期间暂存的滑动方向（只保留最后一个，解锁后立即补执行）

  /* ---------- 布局度量 ---------- */
  function computeMetrics() {
    var boardW = boardEl.clientWidth;
    var gap = Math.max(6, Math.round(boardW * 0.025));
    var cell = (boardW - gap * (size + 1)) / size;
    return { boardW: boardW, gap: gap, cell: cell };
  }

  function tilePos(row, col) {
    return {
      x: metrics.gap + col * (metrics.cell + metrics.gap),
      y: metrics.gap + row * (metrics.cell + metrics.gap)
    };
  }

  function fontSizeFor(value) {
    var digits = String(value).length;
    if (digits <= 2) return Math.round(metrics.cell * 0.44);
    if (digits === 3) return Math.round(metrics.cell * 0.36);
    return Math.round(metrics.cell * 0.3);
  }

  function valueClass(value) {
    return value <= 2048 ? 'tile-' + value : 'tile-super';
  }

  function place(el, row, col) {
    el.dataset.row = row;
    el.dataset.col = col;
    var p = tilePos(row, col);
    el.style.transform = 'translate(' + p.x + 'px, ' + p.y + 'px)';
  }

  function sizeAndPlace(el, row, col) {
    el.style.width = metrics.cell + 'px';
    el.style.height = metrics.cell + 'px';
    place(el, row, col);
  }

  function buildGridCells() {
    gridCellsEl.style.padding = metrics.gap + 'px';
    gridCellsEl.style.gap = metrics.gap + 'px';
    gridCellsEl.style.gridTemplateColumns = 'repeat(' + size + ', 1fr)';
    gridCellsEl.innerHTML = '';
    for (var i = 0; i < size * size; i++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      gridCellsEl.appendChild(cell);
    }
  }

  /* ---------- 渲染 ---------- */
  function createTileEl(t) {
    var el = document.createElement('div');
    el.className = 'tile';
    var inner = document.createElement('div');
    inner.className = 'tile-inner ' + valueClass(t.value);
    inner.textContent = t.value;
    inner.style.fontSize = fontSizeFor(t.value) + 'px';
    el.appendChild(inner);
    sizeAndPlace(el, t.row, t.col);
    return el;
  }

  /** 全量重建（新局/换尺寸/撤销/首屏/锤子） */
  function renderAll(animate) {
    metrics = computeMetrics();
    buildGridCells();
    tilesEl.innerHTML = '';
    tileEls.clear();
    pendingRemoval = [];
    var tiles = game.tiles();
    for (var i = 0; i < tiles.length; i++) {
      var el = createTileEl(tiles[i]);
      if (animate) el.classList.add('tile-new');
      tilesEl.appendChild(el);
      tileEls.set(tiles[i].id, el);
    }
  }

  /** 移动后的增量渲染：存活方块滑动/变色，被合并方块滑向目标后待清除，新方块出现 */
  function renderMove(result) {
    var consumedMap = new Map();
    for (var i = 0; i < result.consumed.length; i++) {
      consumedMap.set(result.consumed[i].id, result.consumed[i]);
    }
    var alive = new Set();
    for (var j = 0; j < result.tiles.length; j++) {
      var t = result.tiles[j];
      alive.add(t.id);
      var el = tileEls.get(t.id);
      if (!el) {
        el = createTileEl(t);
        el.classList.add('tile-new');
        tilesEl.appendChild(el);
        tileEls.set(t.id, el);
      } else {
        var inner = el.firstChild;
        var cls = valueClass(t.value);
        if (!inner.classList.contains(cls)) {
          inner.className = 'tile-inner ' + cls;
          inner.textContent = t.value;
          inner.style.fontSize = fontSizeFor(t.value) + 'px';
        }
        place(el, t.row, t.col);
        el.classList.remove('tile-new');
      }
      if (t.merged) el.classList.add('tile-merged');
    }
    for (var entry of tileEls) {
      var id = entry[0];
      var tileEl = entry[1];
      if (!alive.has(id)) {
        var dest = consumedMap.get(id);
        if (dest) place(tileEl, dest.row, dest.col);
        tileEl.classList.add('tile-consumed');
        pendingRemoval.push(id);
      }
    }
  }

  function cleanupAfterMove() {
    for (var i = 0; i < pendingRemoval.length; i++) {
      var id = pendingRemoval[i];
      var el = tileEls.get(id);
      if (el) el.remove();
      tileEls.delete(id);
    }
    pendingRemoval = [];
    for (var entry of tileEls) {
      entry[1].classList.remove('tile-merged', 'tile-new');
    }
  }

  /* ---------- 分数与最高分 ---------- */
  function refreshScore(gained) {
    scoreEl.textContent = game.score;
    if (gained > 0) {
      scoreBoxEl.classList.remove('bump');
      void scoreBoxEl.offsetWidth; // 重启动画
      scoreBoxEl.classList.add('bump');
    }
    if (game.score > best) {
      best = game.score;
      bestEl.textContent = best;
      storage.set('best_' + size, best);
    }
  }

  /* ---------- 提示文案 ---------- */
  function refreshHint() {
    if (aiming === 'hammer') hintEl.textContent = '点选一个方块将其敲除（点空白处取消）';
    else if (aiming === 'refresh') hintEl.textContent = '点选一个方块重新随机（点空白处取消）';
    else hintEl.textContent = '滑动屏幕，合并相同数字，冲击 ' + settings.target;
  }

  /* ---------- 存档 ---------- */
  function saveGame() {
    if (startScreenVisible) return; // 开始页可见时禁止写存档，防止 pagehide/visibilitychange 补存覆盖「放弃对局」
    storage.set(SAVE_KEY, {
      size: size,
      grid: game.grid,
      score: game.score,
      nextId: game.nextId,
      snapshot: game.snapshot ? { grid: game.snapshot.grid, score: game.snapshot.score } : null,
      wonShown: wonShown,
      propsUsed: propsUsed,
      difficulty: appliedDifficulty,
      ts: Date.now()
    });
  }

  /* ---------- 全屏弹窗：胜负 ---------- */
  function showOverlay(type) {
    overlayEl.className = 'modal-backdrop show ' + type;
    overlayMsgEl.textContent = type === 'win' ? '你赢了！' : '游戏结束';
    btnContinue.style.display = type === 'win' ? '' : 'none';
  }

  function hideOverlay() {
    overlayEl.className = 'modal-backdrop';
  }

  /* ---------- 全屏弹窗：设置 ---------- */
  function syncSettingsUI() {
    var groups = settingsModal.querySelectorAll('.setting-group');
    for (var i = 0; i < groups.length; i++) {
      var name = groups[i].dataset.setting;
      var btns = groups[i].querySelectorAll('button[data-value]');
      for (var j = 0; j < btns.length; j++) {
        btns[j].classList.toggle('active', btns[j].dataset.value === String(settings[name]));
      }
    }
    // 所选难度与当前局生效难度不一致时，提示「新游戏后生效」
    difficultyNote.style.display = settings.difficulty !== appliedDifficulty ? '' : 'none';
  }

  function openSettings() {
    syncSettingsUI();
    settingsModal.classList.add('show');
  }

  function closeSettings() {
    settingsModal.classList.remove('show');
  }

  /** 胜利目标变更：立即重判当前局，避免「永远赢不了」或「赢过不再提示」 */
  function applyTarget() {
    refreshHint();
    if (game.hasTarget(settings.target)) {
      if (!wonShown) {
        wonShown = true;
        saveGame();
        closeSettings();
        setTimeout(function () { showOverlay('win'); }, 240);
      }
    } else if (wonShown) {
      wonShown = false; // 目标调高后重新允许胜利提示
      saveGame();
    }
  }

  function setSetting(name, value) {
    if (name === 'target') value = Number(value);
    if (settings[name] === value) return;
    settings[name] = value;
    storage.set(SETTINGS_KEY, settings);
    if (name === 'sensitivity') SWIPE_THRESHOLD = SENSITIVITY[value];
    else if (name === 'animSpeed') applyAnimSpeed();
    else if (name === 'target') applyTarget();
    // difficulty：仅记录所选值，新一局生效（newGame/switchSize 应用）
    syncSettingsUI();
  }

  /* ---------- 道具 ---------- */
  function updateToolUI() {
    for (var i = 0; i < PROP_NAMES.length; i++) {
      var n = PROP_NAMES[i];
      var btn = toolBtns[n];
      btn.classList.toggle('used', propsUsed[n]);
      btn.classList.toggle('aiming', aiming === n);
      btn.querySelector('.badge').textContent = propsUsed[n] ? '0' : '1';
    }
    boardEl.classList.toggle('aiming', aiming !== null);
    refreshHint();
  }

  function cancelAim() {
    aiming = null;
    updateToolUI();
  }

  function toggleAim(name) {
    if (lock || propsUsed[name]) return;
    aiming = aiming === name ? null : name;
    updateToolUI();
  }

  /** 洗牌：立即生效，存活方块滑向新位置 */
  function useShuffle() {
    if (lock || propsUsed.shuffle) return;
    aiming = null;
    if (!game.shuffleTiles()) { updateToolUI(); return; } // 方块不足时不消耗次数
    propsUsed.shuffle = true;
    renderMove({ tiles: game.tiles(), consumed: [] });
    updateToolUI();
    saveGame();
    if (game.isOver()) showOverlay('lose');
  }

  /** 刷新后单个方块原地更新数值并播放合并动画 */
  function popTileAt(row, col) {
    var t = game.grid[row][col];
    var el = t ? tileEls.get(t.id) : null;
    if (!el) { renderAll(false); return; }
    var inner = el.firstChild;
    inner.className = 'tile-inner ' + valueClass(t.value);
    inner.textContent = t.value;
    inner.style.fontSize = fontSizeFor(t.value) + 'px';
    el.classList.remove('tile-merged');
    void el.offsetWidth; // 重启动画
    el.classList.add('tile-merged');
    setTimeout(function () { el.classList.remove('tile-merged'); }, 300);
  }

  /** 瞄准态点按：由屏幕坐标反推格子，命中方块则执行道具，否则取消瞄准 */
  function handleAimTap(x, y) {
    var rect = boardEl.getBoundingClientRect();
    var px = x - rect.left;
    var py = y - rect.top;
    var row = -1;
    var col = -1;
    if (px >= metrics.gap && py >= metrics.gap) {
      col = Math.floor((px - metrics.gap) / (metrics.cell + metrics.gap));
      row = Math.floor((py - metrics.gap) / (metrics.cell + metrics.gap));
    }
    if (row >= 0 && col >= 0 && row < size && col < size) {
      var inX = (px - metrics.gap) - col * (metrics.cell + metrics.gap);
      var inY = (py - metrics.gap) - row * (metrics.cell + metrics.gap);
      if (inX > metrics.cell || inY > metrics.cell) { row = -1; col = -1; } // 点在格子间隙
    } else {
      row = -1; col = -1;
    }
    var prop = aiming;
    var ok = false;
    if (row >= 0 && col >= 0) {
      if (prop === 'hammer') ok = game.removeTileAt(row, col) !== null;
      else if (prop === 'refresh') ok = game.refreshTileAt(row, col) !== null;
    }
    if (!ok) { cancelAim(); return; } // 点空白格/棋盘外：取消瞄准，不消耗次数
    propsUsed[prop] = true;
    aiming = null;
    if (prop === 'hammer') {
      if (game.tiles().length === 0) game.addRandomTile(); // 敲空棋盘保底，防死锁
      renderAll(true);
    } else {
      popTileAt(row, col);
    }
    updateToolUI();
    saveGame();
    if (game.isOver()) showOverlay('lose');
  }

  /* ---------- 游戏操作 ---------- */
  function doMove(dir) {
    if (lock) {
      queuedDir = dir; // 锁期间不丢弃，只保留最后一个方向
      return;
    }
    var hadTarget = game.hasTarget(settings.target);
    var result = game.move(dir);
    if (!result.moved) return;
    var won = !hadTarget && game.hasTarget(settings.target);
    lock = true;
    renderMove(result);
    refreshScore(result.scoreGained);
    saveGame();
    setTimeout(function () {
      cleanupAfterMove();
      lock = false;
      if (won && !wonShown) {
        wonShown = true;
        saveGame();
        showOverlay('win');
      } else if (result.over) {
        showOverlay('lose');
      }
      if (queuedDir) {
        var next = queuedDir;
        queuedDir = null;
        doMove(next); // 补执行锁期间暂存的手势，形成连划流水线
      }
    }, ANIM_MS);
  }

  function newGame() {
    appliedDifficulty = settings.difficulty; // 难度新一局生效
    game.fourProb = DIFFICULTY[appliedDifficulty];
    game.reset();
    wonShown = false;
    propsUsed = { hammer: false, shuffle: false, refresh: false };
    aiming = null;
    hideOverlay();
    renderAll(true);
    refreshScore(0);
    updateToolUI();
    saveGame();
  }

  function switchSize(n) {
    if (n === size) return;
    size = n;
    storage.set('last_size', size);
    appliedDifficulty = settings.difficulty;
    game = new Game2048(size, DIFFICULTY[appliedDifficulty]);
    best = storage.get('best_' + size, 0);
    wonShown = false;
    propsUsed = { hammer: false, shuffle: false, refresh: false };
    aiming = null;
    hideOverlay();
    bestEl.textContent = best;
    renderAll(true);
    refreshScore(0);
    updateToolUI();
    saveGame();
  }

  /* ---------- 开始页 ---------- */
  function syncStartSizeUI() {
    var btns = startSizeGrid.querySelectorAll('button[data-size]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', Number(btns[i].dataset.size) === pendingSize);
    }
  }

  function showStartScreen() {
    startScreenVisible = true;
    pendingSize = size;
    syncStartSizeUI();
    startScreenEl.classList.add('show');
  }

  function hideStartScreen() {
    startScreenVisible = false;
    startScreenEl.classList.remove('show');
  }

  /** 开始页开局：同尺寸重置当前局，异尺寸走 switchSize 完整换尺寸流程 */
  function startGameWithSize(n) {
    hideStartScreen();
    if (n === size) newGame();
    else switchSize(n);
  }

  /** 主页：放弃当前局（清除存档）返回开始页 */
  function goHome() {
    storage.remove(SAVE_KEY);
    hideOverlay();
    closeSettings();
    cancelAim();
    showStartScreen();
  }

  /* ---------- 手势：整屏滑动 + 鼠标拖拽（触摸与鼠标共享判定逻辑） ---------- */
  var tracking = false;   // 本次手势是否在跟踪中
  var handled = false;    // 本次手势是否已触发过移动（move 阶段触发后置位）
  var startX = 0;
  var startY = 0;

  /** 起点落在按钮上、胜负弹窗或设置弹窗打开时不劫持手势 */
  function gestureBlocked(target) {
    if (startScreenVisible) return true;
    if (overlayEl.classList.contains('show')) return true;
    if (settingsModal.classList.contains('show')) return true;
    return !!(target && target.closest && target.closest('button'));
  }

  function gestureStart(x, y) {
    tracking = true;
    handled = false;
    startX = x;
    startY = y;
  }

  /** 位移超阈值且方向明确立即触发移动，不等抬手；瞄准态下不触发移动 */
  function gestureMove(x, y) {
    if (!tracking || handled) return;
    if (aiming) return;
    var dx = x - startX;
    var dy = y - startY;
    var absX = Math.abs(dx);
    var absY = Math.abs(dy);
    var longAxis = Math.max(absX, absY);
    if (longAxis < SWIPE_THRESHOLD) return;
    if (longAxis < Math.min(absX, absY) * SWIPE_RATIO) return; // 对角方向不明确，等位移加大再判
    handled = true;
    doMove(absX > absY ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  }

  /** 兜底：move 阶段未触发（未达阈值或方向不明）时，结束时终判；瞄准态下位移小于阈值视为点按 */
  function gestureEnd(x, y) {
    if (!tracking) return;
    tracking = false;
    if (handled) return;
    var dx = x - startX;
    var dy = y - startY;
    var absX = Math.abs(dx);
    var absY = Math.abs(dy);
    var longAxis = Math.max(absX, absY);
    if (aiming) {
      if (longAxis < SWIPE_THRESHOLD) handleAimTap(x, y);
      return; // 瞄准态下的滑动不触发移动，避免误操作
    }
    if (longAxis < SWIPE_THRESHOLD) return;
    if (longAxis < Math.min(absX, absY) * SWIPE_RATIO) return;
    doMove(absX > absY ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  }

  document.addEventListener('touchstart', function (e) {
    if (e.touches.length > 1 || gestureBlocked(e.target)) { tracking = false; return; }
    var t = e.touches[0];
    gestureStart(t.clientX, t.clientY);
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!tracking) return;
    e.preventDefault(); // 跟踪中的手势阻止页面滚动/下拉刷新
    var t = e.touches[0];
    gestureMove(t.clientX, t.clientY);
  }, { passive: false });

  document.addEventListener('touchend', function (e) {
    if (!tracking) return;
    var t = e.changedTouches[0];
    gestureEnd(t.clientX, t.clientY);
  }, { passive: true });

  document.addEventListener('touchcancel', function () {
    tracking = false;
  }, { passive: true });

  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || gestureBlocked(e.target)) return;
    gestureStart(e.clientX, e.clientY);
  });

  document.addEventListener('mousemove', function (e) {
    if (!tracking) return;
    gestureMove(e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', function (e) {
    if (!tracking) return;
    gestureEnd(e.clientX, e.clientY);
  });

  /* ---------- 键盘（浏览器调试用） ---------- */
  var KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', a: 'left', s: 'down', d: 'right',
    W: 'up', A: 'left', S: 'down', D: 'right'
  };
  document.addEventListener('keydown', function (e) {
    if (startScreenVisible) return;
    if (settingsModal.classList.contains('show')) {
      if (e.key === 'Escape') closeSettings();
      return;
    }
    if (overlayEl.classList.contains('show')) return;
    if (aiming) {
      if (e.key === 'Escape') cancelAim();
      return;
    }
    var dir = KEYMAP[e.key];
    if (dir) {
      e.preventDefault();
      doMove(dir);
    }
  });

  /* ---------- 按钮 ---------- */
  btnHome.addEventListener('click', goHome);
  btnNew.addEventListener('click', newGame);
  btnRetry.addEventListener('click', newGame);
  btnContinue.addEventListener('click', hideOverlay);
  btnSettings.addEventListener('click', openSettings);
  btnSettingsClose.addEventListener('click', closeSettings);
  settingsModal.addEventListener('click', function (e) {
    if (e.target === settingsModal) closeSettings(); // 点背板关闭
  });
  btnUndo.addEventListener('click', function () {
    if (lock) return;
    if (game.undo()) {
      hideOverlay();
      renderAll(false);
      refreshScore(0);
      saveGame(); // 撤销只回退棋盘，道具次数不返还
    }
  });
  startSizeGrid.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-size]');
    if (!btn) return;
    pendingSize = Number(btn.dataset.size);
    storage.set('last_size', pendingSize); // 记住选择，下次启动开始页默认选中
    syncStartSizeUI();
  });
  btnStart.addEventListener('click', function () {
    startGameWithSize(pendingSize);
  });
  toolBtns.hammer.addEventListener('click', function () { toggleAim('hammer'); });
  toolBtns.refresh.addEventListener('click', function () { toggleAim('refresh'); });
  toolBtns.shuffle.addEventListener('click', useShuffle);

  var settingGroups = settingsModal.querySelectorAll('.setting-group');
  for (var i = 0; i < settingGroups.length; i++) {
    (function (group) {
      group.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-value]');
        if (btn) setSetting(group.dataset.setting, btn.dataset.value);
      });
    })(settingGroups[i]);
  }

  /* ---------- 离开页面前补存进度 ---------- */
  window.addEventListener('pagehide', saveGame);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveGame();
  });

  /* ---------- 窗口尺寸变化时重排 ---------- */
  function reflow() {
    metrics = computeMetrics();
    buildGridCells();
    for (var entry of tileEls) {
      var el = entry[1];
      sizeAndPlace(el, Number(el.dataset.row), Number(el.dataset.col));
      var inner = el.firstChild;
      inner.style.fontSize = fontSizeFor(Number(inner.textContent)) + 'px';
    }
  }
  window.addEventListener('resize', reflow);

  /* ---------- 初始化 ---------- */
  applyAnimSpeed();
  bestEl.textContent = best;
  updateToolUI();
  renderAll(!restored); // 恢复存档不播出现动画，新局播放
  refreshScore(0);
  if (!restored) showStartScreen(); // 启动路由：有合法存档直接恢复对局，无存档进开始页选尺寸

  // 调试/自动化测试钩子
  window.__debug2048 = {
    get game() { return game; },
    get settings() { return settings; },
    get propsUsed() { return propsUsed; },
    get wonShown() { return wonShown; },
    get startVisible() { return startScreenVisible; },
    render: renderAll,
    doMove: doMove,
    saveGame: saveGame
  };
})();
