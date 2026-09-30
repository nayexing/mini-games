/**
 * 动效公共模块 —— 检测系统「减少动态效果」，并统一设置动画速度倍率
 * MGMotion.reduced()        当前是否开启减少动态效果
 * MGMotion.onChange(fn)     系统设置变化时回调 fn(reduced)
 * MGMotion.setScale(scale)  写入 CSS 变量 --motion-scale（设置「动画速度」使用）
 * MGMotion.duration(ms)     按当前状态换算 JS 定时时长（减少动态效果时为 0）
 */
(function (global) {
  'use strict';

  var query = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var listeners = [];

  function reduced() {
    return !!(query && query.matches);
  }

  function notify() {
    var r = reduced();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](r); } catch (e) { /* 单个监听出错不影响其余 */ }
    }
  }

  if (query) {
    if (query.addEventListener) query.addEventListener('change', notify);
    else if (query.addListener) query.addListener(notify);
  }

  global.MGMotion = {
    reduced: reduced,
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    setScale: function (scale) {
      document.documentElement.style.setProperty('--motion-scale', String(scale));
    },
    duration: function (ms) { return reduced() ? 0 : ms; }
  };
})(window);
