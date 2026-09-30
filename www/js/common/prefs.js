/**
 * 全局偏好 —— 所有游戏共用（存储键 mg_prefs），与各游戏自己的设置分开
 * MGPrefs.get(name)         读取偏好（未设置或非法时返回默认值）
 * MGPrefs.set(name, value)  写入偏好（类型须与默认值一致）
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    vibration: false // 震动反馈：默认关闭，需要时在任一游戏的设置中打开
  };

  var storage = global.MGStorage.create('mg_');
  var KEY = 'prefs';

  function read() {
    var raw = storage.get(KEY, null);
    var out = {};
    for (var name in DEFAULTS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, name)) continue;
      var v = raw && typeof raw === 'object' ? raw[name] : undefined;
      out[name] = typeof v === typeof DEFAULTS[name] ? v : DEFAULTS[name];
    }
    return out;
  }

  var prefs = read();

  global.MGPrefs = {
    get: function (name) {
      return Object.prototype.hasOwnProperty.call(prefs, name) ? prefs[name] : undefined;
    },
    set: function (name, value) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, name)) return;
      if (typeof value !== typeof DEFAULTS[name]) return;
      prefs[name] = value;
      storage.set(KEY, prefs);
    }
  };

  // 其他页面（如另一个标签页）修改偏好时同步
  if (global.addEventListener) {
    global.addEventListener('storage', function (e) {
      if (e.key === 'mg_' + KEY) prefs = read();
    });
  }
})(window);
