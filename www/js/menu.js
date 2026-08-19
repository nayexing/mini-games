/**
 * 合集主页 —— 数据驱动游戏卡片渲染，新增游戏只需在 GAMES 中加一条数据
 */
(function () {
  'use strict';

  /** 华容道卡片 logo：3×3 浅橡木棋盘 + 数字 1-8（右下留空格，配色由 menu.css 提供） */
  function hrLogoCells() {
    var cells = [];
    for (var v = 1; v <= 8; v++) cells.push({ text: String(v) });
    cells.push({ text: '', cls: 'hr-blank' });
    return cells;
  }

  var GAMES = [
    {
      name: '2048',
      desc: '滑动合并相同数字，冲击 2048',
      url: '2048/',
      logo: 'card-logo-2048',
      cells: [
        { text: '2', style: 'background:#eee4da;color:#776e65' },
        { text: '0', style: 'background:#ede0c8;color:#776e65' },
        { text: '4', style: 'background:#f2b179;color:#f9f6f2' },
        { text: '8', style: 'background:#f59563;color:#f9f6f2' }
      ]
    },
    {
      name: '数字华容道',
      desc: '滑动方块，将数字按顺序复原',
      url: 'huarongdao/',
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
