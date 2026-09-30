/**
 * 震动反馈封装 —— 仅在用户开启「震动反馈」且设备支持时生效，并做 50ms 节流
 * MGHaptics.supported()                    设备是否支持震动（不支持时设置中不显示开关）
 * MGHaptics.light / medium / success / warning()
 */
(function (global) {
  'use strict';

  var PATTERNS = {
    light: 10,             // 滑动、翻开、点选
    medium: 22,            // 合并、插旗
    success: [18, 60, 28], // 完成、胜利
    warning: [40, 50, 40]  // 失败、踩雷
  };
  var THROTTLE_MS = 50;
  var last = 0;

  function supported() {
    return !!(global.navigator && typeof global.navigator.vibrate === 'function');
  }

  /** 浏览器要求用户与页面交互过才允许震动；提前调用会被拦截并在控制台报警告 */
  function activated() {
    var ua = global.navigator.userActivation;
    return !ua || ua.hasBeenActive;
  }

  function play(name) {
    if (!supported() || !global.MGPrefs || global.MGPrefs.get('vibration') !== true) return;
    if (!activated()) return;
    var now = Date.now();
    if (now - last < THROTTLE_MS) return;
    last = now;
    try {
      global.navigator.vibrate(PATTERNS[name]);
    } catch (e) { /* 部分环境禁止调用，静默降级 */ }
  }

  global.MGHaptics = {
    supported: supported,
    light: function () { play('light'); },
    medium: function () { play('medium'); },
    success: function () { play('success'); },
    warning: function () { play('warning'); }
  };
})(window);
