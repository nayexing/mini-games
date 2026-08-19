/**
 * 合集主页 —— 数据驱动游戏卡片渲染，新增游戏只需在 GAMES 中加一条数据
 */
(function () {
  'use strict';

  /** 华容道卡片 logo 配色（与游戏内暖色渐变公式一致） */
  function hrLogoCells() {
    var cells = [];
    for (var v = 1; v <= 8; v++) {
      var t = (v - 1) / 7;
      var h = Math.round(36 - t * 8);
      var s = Math.round(30 + t * 42);
      var l = Math.round(83 - t * 35);
      cells.push({
        text: String(v),
        style: 'background:hsl(' + h + ',' + s + '%,' + l + '%);color:' + (l > 60 ? '#776e65' : '#f9f6f2')
      });
    }
    cells.push({ text: '', style: '', cls: 'hr-blank' });
    return cells;
  }

  var GAMES = [
    {
      name: '2048',
      desc: '滑动合并相同数字，冲击 2048',
      url: '2048.html',
      logo: 'card-logo-2048',
      cells: [
        { text: '2',  style: 'background:#eee4da;color:#776e65' },
        { text: '4',  style: 'background:#ede0c8;color:#776e65' },
        { text: '8',  style: 'background:#f2b179;color:#f9f6f2' },
        { text: '16', style: 'background:#f59563;color:#f9f6f2' }
      ]
    },
    {
      name: '数字华容道',
      desc: '滑动方块，将数字按顺序复原',
      url: 'huarongdao.html',
      logo: 'card-logo-hr',
      cells: hrLogoCells()
    }
  ];

  var grid = document.getElementById('game-grid');

  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var card = document.createElement('a');
    card.className = 'game-card';
    card.href = g.url;

    var logo = document.createElement('div');
    logo.className = g.logo;
    logo.setAttribute('aria-hidden', 'true');
    for (var j = 0; j < g.cells.length; j++) {
      var cell = document.createElement('span');
      cell.textContent = g.cells[j].text;
      if (g.cells[j].style) cell.setAttribute('style', g.cells[j].style);
      if (g.cells[j].cls) cell.className = g.cells[j].cls;
      logo.appendChild(cell);
    }

    var name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = g.name;

    var desc = document.createElement('div');
    desc.className = 'card-desc';
    desc.textContent = g.desc;

    card.appendChild(logo);
    card.appendChild(name);
    card.appendChild(desc);
    grid.appendChild(card);
  }
})();
