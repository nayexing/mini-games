/**
 * 游戏公共框架 —— 四款游戏交互层共用：设置、设置弹窗（含全局震动开关）、开始页、计时器、
 * 生命周期存档、键盘方向键、返回主页、时间格式化
 * 依赖：MGModal；可选 MGPrefs、MGHaptics
 */
(function (global) {
  'use strict';

  var MENU_URL = '../index.html';

  var DIRECTION_KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', a: 'left', s: 'down', d: 'right',
    W: 'up', A: 'left', S: 'down', D: 'right'
  };

  /** 秒 → mm:ss；超过 1 小时为 h:mm:ss */
  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec) || 0);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var mmss = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    return h > 0 ? h + ':' + mmss : mmss;
  }

  /** 重新播放一个 CSS 动画类（先移除，强制回流后再添加） */
  function restartClass(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  /** 返回合集菜单；save 为可选的存档函数 */
  function goHome(save) {
    if (typeof save === 'function') save();
    global.location.href = MENU_URL;
  }

  /**
   * 读取设置并按选项表校验，非法值回退默认
   * schema: { name: { options: [...], def: value } }
   */
  function loadSettings(storage, key, schema) {
    var raw = storage.get(key, null);
    var out = {};
    for (var name in schema) {
      if (!Object.prototype.hasOwnProperty.call(schema, name)) continue;
      var v = raw && typeof raw === 'object' ? raw[name] : undefined;
      out[name] = schema[name].options.indexOf(v) !== -1 ? v : schema[name].def;
    }
    return out;
  }

  /** 设置弹窗中的全局「震动反馈」开关（设备不支持震动时不创建） */
  function createVibrationRow(card, before) {
    if (!global.MGHaptics || !global.MGPrefs || !global.MGHaptics.supported()) return null;
    var row = document.createElement('div');
    row.className = 'setting-group setting-row';

    var label = document.createElement('div');
    label.className = 'setting-label';
    var text = document.createElement('span');
    text.textContent = '震动反馈';
    var desc = document.createElement('span');
    desc.className = 'setting-desc';
    desc.textContent = '对所有游戏生效';
    text.appendChild(desc);
    label.appendChild(text);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'switch';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-label', '震动反馈');

    row.appendChild(label);
    row.appendChild(btn);
    card.insertBefore(row, before || null);

    btn.addEventListener('click', function () {
      var next = !global.MGPrefs.get('vibration');
      global.MGPrefs.set('vibration', next);
      sync();
      if (next) global.MGHaptics.light(); // 打开时轻震一下作确认
    });

    function sync() {
      btn.setAttribute('aria-checked', String(global.MGPrefs.get('vibration') === true));
    }
    sync();
    return { sync: sync };
  }

  /**
   * 设置弹窗：选项按钮高亮、点击切换、持久化、背板/完成按钮关闭，并自动附加全局震动开关
   * opts: modal, closeBtn, settings, schema, storage, key, onChange(name, value), onSync()
   * 选项按钮 data-value 为字符串，按 String(option) 匹配后保留选项原类型（如数字）
   */
  function createSettingsPanel(opts) {
    var modal = opts.modal;
    var settings = opts.settings;
    var schema = opts.schema;
    var card = modal.querySelector('.modal-card') || modal;
    var groups = modal.querySelectorAll('.setting-group[data-setting]');
    var vibration = createVibrationRow(card, opts.closeBtn);

    function sync() {
      for (var i = 0; i < groups.length; i++) {
        var current = String(settings[groups[i].dataset.setting]);
        var btns = groups[i].querySelectorAll('button[data-value]');
        for (var j = 0; j < btns.length; j++) {
          btns[j].classList.toggle('active', btns[j].dataset.value === current);
        }
      }
      if (vibration) vibration.sync();
      if (opts.onSync) opts.onSync();
    }

    function set(name, rawValue) {
      var spec = schema[name];
      if (!spec) return;
      var value;
      var found = false;
      for (var i = 0; i < spec.options.length; i++) {
        if (String(spec.options[i]) === String(rawValue)) { value = spec.options[i]; found = true; break; }
      }
      if (!found || settings[name] === value) return;
      settings[name] = value;
      opts.storage.set(opts.key, settings);
      if (opts.onChange) opts.onChange(name, value);
      sync();
    }

    function open() { sync(); global.MGModal.open(modal); }
    function close() { global.MGModal.close(modal); }

    for (var i = 0; i < groups.length; i++) {
      (function (group) {
        group.addEventListener('click', function (e) {
          var btn = e.target.closest('button[data-value]');
          if (btn) set(group.dataset.setting, btn.dataset.value);
        });
      })(groups[i]);
    }
    if (opts.closeBtn) opts.closeBtn.addEventListener('click', close);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) close(); // 点背板关闭
    });

    return {
      open: open,
      close: close,
      isOpen: function () { return global.MGModal.isOpen(modal); },
      sync: sync,
      set: set
    };
  }

  /**
   * 开始页：选项选择（记住上次选择）、开始、返回菜单
   * opts: el, grid, startBtn, homeBtn, allowed[], fallback, attr（默认 'size'）, parse（默认 Number）,
   *       storage + rememberKey（可选，记住选择）, onBeforeShow()（从隐藏变为可见前调用）, onStart(value)
   */
  function createStartScreen(opts) {
    var attr = 'data-' + (opts.attr || 'size');
    var parse = opts.parse || Number;
    var allowed = opts.allowed;
    var visible = false;
    var pending = opts.fallback;

    function normalize(v) { return allowed.indexOf(v) !== -1 ? v : opts.fallback; }

    function syncUI() {
      var btns = opts.grid.querySelectorAll('button[' + attr + ']');
      for (var i = 0; i < btns.length; i++) {
        var active = parse(btns[i].getAttribute(attr)) === pending;
        btns[i].classList.toggle('active', active);
        btns[i].setAttribute('aria-pressed', String(active));
      }
    }

    function show(current) {
      if (!visible && opts.onBeforeShow) opts.onBeforeShow();
      visible = true;
      pending = normalize(current);
      syncUI();
      opts.el.classList.add('show');
    }

    function hide() {
      visible = false;
      opts.el.classList.remove('show');
    }

    opts.grid.addEventListener('click', function (e) {
      var btn = e.target.closest('button[' + attr + ']');
      if (!btn) return;
      var v = parse(btn.getAttribute(attr));
      if (allowed.indexOf(v) === -1) return;
      pending = v;
      if (opts.storage && opts.rememberKey) opts.storage.set(opts.rememberKey, v); // 下次打开默认选中
      syncUI();
    });
    if (opts.startBtn) {
      opts.startBtn.addEventListener('click', function () {
        if (allowed.indexOf(pending) === -1) return;
        hide();
        opts.onStart(pending);
      });
    }
    if (opts.homeBtn) {
      opts.homeBtn.addEventListener('click', function () { goHome(); }); // 对局存档保留
    }

    return {
      show: show,
      hide: hide,
      isVisible: function () { return visible; },
      selected: function () { return pending; }
    };
  }

  /** 秒级计时器：onTick(elapsed) 每秒回调 */
  function createTimer(onTick) {
    var elapsed = 0;
    var id = null;

    function stop() {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    }

    return {
      start: function () {
        if (id !== null) return;
        id = setInterval(function () {
          elapsed++;
          if (onTick) onTick(elapsed);
        }, 1000);
      },
      stop: stop,
      reset: function (sec) {
        stop();
        elapsed = Math.max(0, Math.floor(sec) || 0);
      },
      elapsed: function () { return elapsed; },
      running: function () { return id !== null; }
    };
  }

  /** 离开页面前存档：pagehide / 页面隐藏时 save()，可选 onHide / onShow（如暂停、恢复计时） */
  function bindLifecycle(opts) {
    global.addEventListener('pagehide', function () { opts.save(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        opts.save();
        if (opts.onHide) opts.onHide();
      } else if (opts.onShow) {
        opts.onShow();
      }
    });
  }

  /**
   * 键盘：开始页可见时忽略；设置打开时 Escape 关闭；结果弹窗打开时忽略；
   * intercept(e) 返回 true 表示已处理；方向键/WASD 交给 onDirection(dir)
   * opts: isBlocked(), settings（createSettingsPanel 返回值）, overlays[], intercept(e), onDirection(dir)
   */
  function bindKeys(opts) {
    document.addEventListener('keydown', function (e) {
      if (opts.isBlocked && opts.isBlocked()) return;
      if (opts.settings && opts.settings.isOpen()) {
        if (e.key === 'Escape') opts.settings.close();
        return;
      }
      var overlays = opts.overlays || [];
      for (var i = 0; i < overlays.length; i++) {
        if (global.MGModal.isOpen(overlays[i])) return;
      }
      if (opts.intercept && opts.intercept(e)) return;
      var dir = DIRECTION_KEYS[e.key];
      if (dir && opts.onDirection) {
        e.preventDefault();
        opts.onDirection(dir);
      }
    });
  }

  global.MGShell = {
    MENU_URL: MENU_URL,
    formatTime: formatTime,
    restartClass: restartClass,
    goHome: goHome,
    loadSettings: loadSettings,
    createSettingsPanel: createSettingsPanel,
    createStartScreen: createStartScreen,
    createTimer: createTimer,
    bindLifecycle: bindLifecycle,
    bindKeys: bindKeys
  };
})(window);
