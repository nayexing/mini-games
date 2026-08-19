/**
 * 公共滑动手势识别器 —— 2048 与数字华容道共用
 * touch + mouse 统一处理；位移达阈值立即触发滑动（不等抬手），
 * 结束时位移不足阈值视为点按
 */
(function (global) {
  'use strict';

  var MGSwipe = {
    /**
     * @param {Object} opts
     *   threshold  {number}    触发阈值 px（可 setThreshold 热更），默认 20
     *   ratio      {number}    长轴/短轴比，防对角误判，默认 1.2
     *   isBlocked  {Function}  手势起点是否被阻断（开始页可见/弹窗打开/起点在按钮上）
     *   canSwipe   {Function}  当前是否允许滑动触发（瞄准态等业务开关），默认恒允许
     *   onSwipe    {Function}  滑动回调 dir: 'up'|'down'|'left'|'right'
     *   onTap      {Function}  点按回调（位移小于阈值），参数为 clientX/clientY
     * @returns {{ setThreshold: Function(px), destroy: Function }}
     */
    create: function (opts) {
      opts = opts || {};
      var threshold = typeof opts.threshold === 'number' && opts.threshold > 0 ? opts.threshold : 20;
      var ratio = typeof opts.ratio === 'number' && opts.ratio > 1 ? opts.ratio : 1.2;
      var isBlocked = typeof opts.isBlocked === 'function' ? opts.isBlocked : function () { return false; };
      var canSwipe = typeof opts.canSwipe === 'function' ? opts.canSwipe : function () { return true; };
      var onSwipe = typeof opts.onSwipe === 'function' ? opts.onSwipe : function () {};
      var onTap = typeof opts.onTap === 'function' ? opts.onTap : function () {};

      var tracking = false; // 本次手势是否在跟踪中
      var handled = false;  // 本次手势是否已触发过移动（move 阶段触发后置位）
      var startX = 0;
      var startY = 0;

      function gestureStart(x, y) {
        tracking = true;
        handled = false;
        startX = x;
        startY = y;
      }

      /** 位移超阈值且方向明确立即触发，不等抬手 */
      function gestureMove(x, y) {
        if (!tracking || handled) return;
        if (!canSwipe()) return;
        var dx = x - startX;
        var dy = y - startY;
        var absX = Math.abs(dx);
        var absY = Math.abs(dy);
        var longAxis = Math.max(absX, absY);
        if (longAxis < threshold) return;
        if (longAxis < Math.min(absX, absY) * ratio) return; // 对角方向不明确，等位移加大再判
        handled = true;
        onSwipe(absX > absY ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      }

      /** 兜底：move 阶段未触发时，结束时终判；位移不足阈值视为点按 */
      function gestureEnd(x, y) {
        if (!tracking) return;
        tracking = false;
        if (handled) return;
        var dx = x - startX;
        var dy = y - startY;
        var absX = Math.abs(dx);
        var absY = Math.abs(dy);
        var longAxis = Math.max(absX, absY);
        if (longAxis < threshold) {
          onTap(x, y);
          return;
        }
        if (!canSwipe()) return; // 业务禁滑（如瞄准态）下的滑动不触发移动，避免误操作
        if (longAxis < Math.min(absX, absY) * ratio) return;
        onSwipe(absX > absY ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      }

      function onTouchStart(e) {
        if (e.touches.length > 1 || isBlocked(e.target)) { tracking = false; return; }
        var t = e.touches[0];
        gestureStart(t.clientX, t.clientY);
      }

      function onTouchMove(e) {
        if (!tracking) return;
        e.preventDefault(); // 跟踪中的手势阻止页面滚动/下拉刷新
        var t = e.touches[0];
        gestureMove(t.clientX, t.clientY);
      }

      function onTouchEnd(e) {
        if (!tracking) return;
        var t = e.changedTouches[0];
        gestureEnd(t.clientX, t.clientY);
      }

      function onTouchCancel() {
        tracking = false;
      }

      function onMouseDown(e) {
        if (e.button !== 0 || isBlocked(e.target)) return;
        gestureStart(e.clientX, e.clientY);
      }

      function onMouseMove(e) {
        if (!tracking) return;
        gestureMove(e.clientX, e.clientY);
      }

      function onMouseUp(e) {
        if (!tracking) return;
        gestureEnd(e.clientX, e.clientY);
      }

      document.addEventListener('touchstart', onTouchStart, { passive: true });
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd, { passive: true });
      document.addEventListener('touchcancel', onTouchCancel, { passive: true });
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      return {
        setThreshold: function (px) {
          if (typeof px === 'number' && px > 0) threshold = px;
        },
        destroy: function () {
          document.removeEventListener('touchstart', onTouchStart, { passive: true });
          document.removeEventListener('touchmove', onTouchMove, { passive: false });
          document.removeEventListener('touchend', onTouchEnd, { passive: true });
          document.removeEventListener('touchcancel', onTouchCancel, { passive: true });
          document.removeEventListener('mousedown', onMouseDown);
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        }
      };
    }
  };

  global.MGSwipe = MGSwipe;
})(typeof window !== 'undefined' ? window : globalThis);
