/**
 * 数独交互层 —— 选格、输入、笔记、擦除、撤销、行列宫与相同数字高亮、冲突提示、
 * 延后一帧生成题目、计时、存档、最佳用时
 */
(function () {
  'use strict';

  var storage = MGStorage.create('sudoku_');
  var SETTINGS_KEY = 'settings';
  var SAVE_KEY = 'save';
  var LEVELS = ['easy', 'medium', 'hard'];
  var LEVEL_LABELS = { easy: '简单', medium: '中等', hard: '困难' };
  var HISTORY_LIMIT = 200;
  var PEERS = Sudoku.PEERS;

  var boardEl = document.getElementById('board');
  var statusEl = document.getElementById('sd-status');
  var padEl = document.getElementById('sd-pad');
  var levelEl = document.getElementById('level');
  var timeEl = document.getElementById('time');
  var bestEl = document.getElementById('best');
  var hintEl = document.getElementById('hint');
  var resultModal = document.getElementById('result-modal');
  var resultRecord = document.getElementById('result-record');
  var resultLevel = document.getElementById('result-level');
  var resultTime = document.getElementById('result-time');
  var resultBest = document.getElementById('result-best');
  var noteBtn = padEl.querySelector('[data-action="note"]');
  var digitBtns = padEl.querySelectorAll('button[data-digit]');

  /* ---------- 设置 ---------- */
  var SETTINGS_SCHEMA = {
    highlightSame: { options: ['on', 'off'], def: 'on' },
    autoNotes: { options: ['on', 'off'], def: 'on' }
  };
  var settings = MGShell.loadSettings(storage, SETTINGS_KEY, SETTINGS_SCHEMA);

  /* ---------- 运行状态 ---------- */
  var difficulty = 'easy';
  var puzzle = null;         // 给定数字（0 为空）
  var solution = null;
  var values = null;         // 当前盘面（含给定数字）
  var notes = null;          // 笔记位掩码：第 d 位表示候选 d
  var selected = -1;
  var noteMode = false;
  var history = [];          // 每步为 [{ i, v, n }]：改动前的数字与笔记
  var solved = false;
  var generating = false;
  var best = 0;
  var cells = [];            // [{ el, valueEl, noteSpans }]
  var timer = MGShell.createTimer(function (sec) { timeEl.textContent = MGShell.formatTime(sec); });

  function loadBest(lv) {
    var v = storage.get('best_' + lv, 0);
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0;
  }

  function isStartVisible() {
    return startScreen.isVisible();
  }

  function ready() {
    return !!puzzle && !solved && !generating && !isStartVisible() &&
      !MGModal.isOpen(resultModal) && !settingsPanel.isOpen();
  }

  /* ---------- 存档 ---------- */
  function loadSave() {
    var s = storage.get(SAVE_KEY, null);
    if (!s || typeof s !== 'object' || s.solved === true) return null;
    if (typeof s.elapsed !== 'number' || !(s.elapsed >= 0)) return null;
    var state = Sudoku.validateState(s);
    if (!state) return null;
    state.elapsed = s.elapsed;
    return state;
  }

  function saveGame() {
    if (!puzzle || solved || generating || isStartVisible()) return;
    storage.set(SAVE_KEY, {
      v: 1,
      difficulty: difficulty,
      elapsed: timer.elapsed(),
      puzzle: puzzle,
      solution: solution,
      values: values,
      notes: notes,
      solved: false,
      ts: Date.now()
    });
  }

  /* ---------- 棋盘结构：9 宫 × 9 格，只构建一次 ---------- */
  function buildBoard() {
    var boxes = [];
    for (var b = 0; b < 9; b++) {
      var box = document.createElement('div');
      box.className = 'sd-box';
      box.dataset.b = b;
      boxes.push(box);
    }
    cells = new Array(81);
    for (var i = 0; i < 81; i++) {
      var el = document.createElement('div');
      el.className = 'sd-cell';
      el.setAttribute('role', 'gridcell');
      el.dataset.i = i;
      var valueEl = document.createElement('span');
      valueEl.className = 'sd-value';
      var notesEl = document.createElement('div');
      notesEl.className = 'sd-notes';
      var noteSpans = [];
      for (var d = 1; d <= 9; d++) {
        var span = document.createElement('span');
        span.textContent = String(d);
        notesEl.appendChild(span);
        noteSpans.push(span);
      }
      el.appendChild(valueEl);
      el.appendChild(notesEl);
      cells[i] = { el: el, valueEl: valueEl, noteSpans: noteSpans };
      boxes[Sudoku.BOX[i]].appendChild(el); // 按宫依次追加，宫内顺序与行列顺序一致
    }
    for (var k = 0; k < 9; k++) boardEl.insertBefore(boxes[k], statusEl);
  }

  /* ---------- 渲染：81 格整盘刷新（开销很小，保证高亮与冲突始终一致） ---------- */
  function render() {
    var hasPuzzle = !!puzzle;
    var conflictSet = {};
    if (hasPuzzle) {
      var list = Sudoku.conflicts(values);
      for (var c = 0; c < list.length; c++) conflictSet[list[c]] = true;
    }
    var peerSet = {};
    if (selected >= 0) {
      var peers = PEERS[selected];
      for (var p = 0; p < peers.length; p++) peerSet[peers[p]] = true;
    }
    var selValue = hasPuzzle && selected >= 0 ? values[selected] : 0;
    var highlight = settings.highlightSame === 'on';

    for (var i = 0; i < 81; i++) {
      var cell = cells[i];
      var v = hasPuzzle ? values[i] : 0;
      var cls = 'sd-cell';
      if (hasPuzzle && puzzle[i]) cls += ' is-given';
      if (i === selected) cls += ' is-selected';
      else if (highlight && selValue && v === selValue) cls += ' is-same';
      else if (peerSet[i]) cls += ' is-peer';
      if (conflictSet[i]) cls += ' is-conflict';
      cell.el.className = cls;
      cell.valueEl.textContent = v ? String(v) : '';
      var mask = hasPuzzle && !v ? notes[i] : 0;
      for (var d = 1; d <= 9; d++) {
        var on = (mask & (1 << d)) !== 0;
        cell.noteSpans[d - 1].className = on ? (highlight && selValue === d ? 'on is-match' : 'on') : '';
      }
      var label = (Sudoku.ROW[i] + 1) + ' 行 ' + (Sudoku.COL[i] + 1) + ' 列，' +
        (v ? (hasPuzzle && puzzle[i] ? '给定 ' : '') + v : '空');
      cell.el.setAttribute('aria-label', label);
    }
    renderPad();
  }

  function renderPad() {
    var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    if (values) for (var i = 0; i < 81; i++) counts[values[i]]++;
    for (var k = 0; k < digitBtns.length; k++) {
      var d = Number(digitBtns[k].dataset.digit);
      var left = Math.max(0, 9 - counts[d]);
      digitBtns[k].classList.toggle('is-done', !!values && left === 0);
      digitBtns[k].querySelector('.pad-left').textContent = values ? String(left) : '';
      digitBtns[k].setAttribute('aria-label', '数字 ' + d + (values ? '，还剩 ' + left + ' 个' : ''));
    }
    noteBtn.setAttribute('aria-pressed', String(noteMode));
  }

  function refreshStats() {
    levelEl.textContent = LEVEL_LABELS[difficulty];
    timeEl.textContent = MGShell.formatTime(timer.elapsed());
    bestEl.textContent = best > 0 ? MGShell.formatTime(best) : '—';
  }

  function setHint(text) {
    hintEl.textContent = text || (noteMode
      ? '笔记模式：点数字记录或取消候选数'
      : '点选空格后输入数字；笔记模式可记录候选数');
  }

  /* ---------- 操作 ---------- */
  function pushHistory(changes) {
    if (!changes.length) return;
    history.push(changes);
    if (history.length > HISTORY_LIMIT) history.shift();
  }

  function select(i) {
    if (!ready() || i < 0 || i > 80) return;
    selected = i;
    render();
  }

  function popValue(i) {
    MGShell.restartClass(cells[i].valueEl, 'pop-in');
  }

  function input(d) {
    if (!ready() || selected < 0 || puzzle[selected]) return;
    var i = selected;
    var changes = [{ i: i, v: values[i], n: notes[i] }];
    if (noteMode) {
      if (values[i]) return; // 已填数字的格子不能记笔记
      notes[i] ^= 1 << d;
    } else if (values[i] === d) {
      values[i] = 0;         // 再次输入同一数字视为清除
    } else {
      values[i] = d;
      notes[i] = 0;
      if (settings.autoNotes === 'on') {
        var peers = PEERS[i];
        for (var p = 0; p < peers.length; p++) {
          var j = peers[p];
          if (notes[j] & (1 << d)) {
            changes.push({ i: j, v: values[j], n: notes[j] });
            notes[j] &= ~(1 << d);
          }
        }
      }
    }
    pushHistory(changes);
    MGHaptics.light();
    render();
    if (!noteMode && values[i]) popValue(i);
    afterChange();
  }

  function erase() {
    if (!ready() || selected < 0 || puzzle[selected]) return;
    var i = selected;
    if (!values[i] && !notes[i]) return;
    pushHistory([{ i: i, v: values[i], n: notes[i] }]);
    values[i] = 0;
    notes[i] = 0;
    MGHaptics.light();
    render();
    afterChange();
  }

  function undo() {
    if (!ready() || !history.length) return;
    var changes = history.pop();
    for (var k = changes.length - 1; k >= 0; k--) {
      values[changes[k].i] = changes[k].v;
      notes[changes[k].i] = changes[k].n;
    }
    selected = changes[0].i;
    MGHaptics.light();
    render();
    afterChange();
  }

  /** 每次改动后：检查是否完成、给出填满但有误的提示、保存 */
  function afterChange() {
    var full = true;
    var correct = true;
    for (var i = 0; i < 81; i++) {
      if (!values[i]) { full = false; break; }
      if (values[i] !== solution[i]) correct = false;
    }
    if (full && correct) {
      win();
      return;
    }
    setHint(full ? '棋盘已填满，但还有数字不正确' : '');
    saveGame();
  }

  function win() {
    solved = true;
    selected = -1;
    timer.stop();
    storage.remove(SAVE_KEY);
    var elapsed = Math.max(1, timer.elapsed());
    var isRecord = best === 0 || elapsed < best;
    if (isRecord) {
      best = elapsed;
      storage.set('best_' + difficulty, best);
    }
    render();
    refreshStats();
    timeEl.textContent = MGShell.formatTime(elapsed); // 与结果弹窗、最佳成绩显示一致
    setHint('完成！');
    MGHaptics.success();
    MGShell.restartClass(boardEl, 'celebrate');
    resultRecord.style.display = isRecord ? '' : 'none';
    resultLevel.textContent = LEVEL_LABELS[difficulty];
    resultTime.textContent = MGShell.formatTime(elapsed);
    resultBest.textContent = MGShell.formatTime(best);
    resultModal.classList.add('win');
    setTimeout(function () { MGModal.open(resultModal); }, MGMotion.duration(520));
  }

  function toggleNoteMode() {
    noteMode = !noteMode;
    renderPad();
    setHint('');
  }

  function applyState(state) {
    difficulty = state.difficulty;
    puzzle = state.puzzle;
    solution = state.solution;
    values = state.values;
    notes = state.notes;
    selected = -1;
    history = [];
    solved = false;
    best = loadBest(difficulty);
    boardEl.classList.remove('celebrate');
  }

  /** 新局：先显示「生成中」，下一帧再生成，避免界面卡顿 */
  function newGame(lv) {
    generating = true;
    difficulty = lv;
    puzzle = null;
    values = null;
    selected = -1;
    timer.reset(0);
    best = loadBest(lv);
    MGModal.close(resultModal);
    statusEl.textContent = '生成中…';
    boardEl.classList.add('is-generating');
    refreshStats();
    render();
    requestAnimationFrame(function () {
      setTimeout(function () {
        var g = Sudoku.generate(lv);
        generating = false;
        applyState({
          difficulty: lv,
          puzzle: g.puzzle,
          solution: g.solution,
          values: g.puzzle.slice(),
          notes: new Array(81).fill(0)
        });
        boardEl.classList.remove('is-generating');
        refreshStats();
        render();
        setHint('');
        if (!isStartVisible() && document.visibilityState !== 'hidden') timer.start();
        saveGame();
      }, 0);
    });
  }

  /* ---------- 公共框架：开始页 / 设置 / 键盘 / 生命周期 ---------- */
  var startScreen = MGShell.createStartScreen({
    el: document.getElementById('start-screen'),
    grid: document.getElementById('start-level-grid'),
    startBtn: document.getElementById('btn-start'),
    homeBtn: document.getElementById('btn-start-home'),
    attr: 'level',
    parse: String,
    allowed: LEVELS,
    fallback: 'easy',
    storage: storage,
    rememberKey: 'last_difficulty',
    onBeforeShow: function () {
      saveGame();
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
      if (name === 'highlightSame') render();
    }
  });

  MGShell.bindKeys({
    isBlocked: isStartVisible,
    settings: settingsPanel,
    overlays: [resultModal],
    intercept: function (e) {
      if (/^[1-9]$/.test(e.key)) { input(Number(e.key)); return true; }
      if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { e.preventDefault(); erase(); return true; }
      if (e.key === 'n' || e.key === 'N') { toggleNoteMode(); return true; }
      if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo(); return true; }
      // 仅方向键移动选中格；WASD 等其他按键不做处理，避免与输入冲突
      return e.key.indexOf('Arrow') !== 0;
    },
    onDirection: function (dir) {
      if (!ready()) return;
      if (selected < 0) { select(40); return; }
      var r = Sudoku.ROW[selected];
      var c = Sudoku.COL[selected];
      if (dir === 'up') r = (r + 8) % 9;
      else if (dir === 'down') r = (r + 1) % 9;
      else if (dir === 'left') c = (c + 8) % 9;
      else c = (c + 1) % 9;
      select(r * 9 + c);
    }
  });

  MGShell.bindLifecycle({
    save: saveGame,
    onHide: timer.stop,
    onShow: function () {
      if (ready()) timer.start();
    }
  });

  /* ---------- 事件 ---------- */
  boardEl.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('.sd-cell') : null;
    if (el) select(Number(el.dataset.i));
  });

  padEl.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.digit) input(Number(btn.dataset.digit));
    else if (btn.dataset.action === 'erase') erase();
    else if (btn.dataset.action === 'note') toggleNoteMode();
  });

  document.getElementById('btn-new').addEventListener('click', function () { startScreen.show(difficulty); });
  document.getElementById('btn-home').addEventListener('click', function () { MGShell.goHome(saveGame); });
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-settings').addEventListener('click', settingsPanel.open);
  document.getElementById('btn-result-retry').addEventListener('click', function () { newGame(difficulty); });
  document.getElementById('btn-result-home').addEventListener('click', function () { MGShell.goHome(); });

  /* ---------- 初始化：有合法存档直接恢复，否则进开始页 ---------- */
  buildBoard();
  var restored = loadSave();
  if (restored) {
    applyState(restored);
    timer.reset(restored.elapsed);
    refreshStats();
    render();
    timer.start();
  } else {
    var last = storage.get('last_difficulty', 'easy');
    difficulty = LEVELS.indexOf(last) !== -1 ? last : 'easy';
    best = loadBest(difficulty);
    refreshStats();
    render();
    startScreen.show(difficulty);
  }
  setHint('');

  // 调试/自动化测试钩子
  window.__debugSudoku = {
    get puzzle() { return puzzle; },
    get solution() { return solution; },
    get values() { return values; },
    get notes() { return notes; },
    get selected() { return selected; },
    get solved() { return solved; },
    get elapsed() { return timer.elapsed(); },
    get startVisible() { return isStartVisible(); },
    select: select,
    input: input,
    erase: erase,
    undo: undo,
    saveGame: saveGame
  };
})();
