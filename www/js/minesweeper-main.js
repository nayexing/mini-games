/**
 * 扫雷交互层 —— 棋盘渲染（仅重绘变化格）、点按 / 长按 / 插旗模式、撤销、计时、存档、最佳用时
 */
(function () {
  'use strict';

  var storage = MGStorage.create('minesweeper_');
  var SETTINGS_KEY = 'settings';
  var SAVE_KEY = 'save';
  var LEVELS = Minesweeper.LEVELS;
  var LEVEL_NAMES = ['beginner', 'intermediate', 'expert'];
  var LEVEL_LABELS = { beginner: '初级', intermediate: '中级', expert: '高级' };
  var LONG_PRESS_MS = { short: 300, standard: 420, long: 600 };
  var MOVE_TOLERANCE = 10;   // 按下后移动超过该距离视为滚动，取消本次点按 / 长按
  var MIN_CELL = 21;         // 手机上可点按的最小格子尺寸，超出屏幕时在棋盘区域内滚动
  var MAX_CELL = 44;
  var HISTORY_LIMIT = 100;

  var boardEl = document.getElementById('ms-board');
  var scrollEl = document.getElementById('ms-scroll');
  var wrapEl = scrollEl.parentElement;
  var minesLeftEl = document.getElementById('mines-left');
  var timeEl = document.getElementById('time');
  var bestEl = document.getElementById('best');
  var hintEl = document.getElementById('hint');
  var modeSwitch = document.getElementById('mode-switch');
  var resultModal = document.getElementById('result-modal');
  var resultTitle = document.getElementById('result-title');
  var resultRecord = document.getElementById('result-record');
  var resultNote = document.getElementById('result-note');
  var resultLevel = document.getElementById('result-level');
  var resultTime = document.getElementById('result-time');
  var resultBest = document.getElementById('result-best');
  var btnResultUndo = document.getElementById('btn-result-undo');
  var btnResultRetry = document.getElementById('btn-result-retry');
  var btnNew = document.getElementById('btn-new');
  var btnHome = document.getElementById('btn-home');
  var btnUndo = document.getElementById('btn-undo');
  var btnSettings = document.getElementById('btn-settings');

  /* ---------- 设置 ---------- */
  var SETTINGS_SCHEMA = {
    longPress: { options: Object.keys(LONG_PRESS_MS), def: 'standard' },
    chordTap: { options: ['on', 'off'], def: 'on' }
  };
  var settings = MGShell.loadSettings(storage, SETTINGS_KEY, SETTINGS_SCHEMA);

  /* ---------- 运行状态 ---------- */
  var level = 'beginner';
  var game = null;
  var cellEls = [];
  var history = [];          // 操作前的棋盘快照，用于撤销
  var assisted = false;      // 本局是否撤销过踩雷（胜利时不计入最佳）
  var flagMode = false;
  var best = 0;
  var timer = MGShell.createTimer(function (sec) { timeEl.textContent = MGShell.formatTime(sec); });

  function isPortrait() {
    return window.innerHeight > window.innerWidth;
  }

  /** 高级盘在竖屏开新局时转为 30 行 16 列 */
  function dimsFor(lv) {
    var d = LEVELS[lv];
    if (lv === 'expert' && isPortrait()) return { rows: d.cols, cols: d.rows, mines: d.mines };
    return { rows: d.rows, cols: d.cols, mines: d.mines };
  }

  function loadBest(lv) {
    var v = storage.get('best_' + lv, 0);
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0;
  }

  /* ---------- 存档：校验 / 恢复 ---------- */
  function loadSave() {
    var s = storage.get(SAVE_KEY, null);
    if (!s || typeof s !== 'object' || LEVEL_NAMES.indexOf(s.level) === -1) return null;
    if (typeof s.elapsed !== 'number' || !(s.elapsed >= 0) || !s.board || typeof s.board !== 'object') return null;
    var d = LEVELS[s.level];
    var b = s.board;
    var sameShape = (b.rows === d.rows && b.cols === d.cols) || (b.rows === d.cols && b.cols === d.rows);
    if (!sameShape || b.mines !== d.mines) return null;
    try {
      var g = new Minesweeper(b.rows, b.cols, b.mines);
      if (!g.restore(b)) return null;
      return { level: s.level, game: g, elapsed: s.elapsed, assisted: s.assisted === true };
    } catch (e) {
      return null;
    }
  }

  function isStartVisible() {
    return startScreen.isVisible();
  }

  function saveGame() {
    if (!game || isStartVisible()) return;
    if (game.state === 'won' || game.state === 'lost') return; // 结束的对局不保存
    storage.set(SAVE_KEY, {
      v: 1,
      level: level,
      state: game.state,
      elapsed: timer.elapsed(),
      assisted: assisted,
      board: game.serialize(),
      ts: Date.now()
    });
  }

  /* ---------- 布局：按可用宽高与行列数计算格子尺寸 ---------- */
  function layout() {
    if (!game) return;
    var availW = wrapEl.clientWidth;
    var availH = wrapEl.clientHeight * 0.97;
    var byW = Math.floor((availW - 6 - (game.cols - 1)) / game.cols);
    var byH = Math.floor((availH - 6 - (game.rows - 1)) / game.rows);
    var cell = Math.max(MIN_CELL, Math.min(MAX_CELL, byW, Math.max(byH, MIN_CELL)));
    boardEl.style.setProperty('--ms-cell', cell + 'px');
  }

  /* ---------- 渲染：每个格子只由 renderCell 决定外观 ---------- */
  function buildBoard() {
    var n = game.size();
    var frag = document.createDocumentFragment();
    cellEls = new Array(n);
    for (var i = 0; i < n; i++) {
      var el = document.createElement('div');
      el.className = 'ms-cell';
      el.setAttribute('role', 'gridcell');
      el.dataset.i = i;
      cellEls[i] = el;
      frag.appendChild(el);
    }
    boardEl.textContent = '';
    boardEl.classList.remove('celebrate');
    boardEl.style.setProperty('--ms-cols', game.cols);
    boardEl.appendChild(frag);
    layout();
    renderAll();
    scrollEl.scrollTop = 0;
    scrollEl.scrollLeft = 0;
  }

  function renderCell(i) {
    var v = game.view(i);
    var el = cellEls[i];
    var lost = game.state === 'lost';
    var cls = 'ms-cell';
    var text = '';
    var label;
    if (v.status === 'open') {
      if (v.mine) {
        cls += ' is-mine is-exploded';
        label = '踩到的地雷';
      } else {
        cls += ' is-open';
        if (v.count) {
          cls += ' has-count n' + v.count;
          text = String(v.count);
        }
        label = v.count ? '周围 ' + v.count + ' 颗雷' : '空白';
      }
    } else if (v.status === 'flag') {
      cls += lost && !v.mine ? ' is-wrong' : ' is-flag';
      label = lost && !v.mine ? '插错的旗' : '旗子';
    } else if (lost && v.mine) {
      cls += ' is-mine';
      label = '地雷';
    } else {
      label = '未翻开';
    }
    el.className = cls;
    el.textContent = text;
    if (cls.indexOf('is-wrong') !== -1) {
      var cross = document.createElement('span');
      cross.className = 'ms-cross';
      el.appendChild(cross);
    }
    el.setAttribute('aria-label', (Math.floor(i / game.cols) + 1) + ' 行 ' + (i % game.cols + 1) + ' 列，' + label);
  }

  function renderChanged(list) {
    for (var k = 0; k < list.length; k++) renderCell(list[k]);
  }

  function renderAll() {
    for (var i = 0; i < cellEls.length; i++) renderCell(i);
  }

  function refreshStats() {
    minesLeftEl.textContent = game.remaining();
    timeEl.textContent = MGShell.formatTime(timer.elapsed());
    bestEl.textContent = best > 0 ? MGShell.formatTime(best) : '—';
  }

  function refreshHint() {
    var chord = settings.chordTap === 'on' ? '；点已翻开的数字可快速翻开周围' : '';
    hintEl.textContent = flagMode
      ? '插旗模式：点按插旗或取消，长按翻开' + chord
      : '点按翻开格子，长按插旗' + chord;
  }

  /* ---------- 操作 ---------- */
  function pushHistory() {
    history.push(game.serialize());
    if (history.length > HISTORY_LIMIT) history.shift();
  }

  function playing() {
    return !!game && !isStartVisible() && game.state !== 'won' && game.state !== 'lost' &&
      !MGModal.isOpen(resultModal) && !settingsPanel.isOpen();
  }

  /** kind: 'reveal' | 'flag' | 'chord' */
  function act(kind, i) {
    if (!playing() || i < 0 || i >= game.size()) return;
    var status = game.view(i).status;
    if (kind === 'reveal' && status !== 'hidden') return;
    if (kind === 'flag' && status === 'open') return;
    if (kind === 'chord' && (status !== 'open' || settings.chordTap !== 'on')) return;

    pushHistory();
    var res = kind === 'reveal' ? game.reveal(i) : kind === 'flag' ? game.toggleFlag(i) : game.chord(i);
    if (!res.changed.length) {
      history.pop(); // 无变化的操作不占撤销步数
      return;
    }
    if (game.state === 'playing') timer.start(); // 首次翻开开始计时
    renderChanged(res.changed);
    if (kind === 'flag' && game.view(i).status === 'flag') cellEls[i].classList.add('pop-in');
    refreshStats();

    if (res.state === 'won') {
      MGHaptics.success();
      onWin();
    } else if (res.state === 'lost') {
      MGHaptics.warning();
      onLose();
    } else {
      if (kind === 'flag') MGHaptics.medium();
      else MGHaptics.light();
      saveGame();
    }
  }

  function showResult(type) {
    resultModal.classList.remove('win', 'lose');
    resultModal.classList.add(type);
    resultLevel.textContent = LEVEL_LABELS[level];
    resultTime.textContent = MGShell.formatTime(timer.elapsed());
    resultBest.textContent = best > 0 ? MGShell.formatTime(best) : '—';
    btnResultUndo.style.display = type === 'lose' ? '' : 'none';
    MGModal.open(resultModal);
  }

  function onWin() {
    timer.stop();
    storage.remove(SAVE_KEY);
    var elapsed = Math.max(1, timer.elapsed());
    var isRecord = !assisted && (best === 0 || elapsed < best);
    if (isRecord) {
      best = elapsed;
      storage.set('best_' + level, best);
    }
    refreshStats();
    timeEl.textContent = MGShell.formatTime(elapsed); // 与结果弹窗、最佳成绩显示一致
    MGShell.restartClass(boardEl, 'celebrate');
    resultTitle.textContent = '扫雷成功！';
    resultRecord.style.display = isRecord ? '' : 'none';
    resultNote.textContent = assisted ? '本局撤销过踩雷，不计入最佳成绩' : '';
    setTimeout(function () { showResult('win'); }, MGMotion.duration(520));
  }

  function onLose() {
    timer.stop();
    storage.remove(SAVE_KEY);
    resultTitle.textContent = '踩到地雷了';
    resultRecord.style.display = 'none';
    resultNote.textContent = '可以撤销这一步继续（撤销后本局不计入最佳成绩）';
    setTimeout(function () { showResult('lose'); }, MGMotion.duration(700)); // 先看清雷的分布再弹窗
  }

  function undo() {
    if (!game || isStartVisible() || game.state === 'won' || !history.length) return;
    var wasLost = game.state === 'lost';
    if (!game.restore(history.pop())) return;
    if (wasLost) assisted = true;
    MGModal.close(resultModal);
    boardEl.classList.remove('celebrate');
    renderAll();
    refreshStats();
    if (game.state === 'playing') timer.start();
    MGHaptics.light();
    saveGame();
  }

  function newGame(lv) {
    level = lv;
    var d = dimsFor(lv);
    game = new Minesweeper(d.rows, d.cols, d.mines);
    history = [];
    assisted = false;
    timer.reset(0);
    best = loadBest(lv);
    MGModal.close(resultModal);
    buildBoard();
    refreshStats();
    saveGame();
  }

  function setFlagMode(on) {
    flagMode = on;
    var btns = modeSwitch.querySelectorAll('button[data-mode]');
    for (var k = 0; k < btns.length; k++) {
      var active = (btns[k].dataset.mode === 'flag') === on;
      btns[k].classList.toggle('active', active);
      btns[k].setAttribute('aria-pressed', String(active));
    }
    document.body.classList.toggle('flag-mode', on);
    refreshHint();
  }

  /* ---------- 点按与长按（Pointer Events）：移动超过阈值视为滚动 ---------- */
  var press = null;

  function cellIndexOf(target) {
    var el = target && target.closest ? target.closest('.ms-cell') : null;
    return el ? Number(el.dataset.i) : -1;
  }

  function cancelPress() {
    if (!press) return;
    clearTimeout(press.timer);
    if (cellEls[press.i]) cellEls[press.i].classList.remove('is-pressing');
    press = null;
  }

  function tapAction(i) {
    if (game.view(i).status === 'open') act('chord', i);
    else act(flagMode ? 'flag' : 'reveal', i);
  }

  function longAction(i) {
    if (game.view(i).status === 'open') act('chord', i);
    else act(flagMode ? 'reveal' : 'flag', i); // 长按执行与当前模式相反的操作
  }

  boardEl.addEventListener('pointerdown', function (e) {
    var i = cellIndexOf(e.target);
    if (i < 0 || !playing()) return;
    if (e.pointerType === 'mouse' && e.button === 2) { // 桌面右键直接插旗
      e.preventDefault();
      act('flag', i);
      return;
    }
    if (e.button !== 0) return;
    cancelPress();
    if (game.view(i).status !== 'open') cellEls[i].classList.add('is-pressing');
    press = {
      i: i,
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      long: false,
      timer: setTimeout(function () {
        if (!press) return;
        press.long = true;
        cellEls[press.i].classList.remove('is-pressing');
        longAction(press.i);
      }, LONG_PRESS_MS[settings.longPress])
    };
  });

  boardEl.addEventListener('pointermove', function (e) {
    if (!press || e.pointerId !== press.id) return;
    if (Math.abs(e.clientX - press.x) > MOVE_TOLERANCE || Math.abs(e.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
  });

  boardEl.addEventListener('pointerup', function (e) {
    if (!press || e.pointerId !== press.id) return;
    var p = press;
    cancelPress();
    if (!p.long) tapAction(p.i);
  });

  boardEl.addEventListener('pointercancel', cancelPress); // 浏览器接管为滚动时取消
  // 系统长按菜单可能早于计时器触发（如长按时长设为「长」）：屏蔽菜单，并直接执行长按操作
  boardEl.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    if (!press || press.long || cellIndexOf(e.target) !== press.i) return;
    clearTimeout(press.timer);
    press.long = true;
    cellEls[press.i].classList.remove('is-pressing');
    longAction(press.i);
  });
  scrollEl.addEventListener('scroll', cancelPress, { passive: true });

  /* ---------- 公共框架：开始页 / 设置 / 键盘 / 生命周期 ---------- */
  var startScreen = MGShell.createStartScreen({
    el: document.getElementById('start-screen'),
    grid: document.getElementById('start-level-grid'),
    startBtn: document.getElementById('btn-start'),
    homeBtn: document.getElementById('btn-start-home'),
    attr: 'level',
    parse: String,
    allowed: LEVEL_NAMES,
    fallback: 'beginner',
    storage: storage,
    rememberKey: 'last_level',
    onBeforeShow: function () {
      saveGame(); // 先保存进行中的对局，再暂停计时（开始页可见后不再写存档）
      timer.stop();
    },
    onStart: newGame
  });

  var settingsPanel = MGShell.createSettingsPanel({
    modal: document.getElementById('settings-modal'),
    closeBtn: document.getElementById('btn-settings-close'),
    settings: settings,
    schema: SETTINGS_SCHEMA,
    storage: storage,
    key: SETTINGS_KEY,
    onChange: function (name) {
      if (name === 'chordTap') refreshHint();
    }
  });

  MGShell.bindKeys({
    isBlocked: isStartVisible,
    settings: settingsPanel,
    overlays: [resultModal],
    intercept: function (e) {
      if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        undo();
        return true;
      }
      if (e.key === 'f' || e.key === 'F') {
        setFlagMode(!flagMode);
        return true;
      }
      return false;
    }
  });

  MGShell.bindLifecycle({
    save: saveGame,
    onHide: timer.stop,
    onShow: function () {
      if (playing() && game.state === 'playing') timer.start();
    }
  });

  /* ---------- 按钮 ---------- */
  btnNew.addEventListener('click', function () { startScreen.show(level); });
  btnHome.addEventListener('click', function () { MGShell.goHome(saveGame); });
  btnUndo.addEventListener('click', undo);
  btnSettings.addEventListener('click', settingsPanel.open);
  btnResultUndo.addEventListener('click', undo);
  btnResultRetry.addEventListener('click', function () { newGame(level); });
  modeSwitch.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-mode]');
    if (btn) setFlagMode(btn.dataset.mode === 'flag');
  });

  var resizeRaf = 0;
  window.addEventListener('resize', function () {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(layout);
  });

  /* ---------- 初始化：有合法存档直接恢复，否则进开始页 ---------- */
  var restored = loadSave();
  if (restored) {
    level = restored.level;
    game = restored.game;
    assisted = restored.assisted;
    timer.reset(restored.elapsed);
    best = loadBest(level);
    buildBoard();
    refreshStats();
    if (game.state === 'playing') timer.start();
  } else {
    var last = storage.get('last_level', 'beginner');
    level = LEVEL_NAMES.indexOf(last) !== -1 ? last : 'beginner';
    var d = dimsFor(level);
    game = new Minesweeper(d.rows, d.cols, d.mines);
    best = loadBest(level);
    buildBoard();
    refreshStats();
    startScreen.show(level);
  }
  refreshHint();

  // 调试/自动化测试钩子
  window.__debugMinesweeper = {
    get game() { return game; },
    get level() { return level; },
    get assisted() { return assisted; },
    get elapsed() { return timer.elapsed(); },
    get startVisible() { return isStartVisible(); },
    act: act,
    undo: undo,
    saveGame: saveGame,
    setFlagMode: setFlagMode
  };
})();
