import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorPayload, matchesEmployeeFilter } from '../src/lib/model.ts';

test('editing a user preserves password when blank and converts linked ids and status', () => {
  const form = new FormData();
  form.set('username', 'office');
  form.set('password', '');
  form.set('role_id', '2');
  form.set('employee_id', '');
  assert.deepEqual(editorPayload('users', form, true), {
    username: 'office', role_id: 2, employee_id: null, active: false,
  });
});

test('employee and account status payloads use booleans for both checkbox states', () => {
  for (const view of ['employees', 'users'] as const) {
    const form = new FormData();
    assert.equal(editorPayload(view, form, false).active, false);
    form.set('active', 'on');
    assert.equal(editorPayload(view, form, false).active, true);
  }
});

test('role payload retains all selected permissions rather than only the last selection', () => {
  const form = new FormData();
  form.set('name', 'ผู้บันทึก');
  form.append('permissions', 'employees.read');
  form.append('permissions', 'employees.update');
  assert.deepEqual(editorPayload('roles', form, false), {
    name: 'ผู้บันทึก', permissions: ['employees.read', 'employees.update'],
  });
});

test('employee filters keep archived records out of current and active lists', () => {
  const archived = { active: 1, archived: 1 };
  assert.equal(matchesEmployeeFilter(archived, 'current'), false);
  assert.equal(matchesEmployeeFilter(archived, 'active'), false);
  assert.equal(matchesEmployeeFilter(archived, 'archived'), true);
  assert.equal(matchesEmployeeFilter({ active: 0, archived: 0 }, 'inactive'), true);
  assert.equal(matchesEmployeeFilter({ active: 0, archived: 1 }, 'all'), true);
});
