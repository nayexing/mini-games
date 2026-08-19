/**
 * 公共弹窗开关 —— show class 切换（配合 common.css 的 modal-backdrop 过渡动画）
 */
(function (global) {
  'use strict';

  var MGModal = {
    /** 打开弹窗（背板淡入 + 卡片上浮） */
    open: function (el) {
      if (el) el.classList.add('show');
    },
    /** 关闭弹窗 */
    close: function (el) {
      if (el) el.classList.remove('show');
    },
    /** 弹窗是否处于打开状态 */
    isOpen: function (el) {
      return !!(el && el.classList.contains('show'));
    }
  };

  global.MGModal = MGModal;
})(typeof window !== 'undefined' ? window : globalThis);
