/**
 * 数字华容道视图层 —— 渲染、手势、计时计步、最佳纪录、存档、UI 状态
 */
(function () {
  'use strict';

  var storage = MGStorage.create('huarong_');
  var SETTINGS_KEY = 'settings';
  var SAVE_KEY = 'save';
  var VALID_SIZES = [3, 4, 5, 6, 7, 8, 9, 10]; // 保留旧 9×9、10×10 对局的恢复能力
  var NEW_SIZES = [3, 4, 5, 6, 7, 8];

  /* 设置档位表 */
  var SENSITIVITY = { low: 32, standard: 20, high: 12 }; // 滑动判定阈值(px)
  var ANIMS = {                                          // css 过渡时长 + 全局动效倍率
    fast: { css: '0.08s', scale: 0.75 },
    standard: { css: '0.11s', scale: 1 },
    slow: { css: '0.16s', scale: 1.45 }
  };

  var boardEl = document.getElementById('board');
  var gridCellsEl = document.getElementById('grid-cells');
  var tilesEl = document.getElementById('tiles');
  var movesEl = document.getElementById('moves');
  var movesBoxEl = document.getElementById('moves-box');
  var timeEl = document.getElementById('time');
  var bestEl = document.getElementById('best');
  var hintEl = document.getElementById('hint');
  var winEl = document.getElementById('win-modal');
  var winMovesEl = document.getElementById('win-moves');
  var winTimeEl = document.getElementById('win-time');
  var winBestEl = document.getElementById('win-best');
  var winRecordEl = document.getElementById('win-record');
  var btnWinRetry = document.getElementById('btn-win-retry');
  var btnWinHome = document.getElementById('btn-win-home');
  var btnHome = document.getElementById('btn-home');
  var btnNew = document.getElementById('btn-new');
  var btnUndo = document.getElementById('btn-undo');
  var btnSettings = document.getElementById('btn-settings');
  var startScreenEl = document.getElementById('start-screen');
  var startSizeGrid = document.getElementById('start-size-grid');
  var btnStart = document.getElementById('btn-start');
  var btnStartHome = document.getElementById('btn-start-home');
  var settingsModal = document.getElementById('settings-modal');
  var btnSettingsClose = document.getElementById('btn-settings-close');

  /* ---------- 设置：按选项表加载 / 校验（弹窗与持久化由 MGShell 负责） ---------- */
  var SETTINGS_SCHEMA = {
    sensitivity: { options: Object.keys(SENSITIVITY), def: 'standard' },
    animSpeed: { options: Object.keys(ANIMS), def: 'standard' }
  };
  var settings = MGShell.loadSettings(storage, SETTINGS_KEY, SETTINGS_SCHEMA);

  function applyAnimSpeed() {
    var a = ANIMS[settings.animSpeed];
    document.documentElement.style.setProperty('--tile-ms', a.css);
    MGMotion.setScale(a.scale);
  }

  /* ---------- 存档：校验 / 恢复（棋盘结构校验交给引擎严格校验） ---------- */
  function loadSave() {
    var s = storage.get(SAVE_KEY, null);
    if (!s || typeof s !== 'object') return null;
    if (VALID_SIZES.indexOf(s.size) === -1) return null;
    if (!Number.isInteger(s.moves) || s.moves < 0) return null;
    if (typeof s.elapsed !== 'number' || !(s.elapsed >= 0)) return null;
    if (s.won === true) return null; // 已完成对局不恢复（正常情况下胜利时存档已清除）
    return s;
  }

  /* ---------- 运行状态 ---------- */
  var save = loadSave();
  var size = save ? save.size : storage.get('last_size', 4);
  if (VALID_SIZES.indexOf(size) === -1) size = 4;
  else if (!save && NEW_SIZES.indexOf(size) === -1) size = 8;
  var game = new HuarongDao(size);
  var best = storage.get('best_' + size, 0); // 当前尺寸最少步数纪录，0 表示无纪录
  var restored = false;
  var finished = false;    // 本局已完成（胜利弹窗后）
  var tileEls = new Map(); // value -> 外层定位元素（每个数值仅一块）
  var metrics = null;      // { boardW, gap, cell }
  // 本局用时（秒）：公共计时器每秒刷新显示
  var timer = MGShell.createTimer(function (sec) { timeEl.textContent = MGShell.formatTime(sec); });

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
    return Math.max(12, Math.round(metrics.cell * (value < 10 ? 0.48 : 0.43)));
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
    inner.className = 'tile-inner hr-tile';
    inner.textContent = t.value;
    inner.style.fontSize = fontSizeFor(t.value) + 'px';
    el.appendChild(inner);
    sizeAndPlace(el, t.row, t.col);
    return el;
  }

  /** 全量重建（新局/换尺寸/撤销/首屏） */
  function renderAll(animate) {
    metrics = computeMetrics();
    buildGridCells();
    tilesEl.innerHTML = '';
    tilesEl.classList.remove('celebrate');
    boardEl.classList.remove('celebrate');
    tileEls.clear();
    var tiles = game.tiles();
    for (var i = 0; i < tiles.length; i++) {
      var el = createTileEl(tiles[i]);
      if (animate) el.classList.add('tile-new');
      tilesEl.appendChild(el);
      tileEls.set(tiles[i].value, el);
    }
  }

  /** 增量渲染：仅本次移动的块换位置（transform 过渡并行补间，连滑多块同时动画） */
  function renderSlide(tiles) {
    for (var i = 0; i < tiles.length; i++) {
      var el = tileEls.get(tiles[i].value);
      if (!el) { renderAll(false); return; }
      place(el, Math.floor(tiles[i].to / size), tiles[i].to % size);
    }
  }

  /* ---------- 统计与计时 ---------- */
  function refreshStats(bumpMoves) {
    movesEl.textContent = game.moves;
    if (bumpMoves) MGShell.restartClass(movesBoxEl, 'bump');
    timeEl.textContent = MGShell.formatTime(timer.elapsed());
    bestEl.textContent = best > 0 ? best : '—';
  }

  function startTimer() {
    if (!finished) timer.start();
  }

  /* ---------- 存档 ---------- */
  function isStartVisible() {
    return startScreen.isVisible();
  }

  function saveGame() {
    if (isStartVisible() || finished) return; // 开始页可见/对局已结束时不写存档
    storage.set(SAVE_KEY, {
      size: size,
      board: game.board,
      moves: game.moves,
      elapsed: timer.elapsed(),
      snapshot: game.snapshot ? { board: game.snapshot.board, moves: game.snapshot.moves } : null,
      ts: Date.now()
    });
  }

  /* ---------- 胜利 ---------- */
  function finishGame() {
    finished = true;
    timer.stop();
    MGHaptics.success();
    storage.remove(SAVE_KEY); // 对局结束，清除存档
    var isRecord = best === 0 || game.moves < best;
    if (isRecord) {
      best = game.moves;
      storage.set('best_' + size, best);
    }
    // 庆祝动效：金色光晕 + 全部滑块弹跳
    boardEl.classList.add('celebrate');
    tilesEl.classList.add('celebrate');
    refreshStats(false);
    winMovesEl.textContent = game.moves + ' 步';
    winTimeEl.textContent = MGShell.formatTime(timer.elapsed());
    winBestEl.textContent = best + ' 步';
    winRecordEl.style.display = isRecord ? '' : 'none';
    setTimeout(function () { MGModal.open(winEl); }, MGMotion.duration(520)); // 先看庆祝动效再弹窗（减少动态效果时立即弹出）
  }

  /* ---------- 游戏操作 ---------- */
  function afterMove(result) {
    if (!result.moved) return;
    MGHaptics.light();
    startTimer(); // 首次移动启动计时
    renderSlide(result.tiles);
    refreshStats(true);
    saveGame();
    if (game.isSolved()) finishGame();
  }

  function doSlide(dir) {
    if (finished) return;
    afterMove(game.slide(dir));
  }

  /** 屏幕坐标 → 格子下标（-1 表示棋盘外或间隙） */
  function cellFromPoint(x, y) {
    var rect = boardEl.getBoundingClientRect();
    var px = x - rect.left;
    var py = y - rect.top;
    if (px < metrics.gap || py < metrics.gap) return -1;
    var col = Math.floor((px - metrics.gap) / (metrics.cell + metrics.gap));
    var row = Math.floor((py - metrics.gap) / (metrics.cell + metrics.gap));
    if (row < 0 || col < 0 || row >= size || col >= size) return -1;
    var inX = (px - metrics.gap) - col * (metrics.cell + metrics.gap);
    var inY = (py - metrics.gap) - row * (metrics.cell + metrics.gap);
    if (inX > metrics.cell || inY > metrics.cell) return -1; // 点在格子间隙
    return row * size + col;
  }

  /** 点按：命中与空格相邻的块则移入空格 */
  function doTap(x, y) {
    if (finished) return;
    var index = cellFromPoint(x, y);
    if (index < 0) return;
    afterMove(game.tapCell(index));
  }

  function newGame() {
    finished = false;
    timer.reset(0);
    game.reset();
    MGModal.close(winEl);
    renderAll(true);
    refreshStats(false);
    saveGame();
  }

  function switchSize(n) {
    if (n === size) return;
    size = n;
    storage.set('last_size', size);
    game = new HuarongDao(size);
    best = storage.get('best_' + size, 0);
    finished = false;
    timer.reset(0);
    MGModal.close(winEl);
    renderAll(true);
    refreshStats(false);
    saveGame();
  }

  /* ---------- 开始页（公共组件）：新局只允许 3–8，仍兼容恢复旧版 9×9、10×10 存档 ---------- */
  var startScreen = MGShell.createStartScreen({
    el: startScreenEl,
    grid: startSizeGrid,
    startBtn: btnStart,
    homeBtn: btnStartHome,
    allowed: NEW_SIZES,
    fallback: 8,
    storage: storage,
    rememberKey: 'last_size',
    // 打开前先保存进行中的对局并暂停计时（必须在开始页标记可见之前保存）
    onBeforeShow: function () {
      if (game.moves > 0 || timer.running()) saveGame();
      timer.stop();
    },
    onStart: function (n) {
      if (n === size) newGame();
      else switchSize(n);
    }
  });

  /* ---------- 设置弹窗（公共设置面板，含全局震动开关） ---------- */
  var settingsPanel = MGShell.createSettingsPanel({
    modal: settingsModal,
    closeBtn: btnSettingsClose,
    settings: settings,
    schema: SETTINGS_SCHEMA,
    storage: storage,
    key: SETTINGS_KEY,
    onChange: function (name, value) {
      if (name === 'sensitivity') swipe.setThreshold(SENSITIVITY[value]);
      else if (name === 'animSpeed') applyAnimSpeed();
    }
  });

  /* ---------- 手势：公共滑动识别器（触摸与鼠标统一处理） ---------- */
  function gestureBlocked(target) {
    if (isStartVisible()) return true;
    if (MGModal.isOpen(winEl) || settingsPanel.isOpen()) return true;
    return !!(target && target.closest && target.closest('button'));
  }

  var swipe = MGSwipe.create({
    threshold: SENSITIVITY[settings.sensitivity],
    isBlocked: gestureBlocked,
    onSwipe: doSlide,
    onTap: doTap
  });

  /* ---------- 键盘（浏览器调试用） ---------- */
  MGShell.bindKeys({
    isBlocked: isStartVisible,
    settings: settingsPanel,
    overlays: [winEl],
    onDirection: doSlide
  });

  /* ---------- 按钮 ---------- */
  btnHome.addEventListener('click', function () { MGShell.goHome(saveGame); });
  btnNew.addEventListener('click', function () { startScreen.show(size); }); // 新游戏先弹开始页选棋盘尺寸
  btnWinRetry.addEventListener('click', newGame);    // 胜利弹窗：同尺寸直接重开
  btnWinHome.addEventListener('click', function () { MGShell.goHome(); });
  btnUndo.addEventListener('click', function () {
    if (finished) return;
    if (game.undo()) {
      MGModal.close(winEl);
      renderAll(false);
      refreshStats(false);
      saveGame(); // 撤销回退棋盘与步数（用时继续累计）
    }
  });
  btnSettings.addEventListener('click', settingsPanel.open);

  /* ---------- 离开页面前补存进度 / 页面隐藏暂停计时 ---------- */
  MGShell.bindLifecycle({
    save: saveGame,
    onHide: timer.stop,
    onShow: function () {
      if (!isStartVisible() && !finished && game.moves > 0) startTimer();
    }
  });

  /* ---------- 窗口尺寸变化时重排 ---------- */
  function reflow() {
    metrics = computeMetrics();
    buildGridCells();
    var tiles = game.tiles();
    for (var i = 0; i < tiles.length; i++) {
      var el = tileEls.get(tiles[i].value);
      if (el) {
        sizeAndPlace(el, tiles[i].row, tiles[i].col);
        el.firstChild.style.fontSize = fontSizeFor(tiles[i].value) + 'px';
      }
    }
  }
  window.addEventListener('resize', reflow);

  /* ---------- 初始化 ---------- */
  applyAnimSpeed();
  if (save && game.restore(save)) {
    restored = true;
    timer.reset(save.elapsed);
  }
  refreshStats(false);
  renderAll(!restored); // 恢复存档不播出现动画，新局播放
  if (restored) {
    if (game.moves > 0) startTimer(); // 恢复进行中的对局继续计时
  } else {
    startScreen.show(size); // 无合法存档进开始页选尺寸
  }

  // 调试/自动化测试钩子
  window.__debugHuarong = {
    get game() { return game; },
    get settings() { return settings; },
    get elapsed() { return timer.elapsed(); },
    get best() { return best; },
    get finished() { return finished; },
    get startVisible() { return isStartVisible(); },
    render: renderAll,
    doSlide: doSlide,
    doTap: doTap,
    saveGame: saveGame
  };
})();
