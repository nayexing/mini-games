const test = require('node:test');
const assert = require('node:assert/strict');
const Minesweeper = require('../www/js/minesweeper');

/** 可复现的伪随机数（LCG） */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 手动布雷：跳过随机布雷，直接进入 playing 状态 */
function withMines(rows, cols, mineIdx) {
  const g = new Minesweeper(rows, cols, mineIdx.length);
  g.mine = new Array(rows * cols).fill(false);
  for (const i of mineIdx) g.mine[i] = true;
  g.computeAdjacency();
  g.state = 'playing';
  return g;
}

test('参数校验：尺寸越界或雷数过多时拒绝创建', () => {
  assert.throws(() => new Minesweeper(4, 9, 5));
  assert.throws(() => new Minesweeper(9, 9, 0));
  assert.throws(() => new Minesweeper(9, 9, 73)); // 81 - 9 = 72 为上限
  assert.doesNotThrow(() => new Minesweeper(9, 9, 72));
});

test('首击安全：多种随机种子下首击格及周围八格都无雷，且雷数准确', () => {
  for (const [level, cfg] of Object.entries(Minesweeper.LEVELS)) {
    for (let seed = 1; seed <= 40; seed++) {
      const g = new Minesweeper(cfg.rows, cfg.cols, cfg.mines, seeded(seed * 7919));
      const first = (seed * 37) % g.size();
      const res = g.reveal(first);
      assert.notEqual(res.state, 'lost', `${level} seed ${seed}`);
      assert.equal(g.mine[first], false);
      for (const nb of g.neighbors(first)) assert.equal(g.mine[nb], false);
      assert.equal(g.mine.filter(Boolean).length, cfg.mines);
      assert.equal(g.view(first).count, 0, '首击格周围无雷，必然连锁展开');
      assert.ok(res.changed.length > 1);
    }
  }
});

test('连锁展开：0 格向外扩散直到数字边界，不翻开雷与旗', () => {
  // 5×5，唯一的雷在右下角 (4,4)=24
  const g = withMines(5, 5, [24]);
  g.toggleFlag(18); // (3,3) 插旗，扩散不应翻开它
  const res = g.reveal(0);
  assert.equal(g.view(24).status, 'hidden');
  assert.equal(g.view(18).status, 'flag');
  assert.equal(res.changed.includes(24), false);
  assert.equal(g.revealed, 25 - 1 - 1);
  assert.equal(res.state, 'playing', '被旗挡住的安全格尚未翻开');
});

test('插旗：只能在未翻开格切换，剩余雷数随之变化；已翻开格不可插旗', () => {
  const g = withMines(5, 5, [24]);
  assert.equal(g.remaining(), 1);
  g.toggleFlag(24);
  assert.equal(g.remaining(), 0);
  assert.equal(g.reveal(24).changed.length, 0, '旗子格点按不翻开');
  g.toggleFlag(24);
  assert.equal(g.remaining(), 1);
  g.reveal(0);
  assert.deepEqual(g.toggleFlag(0).changed, []);
});

test('快速翻开：旗数等于数字时翻开周围；旗插错则踩雷', () => {
  // 雷在 (0,1)=1，(1,1)=6 的数字为 1
  const ok = withMines(5, 5, [1]);
  ok.reveal(6);
  assert.equal(ok.view(6).count, 1);
  assert.deepEqual(ok.chord(6).changed, [], '旗数不足时不操作');
  ok.toggleFlag(1);
  const res = ok.chord(6);
  assert.ok(res.changed.length > 0);
  assert.equal(res.state, 'won');

  const bad = withMines(5, 5, [1]);
  bad.reveal(6);
  bad.toggleFlag(0); // 旗插在错误位置
  const boom = bad.chord(6);
  assert.equal(boom.state, 'lost');
  assert.equal(bad.exploded, 1);
  assert.ok(boom.changed.includes(1) && boom.changed.includes(0), '雷与错旗都需要重绘');
});

test('胜负判定：翻开全部安全格即胜利并自动补旗；踩雷即失败且后续操作无效', () => {
  const g = withMines(5, 5, [0, 24]);
  const res = g.reveal(12);
  assert.equal(res.state, 'won');
  assert.equal(g.view(0).status, 'flag');
  assert.equal(g.view(24).status, 'flag');
  assert.equal(g.remaining(), 0);

  const lose = withMines(5, 5, [0]);
  assert.equal(lose.reveal(0).state, 'lost');
  assert.deepEqual(lose.reveal(12).changed, []);
  assert.deepEqual(lose.toggleFlag(12).changed, []);
});

test('存档：进行中的对局可精确恢复，恢复后行为一致', () => {
  const g = new Minesweeper(9, 9, 10, seeded(42));
  g.reveal(40);
  const safe = g.mine.findIndex((m, i) => !m && g.view(i).status === 'hidden');
  const mine = g.mine.indexOf(true);
  g.toggleFlag(mine);
  const saved = JSON.parse(JSON.stringify(g.serialize()));

  const r = new Minesweeper(9, 9, 10);
  assert.equal(r.restore(saved), true);
  assert.deepEqual(r.mine, g.mine);
  assert.deepEqual(r.adj, g.adj);
  assert.equal(r.revealed, g.revealed);
  assert.equal(r.remaining(), 9);
  assert.equal(r.state, 'playing');
  assert.deepEqual(r.reveal(safe).changed, g.reveal(safe).changed);

  const fresh = new Minesweeper(9, 9, 10);
  assert.equal(fresh.restore(new Minesweeper(9, 9, 10).serialize()), true, '未开局状态也可恢复');
  assert.equal(fresh.state, 'ready');
});

test('存档：尺寸不符、雷位重复、翻开过雷等异常数据一律拒绝且不改动原状态', () => {
  const g = new Minesweeper(9, 9, 10, seeded(7));
  g.reveal(0);
  const good = g.serialize();
  const target = new Minesweeper(9, 9, 10);
  const before = target.serialize();

  const bad = [
    null,
    'x',
    { ...good, rows: 16 },
    { ...good, state: 'won' },
    { ...good, cells: good.cells.slice(1) },
    { ...good, cells: good.cells.replace(/./, '9') },
    { ...good, mineAt: good.mineAt.slice(1) },
    { ...good, mineAt: [good.mineAt[0], ...good.mineAt.slice(0, -1)] },
    { ...good, mineAt: good.mineAt.map((m, k) => (k === 0 ? -1 : m)) },
    { ...good, cells: good.cells.split('').map((c, i) => (i === good.mineAt[0] ? '1' : c)).join('') },
    { ...good, state: 'ready' }
  ];
  for (const s of bad) {
    assert.equal(target.restore(s), false, JSON.stringify(s && s.state));
    assert.deepEqual(target.serialize(), before);
  }
});
