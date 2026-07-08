import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampMp4Duration } from '../../core.mjs';

test('clampMp4Duration 区间内数值原样返回', () => {
  assert.equal(clampMp4Duration(6), 6);
  assert.equal(clampMp4Duration(7.5), 7.5);
});

test('clampMp4Duration 超出 [1,60] 区间的数值被 clamp 到边界', () => {
  assert.equal(clampMp4Duration(0.5), 1);
  assert.equal(clampMp4Duration(999), 60);
});

test('clampMp4Duration 非有限数字输入返回默认值 6', () => {
  assert.equal(clampMp4Duration(NaN), 6);
  assert.equal(clampMp4Duration('6'), 6);
  assert.equal(clampMp4Duration(undefined), 6);
});
