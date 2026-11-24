import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fireAtField, atField } from '../src/components/kiln-prototype/types.ts';

function form(date: string, hour: string, minute: string) {
  const result = new FormData();
  result.set('at_date', date); result.set('at_hour', hour); result.set('at_minute', minute);
  return result;
}

test('24-hour kiln input retains Bangkok offset and pads hours/minutes without shifting the date', () => {
  assert.equal(fireAtField(form('2026-11-24', '13', '30')), '2026-11-24T13:30:00+07:00');
  assert.equal(fireAtField(form('2026-11-25', '0', '5')), '2026-11-25T00:05:00+07:00');
  assert.equal(fireAtField(form('2026-11-24', '23', '59')), '2026-11-24T23:59:00+07:00');
});

test('kiln input rejects missing, impossible and non-integer date/time values', () => {
  for (const [date, hour, minute] of [
    ['2026-11-24', '', '30'], ['2026-11-24', '13', ''], ['2026-11-24', '24', '00'],
    ['2026-11-24', '13', '60'], ['2026-11-24', '-1', '00'], ['2026-11-24', '1.5', '00'],
    ['2026-11-24', '1e1', '00'], ['2026-02-30', '13', '30'], ['', '13', '30'],
  ]) assert.throws(() => fireAtField(form(date, hour, minute)));
});

test('QC and allocation keep their existing datetime-local payload', () => {
  const input = new FormData(); input.set('at', '2026-11-24T13:30');
  assert.equal(atField(input), '2026-11-24T13:30:00+07:00');
});
