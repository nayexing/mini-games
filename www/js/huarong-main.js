/**
 * 数字华容道视图层 —— 渲染、手势、计时计步、最佳纪录、存档、UI 状态
 */
(function () {
  'use strict';

  var storage = MGStorage.create('huarong_');
  var SETTINGS_KEY = 'settings';
  var SAVE_KEY = 'save';
  var VALID_SIZES = [3, 4, 5, 6, 7, 8, 9, 10];

  /* 设置档位表 */
  var SENSITIVITY = { low: 32, standard: 20, high: 12 }; // 滑动判定阈值(px)
  var ANIMS = {                                          // css 过渡时长
    fast: { css: '0.08s' },
    standard: { css: '0.11s' },
    slow: { css: '0.16s' }
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

  /* ---------- 设置：加载 / 校验 / 应用 / 持久化 ---------- */
  function loadSettings() {
    var def = { sensitivity: 'standard', animSpeed: 'standard' };
    var s = storage.get(SETTINGS_KEY, null);
    if (!s || typeof s !== 'object') return def;
    return {
      sensitivity: SENSITIVITY[s.sensitivity] !== undefined ? s.sensitivity : def.sensitivity,
      animSpeed: ANIMS[s.animSpeed] !== undefined ? s.animSpeed : def.animSpeed
    };
  }

  var settings = loadSettings();

  function applyAnimSpeed() {
    document.documentElement.style.setProperty('--tile-ms', ANIMS[settings.animSpeed].css);
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
  var game = new HuarongDao(size);
  var best = storage.get('best_' + size, 0); // 当前尺寸最少步数纪录，0 表示无纪录
  var elapsed = 0;         // 本局用时（秒）
  var restored = false;
  var finished = false;    // 本局已完成（胜利弹窗后）
  var startScreenVisible = false;
  var pendingSize = size;  // 开始页当前选中的棋盘尺寸
  var tileEls = new Map(); // value -> 外层定位元素（每个数值仅一块）
  var metrics = null;      // { boardW, gap, cell }
  var timerId = null;

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
    return value < 10 ? Math.round(metrics.cell * 0.44) : Math.round(metrics.cell * 0.38);
  }

  /* 统一橡木配色：底色由 CSS .hr-tile（--hr-wood）提供，此处仅保留深棕文字色 */
  var OAK_FG = '#6B4F2E';

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
    inner.style.color = OAK_FG;
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
  function formatTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function refreshStats(bumpMoves) {
    movesEl.textContent = game.moves;
    if (bumpMoves) {
      movesBoxEl.classList.remove('bump');
      void movesBoxEl.offsetWidth; // 重启动画
      movesBoxEl.classList.add('bump');
    }
    timeEl.textContent = formatTime(elapsed);
    bestEl.textContent = best > 0 ? best : '—';
  }

  function startTimer() {
    if (timerId !== null || finished) return;
    timerId = setInterval(function () {
      elapsed++;
      timeEl.textContent = formatTime(elapsed);
    }, 1000);
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  /* ---------- 存档 ---------- */
  function saveGame() {
    if (startScreenVisible || finished) return; // 开始页可见/对局已结束时不写存档
    storage.set(SAVE_KEY, {
      size: size,
      board: game.board,
      moves: game.moves,
      elapsed: elapsed,
      snapshot: game.snapshot ? { board: game.snapshot.board, moves: game.snapshot.moves } : null,
      ts: Date.now()
    });
  }

  /* ---------- 胜利 ---------- */
  function finishGame() {
    finished = true;
    stopTimer();
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
    winTimeEl.textContent = formatTime(elapsed);
    winBestEl.textContent = best + ' 步';
    winRecordEl.style.display = isRecord ? '' : 'none';
    setTimeout(function () { MGModal.open(winEl); }, 520); // 先看庆祝动效再弹窗
  }

  /* ---------- 游戏操作 ---------- */
  function afterMove(result) {
    if (!result.moved) return;
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
    stopTimer();
    elapsed = 0;
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
    stopTimer();
    elapsed = 0;
    MGModal.close(winEl);
    renderAll(true);
    refreshStats(false);
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
    if (!startScreenVisible && (game.moves > 0 || timerId !== null)) saveGame();
    stopTimer();
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

  /* ---------- 手势：公共滑动识别器（触摸与鼠标统一处理） ---------- */
  function gestureBlocked(target) {
    if (startScreenVisible) return true;
    if (MGModal.isOpen(winEl) || MGModal.isOpen(settingsModal)) return true;
    return !!(target && target.closest && target.closest('button'));
  }

  var swipe = MGSwipe.create({
    threshold: SENSITIVITY[settings.sensitivity],
    isBlocked: gestureBlocked,
    onSwipe: doSlide,
    onTap: doTap
  });

  /* ---------- 键盘（浏览器调试用） ---------- */
  var KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', a: 'left', s: 'down', d: 'right',
    W: 'up', A: 'left', S: 'down', D: 'right'
  };
  document.addEventListener('keydown', function (e) {
    if (startScreenVisible) return;
    if (MGModal.isOpen(settingsModal)) {
      if (e.key === 'Escape') MGModal.close(settingsModal);
      return;
    }
    if (MGModal.isOpen(winEl)) return;
    var dir = KEYMAP[e.key];
    if (dir) {
      e.preventDefault();
      doSlide(dir);
    }
  });

  /* ---------- 设置弹窗 ---------- */
  function syncSettingsUI() {
    var groups = settingsModal.querySelectorAll('.setting-group');
    for (var i = 0; i < groups.length; i++) {
      var name = groups[i].dataset.setting;
      var btns = groups[i].querySelectorAll('button[data-value]');
      for (var j = 0; j < btns.length; j++) {
        btns[j].classList.toggle('active', btns[j].dataset.value === String(settings[name]));
      }
    }
  }

  function setSetting(name, value) {
    if (settings[name] === value) return;
    settings[name] = value;
    storage.set(SETTINGS_KEY, settings);
    if (name === 'sensitivity') swipe.setThreshold(SENSITIVITY[value]);
    else if (name === 'animSpeed') applyAnimSpeed();
    syncSettingsUI();
  }

  /* ---------- 按钮 ---------- */
  btnHome.addEventListener('click', function () {
    saveGame();
    window.location.href = '../index.html';
  });
  btnNew.addEventListener('click', showStartScreen); // 新游戏先弹开始页选棋盘尺寸
  btnWinRetry.addEventListener('click', newGame);    // 胜利弹窗：同尺寸直接重开
  btnWinHome.addEventListener('click', function () {
    window.location.href = '../index.html';
  });
  btnUndo.addEventListener('click', function () {
    if (finished) return;
    if (game.undo()) {
      MGModal.close(winEl);
      renderAll(false);
      refreshStats(false);
      saveGame(); // 撤销回退棋盘与步数（用时继续累计）
    }
  });
  btnSettings.addEventListener('click', function () {
    syncSettingsUI();
    MGModal.open(settingsModal);
  });
  btnSettingsClose.addEventListener('click', function () { MGModal.close(settingsModal); });
  settingsModal.addEventListener('click', function (e) {
    if (e.target === settingsModal) MGModal.close(settingsModal); // 点背板关闭
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
  btnStartHome.addEventListener('click', function () {
    window.location.href = '../index.html'; // 返回合集菜单（对局存档保留）
  });

  var settingGroups = settingsModal.querySelectorAll('.setting-group');
  for (var i = 0; i < settingGroups.length; i++) {
    (function (group) {
      group.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-value]');
        if (btn) setSetting(group.dataset.setting, btn.dataset.value);
      });
    })(settingGroups[i]);
  }

  /* ---------- 离开页面前补存进度 / 页面隐藏暂停计时 ---------- */
  window.addEventListener('pagehide', saveGame);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      saveGame();
      stopTimer();
    } else if (!startScreenVisible && !finished && game.moves > 0) {
      startTimer();
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
    elapsed = Math.floor(save.elapsed) || 0;
  }
  refreshStats(false);
  renderAll(!restored); // 恢复存档不播出现动画，新局播放
  if (restored) {
    if (game.moves > 0) startTimer(); // 恢复进行中的对局继续计时
  } else {
    showStartScreen(); // 无合法存档进开始页选尺寸
  }

  // 调试/自动化测试钩子
  window.__debugHuarong = {
    get game() { return game; },
    get settings() { return settings; },
    get elapsed() { return elapsed; },
    get best() { return best; },
    get finished() { return finished; },
    get startVisible() { return startScreenVisible; },
    render: renderAll,
    doSlide: doSlide,
    doTap: doTap,
    saveGame: saveGame
  };
})();
