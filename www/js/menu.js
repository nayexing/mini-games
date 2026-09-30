/**
 * 合集主页 —— 从 MGGames 注册表渲染游戏卡片，并显示各游戏的本机进度
 * 有未完成对局：显示「继续 · …」并带「继续」标签；否则显示最佳成绩；从未玩过显示简介
 * 从游戏返回（含浏览器前进后退缓存恢复）时自动刷新进度
 */
(function () {
  'use strict';

  var grid = document.getElementById('game-grid');
  var statusEls = {};

  function buildCard(g) {
    var card = document.createElement('a');
    card.className = 'game-card';
    card.href = g.url;
    card.style.setProperty('--card-accent', g.accent);

    var logo = document.createElement('div');
    logo.className = 'card-logo ' + g.logo;
    logo.setAttribute('aria-hidden', 'true');
    for (var j = 0; j < g.cells.length; j++) {
      var cell = document.createElement('span');
      cell.textContent = g.cells[j].text;
      if (g.cells[j].cls) cell.className = g.cells[j].cls;
      logo.appendChild(cell);
    }

    var name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = g.name;

    var status = document.createElement('div');
    status.className = 'card-status';

    card.appendChild(logo);
    card.appendChild(name);
    card.appendChild(status);
    statusEls[g.id] = { card: card, status: status };
    return card;
  }

  function summaryOf(g) {
    try {
      return g.summarize(MGStorage.create(g.storagePrefix).get);
    } catch (e) {
      return null; // 存档异常时退回显示简介
    }
  }

  function refresh() {
    for (var i = 0; i < MGGames.GAMES.length; i++) {
      var g = MGGames.GAMES[i];
      var ref = statusEls[g.id];
      var summary = summaryOf(g);
      ref.status.textContent = '';
      ref.status.classList.toggle('is-resume', !!summary && summary.kind === 'resume');
      ref.status.classList.toggle('is-best', !!summary && summary.kind === 'best');
      if (summary && summary.kind === 'resume') {
        var badge = document.createElement('span');
        badge.className = 'card-badge';
        badge.textContent = '继续';
        ref.status.appendChild(badge);
        var text = document.createElement('span');
        text.textContent = summary.text.replace(/^继续 · /, '');
        ref.status.appendChild(text);
      } else {
        ref.status.textContent = summary ? summary.text : g.desc;
      }
      ref.card.setAttribute('aria-label', g.name + '：' + (summary ? summary.text : g.desc));
    }
  }

  for (var i = 0; i < MGGames.GAMES.length; i++) grid.appendChild(buildCard(MGGames.GAMES[i]));
  refresh();
  window.addEventListener('pageshow', refresh);

  var footer = document.getElementById('menu-footer');
  if (footer && window.MGAppInfo) footer.textContent = '小游戏合集 · v' + window.MGAppInfo.version;
})();
