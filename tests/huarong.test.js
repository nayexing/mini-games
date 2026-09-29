const test = require('node:test');
const assert = require('node:assert/strict');
const HuarongDao = require('../www/js/huarong');

const board = [1, 2, 3, 4, 5, 6, 7, 0, 8];

test('连滑计一步，撤销恢复棋盘与步数', () => {
  const game = new HuarongDao(3);
  assert.equal(game.restore({ board, moves: 2 }), true);
  const result = game.slide('left');
  assert.equal(result.moved, true);
  assert.equal(result.tiles.length, 1);
  assert.equal(game.isSolved(), true);
  assert.equal(game.moves, 3);
  assert.equal(game.undo(), true);
  assert.deepEqual(game.board, board);
  assert.equal(game.blank, 7);
  assert.equal(game.moves, 2);
  assert.equal(game.undo(), false);
});

test('点同行块合法，非同行列点按不改变棋盘', () => {
  const game = new HuarongDao(3);
  assert.equal(game.restore({ board, moves: 0 }), true);
  assert.equal(game.tapCell(0).moved, false);
  assert.equal(game.moves, 0);
  assert.equal(game.tapCell(6).moved, true);
  assert.equal(game.blank, 6);
  assert.deepEqual(game.board, [1, 2, 3, 4, 5, 6, 0, 7, 8]);
  assert.equal(game.moves, 1);
});

test('有效快照可撤销，恢复后不共享存档引用', () => {
  const save = { board: board.slice(), moves: 3, snapshot: { board: [1, 2, 3, 4, 5, 6, 7, 8, 0], moves: 2 } };
  const game = new HuarongDao(3);
  assert.equal(game.restore(save), true);
  save.board[0] = 8;
  save.snapshot.board[0] = 8;
  assert.equal(game.board[0], 1);
  assert.equal(game.undo(), true);
  assert.deepEqual(game.board, [1, 2, 3, 4, 5, 6, 7, 8, 0]);
  assert.equal(game.moves, 2);
});

test('非法主棋盘拒绝恢复且不修改原状态，损坏快照只丢弃快照', () => {
  const game = new HuarongDao(3);
  assert.equal(game.restore({ board, moves: 1 }), true);
  assert.equal(game.restore({ board: [1, 2, 3, 4, 5, 6, 7, 7, 0], moves: 2 }), false);
  assert.deepEqual(game.board, board);
  assert.equal(game.moves, 1);
  assert.equal(game.restore({ board, moves: 2, snapshot: { board: [1, 2], moves: 1 } }), true);
  assert.equal(game.undo(), false);
  assert.equal(game.moves, 2);
});

test('旧版 9×9 和 10×10 存档仍可恢复', () => {
  for (const size of [9, 10]) {
    const game = new HuarongDao(size);
    const board = Array.from({ length: size * size }, (_, i) => (i + 1) % (size * size));
    assert.equal(game.restore({ board, moves: 12 }), true);
    assert.deepEqual(game.board, board);
    assert.equal(game.moves, 12);
  }
});
