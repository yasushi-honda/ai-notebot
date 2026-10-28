import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_THEMES,
  MAX_THEMES,
  MAX_CANDIDATES_FOR_STAGE_A,
  runStageA,
  generateWithCitationRetry,
  generateThemesWithDrop,
  StageBExhaustedError,
} from '../lib/digest-curation.mjs';

const mkItems = (n) => Array.from({ length: n }, (_, i) => ({ id: `s-${String(i).padStart(10, '0')}`, source: 'S', title: `t${i}`, summary: `d${i}` }));
const stageA = (items, themes) => ({
  items,
  personaLine: 'ペルソナ',
  candidateKind: '種類',
  generate: async () => JSON.stringify({ themes }),
});
const theme = (title, sourceIds) => ({ title, angle: `${title}の観点`, sourceIds });

test('runStageA: 候補は上限件数で切られ、上限を超えた id はテーマから落ちる', async () => {
  const items = mkItems(MAX_CANDIDATES_FOR_STAGE_A + 5);
  let prompt = '';
  const themes = await runStageA({
    items,
    personaLine: 'ペルソナ',
    candidateKind: '種類',
    generate: async ({ prompt: p }) => {
      prompt = p;
      return JSON.stringify({
        themes: [
          theme('A', [items[0].id, items[MAX_CANDIDATES_FOR_STAGE_A].id]), // 61件目は範囲外
          theme('B', [items[1].id]),
          theme('C', [items[2].id]),
        ],
      });
    },
  });
  assert.ok(prompt.includes(items[MAX_CANDIDATES_FOR_STAGE_A - 1].id));
  assert.ok(!prompt.includes(items[MAX_CANDIDATES_FOR_STAGE_A].id));
  assert.deepEqual(themes[0].sourceIds, [items[0].id]);
});

test('runStageA: テーマ数は上限で切り、最小数（ちょうど）なら通り、最小数未満なら例外', async () => {
  const items = mkItems(20);
  const many = Array.from({ length: MAX_THEMES + 2 }, (_, i) => theme(`T${i}`, [items[i].id]));
  assert.equal((await runStageA(stageA(items, many))).length, MAX_THEMES);

  const exact = Array.from({ length: MIN_THEMES }, (_, i) => theme(`T${i}`, [items[i].id]));
  assert.equal((await runStageA(stageA(items, exact))).length, MIN_THEMES);

  const tooFew = Array.from({ length: MIN_THEMES - 1 }, (_, i) => theme(`T${i}`, [items[i].id]));
  await assert.rejects(runStageA(stageA(items, tooFew)), /テーマが3件未満/);
});

test('runStageA: 実在する id が1つも無いテーマは落ち、そのせいで最小数を割れば例外', async () => {
  const items = mkItems(10);
  const themes = [theme('A', [items[0].id]), theme('B', [items[1].id]), theme('C', ['s-ffffffffff'])];
  await assert.rejects(runStageA(stageA(items, themes)), /テーマが3件未満/);
});

function retryOpts(overrides = {}) {
  return {
    theme: { title: 'テーマ' },
    schema: {},
    postprocess: (r) => r,
    evaluate: () => [],
    ...overrides,
  };
}

test('generateWithCitationRetry: 試行ごとに異なる問題点が累積して次のプロンプトに渡る', async () => {
  const seenInstructions = [];
  let call = 0;
  const out = await generateWithCitationRetry(
    retryOpts({
      buildPrompt: (extra) => {
        seenInstructions.push([...extra]);
        return 'p';
      },
      generate: async () => JSON.stringify({ n: ++call }),
      evaluate: (r) => (r.n === 1 ? ['P1'] : r.n === 2 ? ['P2'] : []),
    }),
  );
  assert.equal(out.n, 3);
  assert.deepEqual(seenInstructions, [[], ['P1'], ['P1', 'P2']]);
});

test('generateWithCitationRetry: 1回目で採用なら生成は1回だけ。最終試行での採用は例外にならず、使い切れば StageBExhaustedError', async () => {
  let calls = 0;
  await generateWithCitationRetry(
    retryOpts({ buildPrompt: () => 'p', generate: async () => (calls++, '{}') }),
  );
  assert.equal(calls, 1);

  let n = 0;
  const last = await generateWithCitationRetry(
    retryOpts({ buildPrompt: () => 'p', maxAttempts: 3, generate: async () => JSON.stringify({ n: ++n }), evaluate: (r) => (r.n < 3 ? ['x'] : []) }),
  );
  assert.equal(last.n, 3);

  await assert.rejects(
    generateWithCitationRetry(retryOpts({ buildPrompt: () => 'p', maxAttempts: 2, generate: async () => '{}', evaluate: () => ['常にNG'] })),
    StageBExhaustedError,
  );
});

test('generateWithCitationRetry: postprocess は evaluate より先に適用される', async () => {
  const order = [];
  await generateWithCitationRetry(
    retryOpts({
      buildPrompt: () => 'p',
      generate: async () => JSON.stringify({ body: 'raw' }),
      postprocess: (r) => (order.push('post'), { body: `${r.body}+normalized` }),
      evaluate: (r) => (order.push(`eval:${r.body}`), []),
    }),
  );
  assert.deepEqual(order, ['post', 'eval:raw+normalized']);
});

const themes3 = ['A', 'B', 'C', 'D'].map((t, i) => ({ title: t, sourceIds: [`s-${i}`] }));

test('generateThemesWithDrop: StageBExhaustedError のテーマだけ除外し、順序を保って残りを返す', async () => {
  const { sections, droppedTitles, themes } = await generateThemesWithDrop({
    candidateThemes: themes3,
    runTheme: async (t) => {
      if (t.title === 'B') throw new StageBExhaustedError('x');
      return { bodyMarkdown: `${t.title}本文` };
    },
    minThemes: 3,
  });
  assert.deepEqual(droppedTitles, ['B']);
  assert.deepEqual(themes.map((t) => t.title), ['A', 'C', 'D']);
  assert.deepEqual(sections.map((s) => s.bodyMarkdown), ['A本文', 'C本文', 'D本文']);
});

test('generateThemesWithDrop: StageBExhaustedError 以外の例外（API障害等）は握りつぶさず再送出し、残りのテーマは処理しない', async () => {
  const called = [];
  await assert.rejects(
    generateThemesWithDrop({
      candidateThemes: themes3,
      runTheme: async (t) => {
        called.push(t.title);
        if (t.title === 'B') throw new TypeError('HTTP 500');
        return { bodyMarkdown: 'x' };
      },
      minThemes: 3,
    }),
    TypeError,
  );
  assert.deepEqual(called, ['A', 'B']);
});

test('generateThemesWithDrop: 除外が重なって最小数を割れば、除外したテーマ名を含む例外', async () => {
  await assert.rejects(
    generateThemesWithDrop({
      candidateThemes: themes3,
      runTheme: async (t) => {
        if (t.title === 'A' || t.title === 'C') throw new StageBExhaustedError('x');
        return { bodyMarkdown: 'x' };
      },
      minThemes: 3,
    }),
    /3件未満.*A \/ C/,
  );
});
