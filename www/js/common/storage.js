/**
 * 公共本地存储封装 —— 前缀参数化，各游戏独立命名空间
 * 异常（隐私模式/配额满等）静默降级，不阻断游戏
 */
(function (global) {
  'use strict';

  /**
   * @param {string} prefix 存储键前缀，如 'game2048_' / 'huarong_'
   * @returns {{ get: Function, set: Function, remove: Function }}
   */
  function createStorage(prefix) {
    prefix = typeof prefix === 'string' ? prefix : '';
    return {
      get: function (key, fallback) {
        try {
          var raw = localStorage.getItem(prefix + key);
          return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
          return fallback;
        }
      },
      set: function (key, value) {
        try {
          localStorage.setItem(prefix + key, JSON.stringify(value));
        } catch (e) { /* 隐私模式等场景下静默降级 */ }
      },
      remove: function (key) {
        try {
          localStorage.removeItem(prefix + key);
        } catch (e) { /* 静默降级 */ }
      }
    };
  }

  global.MGStorage = { create: createStorage };
})(typeof window !== 'undefined' ? window : globalThis);
