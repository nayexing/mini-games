const test = require('node:test');
const assert = require('node:assert/strict');
const Sudoku = require('../www/js/sudoku');

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 一道已知唯一解的经典题目及其答案
const PUZZLE = '530070000600195000098000060800060003400803001700020006060000280000419005000080079'.split('').map(Number);
const SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179'.split('').map(Number);

test('求解器：解出已知题目，且判定为唯一解', () => {
  assert.deepEqual(Sudoku.solve(PUZZLE), SOLUTION);
  assert.equal(Sudoku.countSolutions(PUZZLE, 2), 1);
  assert.equal(Sudoku.isValidSolution(SOLUTION), true);
});

test('求解器：多解题目数到上限即停止；矛盾盘面判定无解', () => {
  const sparse = PUZZLE.slice();
  for (let i = 0; i < 81; i += 2) sparse[i] = 0;
  assert.equal(Sudoku.countSolutions(sparse, 2), 2);
  assert.equal(Sudoku.countSolutions(new Array(81).fill(0), 3), 3);

  const broken = PUZZLE.slice();
  broken[2] = 5; // 与同行第 0 格重复
  assert.equal(Sudoku.countSolutions(broken, 2), 0);
  assert.equal(Sudoku.solve(broken), null);
  assert.equal(Sudoku.countSolutions('oops', 2), 0);
});

test('冲突检测：标出同行 / 同列 / 同宫的重复数字，空格不计', () => {
  assert.deepEqual(Sudoku.conflicts(SOLUTION), []);
  const g = new Array(81).fill(0);
  g[0] = 4; g[8] = 4;   // 同行
  g[72] = 4;            // 与 g[0] 同列
  g[10] = 7; g[20] = 7; // 同宫
  assert.deepEqual(Sudoku.conflicts(g), [0, 8, 10, 20, 72]);
});

test('生成：三档难度都得到合法答案、题目与答案一致、唯一解，且提示数落在目标区间', () => {
  for (const [difficulty, [min, max]] of Object.entries(Sudoku.TARGET_CLUES)) {
    for (let seed = 1; seed <= 4; seed++) {
      const { puzzle, solution, clues } = Sudoku.generate(difficulty, seeded(seed * 104729 + min));
      assert.equal(Sudoku.isValidSolution(solution), true);
      assert.equal(puzzle.filter(Boolean).length, clues);
      puzzle.forEach((v, i) => { if (v) assert.equal(v, solution[i]); });
      assert.equal(Sudoku.countSolutions(puzzle, 2), 1, `${difficulty} seed ${seed} 应唯一解`);
      assert.ok(clues >= 17 && clues <= max, `${difficulty} seed ${seed} 提示数 ${clues}`);
      if (difficulty !== 'hard') assert.ok(clues >= min, `${difficulty} 提示数不应少于 ${min}`);
    }
  }
});

test('生成：每局随机，且单次生成不超过时间上限', () => {
  const a = Sudoku.generate('medium');
  const b = Sudoku.generate('medium');
  assert.notDeepEqual(a.solution, b.solution);
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const t0 = performance.now();
    Sudoku.generate(difficulty);
    const ms = performance.now() - t0;
    assert.ok(ms < 1600, `${difficulty} 生成耗时 ${ms.toFixed(0)}ms`);
  }
  assert.throws(() => Sudoku.generate('insane'));
});

test('存档校验：合法状态规范化返回，篡改给定格、答案或笔记的状态被拒绝', () => {
  const values = PUZZLE.slice();
  values[2] = 4; // 在空格填入数字
  const notes = new Array(81).fill(0);
  notes[3] = (1 << 6) | (1 << 8);
  const good = { difficulty: 'medium', puzzle: PUZZLE, solution: SOLUTION, values, notes };
  const normalized = Sudoku.validateState(JSON.parse(JSON.stringify(good)));
  assert.deepEqual(normalized.values, values);
  assert.notEqual(normalized.values, values, '返回副本，不共享引用');

  const tamperedGiven = values.slice(); tamperedGiven[0] = 1;
  const wrongSolution = SOLUTION.slice(); wrongSolution[0] = 9;
  const bad = [
    null,
    { ...good, difficulty: 'nightmare' },
    { ...good, values: tamperedGiven },
    { ...good, solution: wrongSolution },
    { ...good, puzzle: PUZZLE.slice(0, 80) },
    { ...good, notes: notes.map((n, i) => (i === 0 ? 1 : n)) },     // 第 0 位不是合法数字位
    { ...good, notes: notes.map((n, i) => (i === 0 ? 1.5 : n)) },
    { ...good, puzzle: new Array(81).fill(0), values: new Array(81).fill(0) } // 提示过少
  ];
  for (const s of bad) assert.equal(Sudoku.validateState(s), null);
});
