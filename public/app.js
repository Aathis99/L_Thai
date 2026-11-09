const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const state = { user: null, view: 'employees', employees: [], positions: [], users: [], roles: [], audit: [], permissions: {}, query: '', filter: 'current' };
const labels = { employees: 'พนักงาน', positions: 'ตำแหน่งงาน', users: 'บัญชีผู้ใช้', roles: 'บทบาทและสิทธิ์', audit: 'ประวัติการเปลี่ยนแปลง' };
const subtitles = { employees: 'ข้อมูลคนทำงาน จุดเริ่มต้นของระบบโรงงาน', positions: 'จัดระเบียบตำแหน่งของคนในโรงงาน', users: 'กำหนดว่าใครเข้าสู่ระบบได้ และใช้สิทธิ์ใด', roles: 'แยกสิทธิ์ในระบบออกจากตำแหน่งงาน', audit: 'ตรวจสอบว่าใครเปลี่ยนข้อมูลอะไร เมื่อไร' };
const symbols = { employees: '♙', positions: '▤', users: '⊞', roles: '◇', audit: '◷' };
const can = permission => state.user?.permissions.includes(permission);
const allowed = view => view === 'employees' ? can('employees.read') : view === 'audit' ? can('audit.read') : can(`${view}.manage`);
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500); }
async function api(path, method = 'GET', data) {
  const res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const body = await res.json();
  if (!res.ok) {
    if (res.status === 401 && state.user) { state.user = null; $('#modal').close(); await authScreen(); }
    throw new Error(body.error || 'ไม่สามารถทำรายการได้');
  }
  return body;
}
function logo() { return '<div class="brand"><span class="brand-mark" aria-hidden="true">L</span><div>LTHAI<span>FACTORY MANAGEMENT</span></div></div>'; }
async function authScreen() {
  const { required } = await api('/setup'); state.setup = required;
  $('#app').innerHTML = `<main class="auth"><section class="auth-story">${logo()}<div class="story-copy"><p class="eyebrow">ระบบจัดการโรงงานกระเบื้อง</p><h1>ทุกคน ทุกขั้นตอน<br>เชื่อมงานไว้ที่เดียว</h1><p>วางรากฐานข้อมูลพนักงานและสิทธิ์การทำงาน<br>เพื่อเติบโตไปพร้อมกับโรงงานของคุณ</p><div class="tile-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div></div><div class="story-foot"><span class="dot"></span> LThai Factory <span>ระบบภายใน · ระยะที่ 1</span></div></section><section class="auth-form"><div class="login-box"><span class="section-tag">PEOPLE & ACCESS</span><h2>${required ? 'เริ่มต้นระบบของคุณ' : 'ยินดีต้อนรับกลับ'}</h2><p class="muted">${required ? 'สร้างบัญชีผู้ดูแลคนแรก เพื่อเริ่มจัดการข้อมูลโรงงาน' : 'เข้าสู่ระบบเพื่อจัดการข้อมูลและทำงานต่อ'}</p><form id="auth-form" data-setup="${required}">${required ? field('name', 'ชื่อผู้ดูแล', '', 'text', true) : ''}${field('username', 'ชื่อผู้ใช้', '', 'text', true, 'เช่น admin หรือรหัสพนักงาน')}${field('password', 'รหัสผ่าน', '', 'password', true, required ? 'อย่างน้อย 12 ตัวอักษร' : 'กรอกรหัสผ่านของคุณ')}${required ? field('confirm', 'ยืนยันรหัสผ่าน', '', 'password', true) : ''}<p class="form-error" role="alert"></p><button class="button primary wide" type="submit">${required ? 'สร้างผู้ดูแลและเริ่มใช้งาน' : 'เข้าสู่ระบบ'} <span aria-hidden="true">→</span></button></form><div class="auth-note">${required ? 'คุณเป็นผู้ตั้งรหัสผ่านเอง ระบบไม่มีรหัสผ่านเริ่มต้น' : 'หากลืมรหัสผ่าน ให้ติดต่อผู้ดูแลระบบของโรงงาน'}</div></div><div class="auth-version">LThai Workspace <span>เวอร์ชัน 0.1</span></div></section></main>`;
  $('#auth-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
    if (required && data.password !== data.confirm) { form.querySelector('.form-error').textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน'; return; }
    const button = form.querySelector('button'); button.disabled = true;
    try {
      if (required) await api('/setup', 'POST', data);
      await api('/login', 'POST', { username: data.username, password: data.password });
      await enter();
      if (required) toast('สร้างผู้ดูแลระบบแล้ว เริ่มเพิ่มตำแหน่งและพนักงานได้เลย');
    } catch (error) { form.querySelector('.form-error').textContent = error.message; button.disabled = false; }
  });
}
function field(name, label, value = '', type = 'text', required = false, placeholder = '') {
  return `<label class="field"><span>${label}${required ? ' <b>*</b>' : ''}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${type === 'password' ? 'maxlength="128" autocomplete="' + (name === 'current' || (!state.user && $('#auth-form')?.dataset.setup === 'false') ? 'current-password' : 'new-password') + '"' : 'maxlength="120"'} placeholder="${esc(placeholder)}"></label>`;
}
function select(name, label, value, options, empty = 'ไม่ระบุ') {
  return `<label class="field"><span>${label}</span><select name="${name}" aria-label="${esc(label)}">${empty === null ? '' : `<option value="">${empty}</option>`}${options.map(o => `<option value="${o.id}" ${String(value) === String(o.id) ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>`;
}
function statusField(active = 1) { return `<label class="check-line"><input name="active" type="checkbox" ${active ? 'checked' : ''}><span>เปิดใช้งาน</span></label>`; }
async function refresh() {
  const endpoints = [];
  if (can('employees.read')) endpoints.push('employees'); else state.employees = [];
  if (can('employees.read') || can('positions.manage')) endpoints.push('positions'); else state.positions = [];
  if (can('users.manage')) endpoints.push('users'); else state.users = [];
  if (can('users.manage') || can('roles.manage')) endpoints.push('roles'); else state.roles = [];
  if (can('audit.read')) endpoints.push('audit'); else state.audit = [];
  await Promise.all(endpoints.map(async key => { state[key] = (await api('/' + key)).items; }));
}
async function enter() {
  const me = await api('/me'); state.user = me.user; state.permissions = me.permissions;
  if (!allowed(state.view)) state.view = Object.keys(labels).find(allowed) || 'none';
  await refresh(); shell();
}
function shell() {
  const current = state.employees.filter(e => !e.archived), active = current.filter(e => e.active);
  $('#app').innerHTML = `<div class="workspace"><aside class="sidebar">${logo()}<div class="workspace-label">พื้นที่ทำงานของโรงงาน</div><div class="factory-label"><span class="factory-icon">▧</span><div>โรงงานกระเบื้อง<small>จัดการข้อมูลพื้นฐาน</small></div><span class="live-dot"></span></div><div class="nav-title">บุคลากรและการเข้าถึง</div><nav aria-label="เมนูหลัก">${Object.entries(labels).filter(([key]) => allowed(key)).map(([key, name]) => `<button data-view="${key}" class="nav-item ${state.view === key ? 'selected' : ''}"><span aria-hidden="true">${symbols[key]}</span>${name}${key === 'employees' ? `<small>${current.length}</small>` : ''}</button>`).join('')}</nav><div class="roadmap"><span>พัฒนาทีละส่วน</span><strong>เริ่มจากคน พร้อมต่อยอดงาน</strong><p>ออเดอร์และกระบวนการผลิต<br>อยู่ระหว่างเก็บข้อมูลหน้างาน</p><div class="roadmap-line"><i></i></div><small>ระยะ 1 · พนักงานและสิทธิ์</small></div><div class="sidebar-foot"><span class="avatar">${esc(state.user.name.slice(0, 1))}</span><div><strong>${esc(state.user.name)}</strong><small>${esc(state.user.role_name)}</small></div><button class="icon-button" data-action="logout" title="ออกจากระบบ" aria-label="ออกจากระบบ">↪</button></div></aside><div class="main-wrap"><header class="topbar"><div><span class="breadcrumb">โรงงานกระเบื้อง</span><span class="slash">/</span>${labels[state.view] || 'พื้นที่ทำงาน'}</div><div class="topbar-right"><span class="local-label"><i></i> ระบบภายใน</span><button class="quiet" data-action="password">เปลี่ยนรหัสผ่าน</button><button class="quiet mobile-logout" data-action="logout">ออกจากระบบ</button></div></header><main class="main"><div class="page-head"><div><p class="eyebrow">PEOPLE & ACCESS</p><h1>${labels[state.view] || 'พื้นที่ทำงาน'}</h1><p>${subtitles[state.view] || 'บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าถึงเมนู กรุณาติดต่อผู้ดูแลระบบ'}</p></div>${state.view !== 'audit' && state.view !== 'none' && (state.view === 'employees' ? can('employees.create') : can(state.view + '.manage')) ? `<button class="button primary" data-action="create"><span aria-hidden="true">＋</span> เพิ่ม${state.view === 'roles' ? 'บทบาท' : labels[state.view]}</button>` : ''}</div>${state.view === 'employees' ? `<section class="stats" aria-label="ภาพรวมพนักงาน"><article><span class="stat-icon sand">♙</span><div><span>พนักงานทั้งหมด</span><strong>${current.length}<small>คน</small></strong></div><i>ข้อมูลปัจจุบัน</i></article><article><span class="stat-icon mint">✓</span><div><span>กำลังปฏิบัติงาน</span><strong>${active.length}<small>คน</small></strong></div><i>เปิดใช้งาน</i></article><article><span class="stat-icon clay">▤</span><div><span>ตำแหน่งงาน</span><strong>${state.positions.length}<small>ตำแหน่ง</small></strong></div><i>ตำแหน่งในโรงงาน</i></article></section>` : ''}${state.view === 'users' ? '<div class="info-banner">บัญชีผู้ใช้สำหรับเข้าสู่ระบบ แยกจากทะเบียนพนักงาน — ไม่จำเป็นต้องสร้างบัญชีให้พนักงานทุกคน</div>' : ''}${state.view === 'roles' ? '<div class="info-banner">ตำแหน่งงานบอกว่าทำหน้าที่อะไร ส่วนบทบาทกำหนดสิทธิ์ที่ใช้ในโปรแกรม การเปลี่ยนสิทธิ์มีผลทันที</div>' : ''}${state.view !== 'none' ? `<section class="panel"><div class="panel-toolbar"><div><h2>รายการ${labels[state.view]}</h2><span id="result-count"></span></div><div class="toolbar-controls"><label class="search"><span aria-hidden="true">⌕</span><input id="search" aria-label="ค้นหา${labels[state.view]}" placeholder="ค้นหา${state.view === 'employees' ? 'ชื่อ รหัส หรือแผนก' : labels[state.view]}…" value="${esc(state.query)}"></label>${state.view === 'employees' ? `<select id="filter" aria-label="กรองสถานะ"><option value="current">พนักงานปัจจุบัน</option><option value="active">เปิดใช้งาน</option><option value="inactive">ปิดใช้งาน</option><option value="archived">รายการที่ลบแล้ว</option><option value="all">ทั้งหมดรวมรายการที่ลบ</option></select>` : ''}</div></div><div id="table-area"></div><div class="panel-foot"><span>ข้อมูลบันทึกลงฐานข้อมูลแล้วจะคงอยู่เมื่อเปิดระบบใหม่</span><span>LThai · People workspace</span></div></section>` : '<div class="panel empty"><h2>รอการกำหนดสิทธิ์</h2><p>ผู้ดูแลสามารถเพิ่มสิทธิ์ให้บัญชีนี้จากเมนูบทบาทและสิทธิ์</p></div>'}<footer class="page-foot"><span>LThai Factory Management</span><span>พนักงาน · ตำแหน่ง · สิทธิ์การทำงาน</span></footer></main></div></div>`;
  if ($('#filter')) $('#filter').value = state.filter;
  $('#search')?.addEventListener('input', event => { state.query = event.target.value; table(); });
  $('#filter')?.addEventListener('change', event => { state.filter = event.target.value; table(); });
  table();
}
function table() {
  if (!$('#table-area')) return;
  const view = state.view;
  let items = state[view].filter(item => Object.values(item).some(value => String(value ?? '').toLocaleLowerCase('th').includes(state.query.toLocaleLowerCase('th'))));
  if (view === 'employees') items = items.filter(e => state.filter === 'all' || (state.filter === 'archived' ? e.archived : !e.archived && (state.filter === 'current' || (state.filter === 'active' ? e.active : !e.active))));
  $('#result-count').textContent = `${items.length.toLocaleString('th-TH')} รายการ`;
  if (!items.length) {
    const filtered = state.query || (view === 'employees' && state.filter !== 'current');
    $('#table-area').innerHTML = `<div class="empty"><span class="empty-symbol" aria-hidden="true">${symbols[view]}</span><h3>${filtered ? 'ไม่พบรายการที่ค้นหา' : `ยังไม่มี${labels[view]}`}</h3><p>${filtered ? 'ลองเปลี่ยนคำค้นหาหรือเงื่อนไขการกรอง' : view === 'employees' ? 'เริ่มเพิ่มพนักงานคนแรกได้เลย ข้อมูลจาก Excel จะนำเข้าหลังตรวจหัวคอลัมน์จริง' : view === 'positions' ? 'เพิ่มตำแหน่ง เช่น ธุรการ หรือพนักงานปั๊มขึ้นรูป เพื่อใช้ในทะเบียนพนักงาน' : 'รายการจะปรากฏที่นี่เมื่อเริ่มใช้งาน'}</p>${!filtered && (view === 'employees' ? can('employees.create') : can(view + '.manage')) ? `<button class="button secondary" data-action="create">＋ เพิ่ม${view === 'roles' ? 'บทบาท' : labels[view]}</button>` : ''}</div>`;
    return;
  }
  const badge = (active, archived) => `<span class="badge ${archived ? 'neutral' : active ? 'good' : 'muted-badge'}"><i></i>${archived ? 'ลบแล้ว' : active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>`;
  const actions = item => {
    const edit = view === 'employees' ? can('employees.update') : can(view + '.manage');
    const remove = view === 'employees' ? can('employees.delete') : can(view + '.manage');
    if (item.archived || (view === 'roles' && item.id === 1)) return '<span class="muted">—</span>';
    return `<div class="row-actions">${edit ? `<button data-action="edit" data-id="${item.id}" class="table-button">แก้ไข</button>` : ''}${remove ? `<button data-action="delete" data-id="${item.id}" class="table-button danger">ลบ</button>` : ''}</div>`;
  };
  let headers, rows;
  if (view === 'employees') {
    headers = ['รหัสพนักงาน', 'ชื่อพนักงาน', 'แผนก / ตำแหน่ง', 'เบอร์โทร', 'สถานะ', 'จัดการ'];
    rows = items.map(e => `<td><span class="code">${esc(e.code)}</span></td><td><div class="person"><span class="avatar small">${esc(e.name.slice(0, 1))}</span><strong>${esc(e.name)}</strong></div></td><td>${esc(e.department || 'ยังไม่ระบุแผนก')}<small class="subtext">${esc(e.position_name || 'ยังไม่ระบุตำแหน่ง')}</small></td><td>${esc(e.phone || '—')}</td><td>${badge(e.active, e.archived)}</td><td>${actions(e)}</td>`);
  } else if (view === 'positions') {
    headers = ['ชื่อตำแหน่ง', 'จัดการ']; rows = items.map(e => `<td><strong>${esc(e.name)}</strong></td><td>${actions(e)}</td>`);
  } else if (view === 'users') {
    headers = ['ชื่อผู้ใช้', 'ชื่อที่แสดง', 'บทบาท', 'พนักงานที่เชื่อมโยง', 'สถานะ', 'จัดการ'];
    rows = items.map(e => `<td><span class="code">${esc(e.username)}</span>${e.id === state.user.id ? '<small class="you">คุณ</small>' : ''}</td><td>${esc(e.name)}</td><td>${esc(e.role_name)}</td><td>${esc(e.employee_id ? state.employees.find(p => p.id === e.employee_id)?.name || `พนักงาน #${e.employee_id}` : 'ไม่เชื่อมโยง')}</td><td>${badge(e.active)}</td><td>${actions(e)}</td>`);
  } else if (view === 'roles') {
    headers = ['ชื่อบทบาท', 'สิทธิ์ที่ได้รับ', 'จัดการ'];
    rows = items.map(e => `<td><strong>${esc(e.name)}</strong>${e.id === 1 ? '<small class="subtext">บทบาทสงวนของระบบ</small>' : ''}</td><td><div class="permission-tags">${e.permissions.map(p => `<span>${esc(state.permissions[p])}</span>`).join('') || '<span>ยังไม่มีสิทธิ์</span>'}</div></td><td>${actions(e)}</td>`);
  } else {
    headers = ['วัน / เวลา', 'ผู้ทำรายการ', 'การเปลี่ยนแปลง', 'รหัสรายการ'];
    rows = items.map(e => `<td>${new Date(e.created_at.replace(' ', 'T') + 'Z').toLocaleString('th-TH')}</td><td>${esc(e.actor)}</td><td>${esc(e.action)}</td><td><span class="code">${esc(e.target)}</span></td>`);
  }
  $('#table-area').innerHTML = `<div class="table-scroll"><table><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row}</tr>`).join('')}</tbody></table></div>`;
}
function dialog(title, content, submitLabel, onSubmit, danger = false) {
  const modal = $('#modal');
  modal.innerHTML = `<form id="dialog-form"><div class="modal-head"><div><p class="eyebrow">LTHAI WORKSPACE</p><h2 id="modal-title">${title}</h2></div><button type="button" data-action="close" class="icon-button" aria-label="ปิด">×</button></div><div class="modal-body">${content}<p class="form-error" role="alert"></p></div><div class="modal-foot"><button type="button" data-action="close" class="button secondary">ยกเลิก</button><button type="submit" class="button ${danger ? 'destructive' : 'primary'}">${submitLabel}</button></div></form>`;
  modal.showModal();
  $('#dialog-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try { await onSubmit(form); modal.close(); } catch (error) { form.querySelector('.form-error').textContent = error.message; } finally { button.disabled = false; }
  });
}
function editor(id) {
  const view = state.view, item = state[view].find(e => e.id === id) || {}, editing = Boolean(id);
  let content;
  if (view === 'employees') content = `<div class="form-grid">${field('code', 'รหัสพนักงาน', item.code, 'text', true)}${field('name', 'ชื่อ–นามสกุล', item.name, 'text', true)}${field('department', 'แผนก', item.department)}${select('position_id', 'ตำแหน่งงาน', item.position_id, state.positions)}${field('phone', 'เบอร์โทร', item.phone, 'tel')}</div>${statusField(item.active ?? 1)}<p class="helper">ทะเบียนพนักงานไม่ใช่บัญชีเข้าสู่ระบบ สร้างบัญชีแยกได้ที่เมนูบัญชีผู้ใช้</p>`;
  if (view === 'positions') content = `${field('name', 'ชื่อตำแหน่งงาน', item.name, 'text', true)}<p class="helper">ตำแหน่งบอกหน้าที่ในโรงงาน ไม่ได้กำหนดสิทธิ์การใช้งานโปรแกรม</p>`;
  if (view === 'users') {
    const employees = state.employees.filter(e => !e.archived).map(e => ({ id: e.id, name: `${e.code} · ${e.name}` }));
    if (item.employee_id && !employees.some(e => e.id === item.employee_id)) employees.push({ id: item.employee_id, name: `พนักงาน #${item.employee_id}` });
    content = `<div class="form-grid">${field('username', 'ชื่อผู้ใช้', item.username, 'text', true)}${field('name', 'ชื่อที่แสดง', item.name, 'text', true)}${select('role_id', 'บทบาทสิทธิ์', item.role_id || state.roles.find(r => r.id !== 1)?.id || 1, state.roles, null)}${select('employee_id', 'เชื่อมโยงกับพนักงาน', item.employee_id, employees, 'ไม่เชื่อมโยง')}${field('password', editing ? 'ตั้งรหัสผ่านใหม่ (เว้นว่างเพื่อใช้เดิม)' : 'รหัสผ่าน', '', 'password', !editing, 'อย่างน้อย 12 ตัวอักษร')}</div>${statusField(item.active ?? 1)}<p class="helper">เมื่อปิดบัญชีหรือเปลี่ยนรหัสผ่าน เซสชันเดิมของบัญชีนี้จะสิ้นสุดทันที</p>`;
  }
  if (view === 'roles') content = `${field('name', 'ชื่อบทบาท', item.name, 'text', true)}<p class="field-caption">สิทธิ์ที่อนุญาต</p><div class="permission-grid">${Object.entries(state.permissions).map(([key, label]) => `<label class="check-line"><input name="permissions" type="checkbox" value="${key}" ${item.permissions?.includes(key) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div><p class="helper">เลือกเฉพาะสิทธิ์ที่ต้องใช้ การเปลี่ยนแปลงมีผลกับทุกบัญชีในบทบาทนี้ทันที</p>`;
  dialog(`${editing ? 'แก้ไข' : 'เพิ่ม'}${view === 'roles' ? 'บทบาท' : labels[view]}`, content, 'บันทึกข้อมูล', async form => {
    const data = Object.fromEntries(new FormData(form));
    if (view === 'employees' || view === 'users') data.active = form.elements.active.checked;
    for (const key of ['position_id', 'role_id', 'employee_id']) if (Object.hasOwn(data, key)) data[key] = data[key] ? Number(data[key]) : null;
    if (view === 'roles') data.permissions = [...form.querySelectorAll('input[name="permissions"]:checked')].map(e => e.value);
    await api('/' + view + (id ? '/' + id : ''), editing ? 'PUT' : 'POST', data);
    await enter(); toast('บันทึกข้อมูลเรียบร้อยแล้ว');
  });
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  try {
    if (button.dataset.view) { state.view = button.dataset.view; state.query = ''; state.filter = 'current'; await enter(); }
    const action = button.dataset.action;
    if (action === 'close') $('#modal').close();
    if (action === 'create' || action === 'edit') editor(Number(button.dataset.id) || undefined);
    if (action === 'logout') { await api('/logout', 'POST', {}); state.user = null; await authScreen(); }
    if (action === 'delete') {
      const view = state.view, id = Number(button.dataset.id), item = state[view].find(e => e.id === id);
      const note = view === 'employees' ? 'จะเก็บทะเบียนไว้ใน “รายการที่ลบแล้ว” และปิดบัญชีที่เชื่อมโยง เพื่อไม่ให้ข้อมูลอ้างอิงสูญหาย' : view === 'users' ? 'บัญชีนี้จะเข้าสู่ระบบไม่ได้อีก ประวัติการทำรายการยังคงอยู่' : 'หากยังมีรายการอ้างอิงอยู่ ระบบจะไม่อนุญาตให้ลบ';
      dialog('ยืนยันการลบ', `<p>ต้องการลบ <strong>${esc(item.name)}</strong> ใช่หรือไม่?</p><p class="helper">${note}</p>`, 'ยืนยันลบ', async () => { await api('/' + view + '/' + id, 'DELETE'); await enter(); toast('ลบรายการเรียบร้อยแล้ว'); }, true);
    }
    if (action === 'password') dialog('เปลี่ยนรหัสผ่าน', `${field('current', 'รหัสผ่านเดิม', '', 'password', true)}${field('password', 'รหัสผ่านใหม่', '', 'password', true, 'อย่างน้อย 12 ตัวอักษร')}${field('confirm', 'ยืนยันรหัสผ่านใหม่', '', 'password', true)}<p class="helper">เปลี่ยนแล้วต้องเข้าสู่ระบบใหม่ทุกอุปกรณ์</p>`, 'เปลี่ยนรหัสผ่าน', async form => {
      const data = Object.fromEntries(new FormData(form)); if (data.password !== data.confirm) throw new Error('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
      await api('/password', 'POST', data); state.user = null; await authScreen(); toast('เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่');
    });
  } catch (error) { toast(error.message); }
});
async function boot() { try { await enter(); } catch (error) { if (!state.user) await authScreen(); else throw error; } }
boot().catch(error => { $('#app').innerHTML = `<main class="loading"><h1>เปิดระบบไม่สำเร็จ</h1><p>${esc(error.message)}</p><button class="button secondary" data-action="retry">ลองใหม่</button></main>`; });
document.addEventListener('click', event => { if (event.target.closest('[data-action="retry"]')) location.reload(); });

