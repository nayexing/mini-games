const test = require('node:test');
const assert = require('node:assert/strict');
const Game2048 = require('../www/js/game');

function state(grid, overrides = {}) {
  return { grid, score: 0, nextId: 20, snapshot: null, ...overrides };
}

function tiles(values) {
  let id = 1;
  return values.map(row => row.map(value => value === null ? null : { id: id++, value }));
}

test('相同方块合并计分，撤销恢复棋盘和分数', () => {
  const game = new Game2048(3);
  const grid = tiles([[2, 2, null], [null, null, null], [null, null, null]]);
  assert.equal(game.restore(state(grid)), true);
  game.addRandomTile = () => null;

  const result = game.move('left');
  assert.equal(result.moved, true);
  assert.equal(result.scoreGained, 4);
  assert.equal(game.score, 4);
  assert.equal(game.grid[0][0].value, 4);
  assert.equal(game.undo(), true);
  assert.deepEqual(game.grid, grid);
  assert.equal(game.score, 0);
  assert.equal(game.undo(), false);
});

test('有效快照恢复后可以撤销且不共享存档引用', () => {
  const grid = tiles([[2, null, null], [null, null, null], [null, null, null]]);
  const previous = tiles([[null, 4, null], [null, null, null], [null, null, null]]);
  const save = state(grid, { score: 8, snapshot: { grid: previous, score: 4 } });
  const game = new Game2048(3);

  assert.equal(game.restore(save), true);
  save.grid[0][0].value = 16;
  save.snapshot.grid[0][1].value = 32;
  assert.equal(game.grid[0][0].value, 2);
  assert.equal(game.undo(), true);
  assert.equal(game.grid[0][1].value, 4);
  assert.equal(game.score, 4);
});

test('损坏的撤销快照被丢弃，主棋盘仍能恢复', () => {
  const grid = tiles([[2, null, null], [null, null, null], [null, null, null]]);
  const invalidSnapshots = [
    { grid: [null, [null, null, null], [null, null, null]], score: 0 },
    { grid: tiles([[2, null, null], [null, 3, null], [null, null, null]]), score: 0 },
    { grid: tiles([[2, null, null], [null, null, null], [null, null, null]]), score: -1 },
    { grid: tiles([[2, null, null], [null, null, null], [null, null, null]]), score: '0' },
    { grid: [[{ id: -1, value: 2 }, null, null], [null, null, null], [null, null, null]], score: 0 }
  ];
  for (const snapshot of invalidSnapshots) {
    const game = new Game2048(3);
    assert.equal(game.restore(state(grid, { snapshot })), true);
    assert.deepEqual(game.grid, grid);
    assert.equal(game.undo(), false);
  }
});

test('无空格且无法合并时为死局，有空格或相邻同值时仍可移动', () => {
  const grid = tiles([[2, 4, 2], [4, 2, 4], [2, 4, 2]]);
  const game = new Game2048(3);
  assert.equal(game.restore(state(grid)), true);
  assert.equal(game.isOver(), true);
  assert.equal(game.move('left').moved, false);
  game.grid[0][0].value = 4;
  assert.equal(game.isOver(), false);
  game.grid[0][0] = null;
  assert.equal(game.isOver(), false);
});
