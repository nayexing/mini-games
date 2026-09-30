const test = require('node:test');
const assert = require('node:assert/strict');
const { GAMES, formatTime } = require('../www/js/common/games');

const byId = Object.fromEntries(GAMES.map(g => [g.id, g]));

/** 用对象模拟某游戏命名空间下的本地存储 */
function store(data) {
  return (key, fallback) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback);
}

function grid2048(values) {
  let id = 1;
  return values.map(row => row.map(v => (v === null ? null : { id: id++, value: v })));
}

test('注册表包含四款游戏且字段完整、存储前缀互不相同', () => {
  assert.deepEqual(GAMES.map(g => g.id), ['2048', 'huarongdao', 'minesweeper', 'sudoku']);
  const prefixes = new Set(GAMES.map(g => g.storagePrefix));
  assert.equal(prefixes.size, GAMES.length);
  for (const g of GAMES) {
    assert.ok(g.name && g.desc && g.url && g.logo && Array.isArray(g.cells));
    assert.equal(typeof g.summarize, 'function');
  }
});

test('从未玩过时所有游戏返回 null（显示简介）', () => {
  for (const g of GAMES) assert.equal(g.summarize(store({})), null);
});

test('formatTime 支持分秒与小时', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(80), '01:20');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(-5), '00:00');
});

test('2048：进行中显示继续，死局或新开局显示最高分', () => {
  const s = byId['2048'];
  const playing = { save: { size: 4, score: 1234, grid: grid2048([[2, 4, null, null], [8, null, null, null], [null, null, null, null], [null, null, null, null]]) } };
  assert.deepEqual(s.summarize(store(playing)), { kind: 'resume', text: '继续 · 4×4 · 1234 分' });

  const dead = { save: { size: 3, score: 500, grid: grid2048([[2, 4, 2], [4, 2, 4], [2, 4, 2]]) }, best_3: 800 };
  assert.deepEqual(s.summarize(store(dead)), { kind: 'best', text: '最高分 800 · 3×3' });

  const fresh = { save: { size: 4, score: 0, grid: grid2048([[2, null, null, null], [null, null, 2, null], [null, null, null, null], [null, null, null, null]]) }, best_5: 3000, best_4: 1500, last_size: 5 };
  assert.deepEqual(s.summarize(store(fresh)), { kind: 'best', text: '最高分 3000 · 5×5' });
});

test('华容道：有步数显示继续，否则显示最佳步数；兼容旧版 10×10 存档', () => {
  const s = byId.huarongdao;
  assert.deepEqual(
    s.summarize(store({ save: { size: 4, moves: 32, elapsed: 80 } })),
    { kind: 'resume', text: '继续 · 4×4 · 32 步 · 01:20' }
  );
  assert.deepEqual(
    s.summarize(store({ save: { size: 10, moves: 5, elapsed: 3 } })),
    { kind: 'resume', text: '继续 · 10×10 · 5 步 · 00:03' }
  );
  assert.deepEqual(
    s.summarize(store({ save: { size: 4, moves: 0, elapsed: 0 }, best_4: 58 })),
    { kind: 'best', text: '4×4 最佳 58 步' }
  );
});

test('扫雷与数独：进行中显示继续，否则显示最短用时', () => {
  const ms = byId.minesweeper;
  assert.deepEqual(
    ms.summarize(store({ save: { level: 'intermediate', state: 'playing', elapsed: 95 } })),
    { kind: 'resume', text: '继续 · 中级 · 01:35' }
  );
  assert.deepEqual(
    ms.summarize(store({ save: { level: 'beginner', state: 'ready', elapsed: 0 }, best_beginner: 42 })),
    { kind: 'best', text: '初级最佳 00:42' }
  );

  const sd = byId.sudoku;
  assert.deepEqual(
    sd.summarize(store({ save: { difficulty: 'hard', elapsed: 610 } })),
    { kind: 'resume', text: '继续 · 困难 · 10:10' }
  );
  assert.deepEqual(
    sd.summarize(store({ best_easy: 300, best_medium: 480, last_difficulty: 'medium' })),
    { kind: 'best', text: '中等最佳 08:00' }
  );
});

test('异常数据不抛错，退回显示简介', () => {
  const garbage = [
    { save: 'oops' },
    { save: { size: 99, score: 10, grid: [] } },
    { save: { size: 4, score: -1, grid: 'x' } },
    { save: { size: 4, moves: 'many', elapsed: 1 } },
    { save: { level: 'god', state: 'playing', elapsed: 1 } },
    { save: { difficulty: 'easy', elapsed: -3 } },
    { best_4: 'NaN', best_beginner: -1, best_easy: 0 }
  ];
  for (const g of GAMES) {
    for (const data of garbage) assert.equal(g.summarize(store(data)), null, `${g.id} ${JSON.stringify(data)}`);
  }
});
