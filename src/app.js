/* 前端只管理文字、界面与网络请求，所有数学计算都在后端。 */
'use strict';

const $ = (selector) => document.querySelector(selector);
const config = window.CALC_CONFIG;
const input = $('#expression');
const result = $('#result');
const message = $('#message');
const calculateButton = $('#calculate-button');
const canvas = document.createElement('canvas');
const context = canvas.getContext('2d');
const state = {
  expression: '', revision: 0, result: '', confirmed: false, busy: false,
  previewController: null, previewTimer: null, historyRevision: 0,
  page: 1, pageSize: 6, query: '', total: 0, requestId: null,
};

function readPreference(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function savePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 无痕浏览仍然可用。 */ }
}

function validApiUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('请填写有效的 HTTP 或 HTTPS 服务地址，不要包含密码或查询参数。');
  }
  if (location.protocol === 'https:' && url.protocol !== 'https:') {
    throw new Error('HTTPS 网页需要连接 HTTPS 服务。');
  }
  return url.href.replace(/\/+$/, '');
}

let apiBaseUrl;
try { apiBaseUrl = validApiUrl(readPreference('calc-api-url', config.apiBaseUrl)); }
catch { apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, ''); }

function connection(online) {
  const badge = $('#connection');
  badge.className = `connection ${online ? 'online' : 'offline'}`;
  badge.querySelector('span').textContent = online ? '服务已连接' : '服务未连接';
}

function setMessage(text, kind = '') {
  message.textContent = text;
  message.className = `message ${kind}`;
}

let toastTimer;
function toast(text) {
  const element = $('#toast');
  element.textContent = text;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 2600);
}

async function apiRequest(path, options = {}, asBlob = false) {
  const controller = new AbortController();
  const callerSignal = options.signal;
  const cancel = () => controller.abort();
  callerSignal?.addEventListener('abort', cancel, {once: true});
  if (callerSignal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.requestTimeout);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options, signal: controller.signal, cache: 'no-store',
      headers: {'Content-Type': 'application/json', ...options.headers},
    });
    const data = asBlob && response.ok ? await response.blob() : await response.json();
    connection(true);
    if (!response.ok) {
      const error = new Error(data.message || '请求未能完成');
      error.code = data.code;
      throw error;
    }
    return data;
  } catch (error) {
    if (callerSignal?.aborted && !timedOut) throw error;
    if (error instanceof TypeError || timedOut || error.name === 'SyntaxError') {
      connection(false);
      const offline = new Error(timedOut ? '服务响应超时，请稍后重试。' : '无法连接计算服务，请检查连接设置或确认后端正在运行。');
      offline.code = 'NETWORK_ERROR';
      throw offline;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', cancel);
  }
}

function measure(text, size) {
  const style = getComputedStyle(input);
  context.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
  return context.measureText(text).width;
}

function fitsInput(text) {
  return text.length <= 128 && measure(text || '0', 18) <= Math.max(input.clientWidth - 6, 0);
}

function resizeText() {
  let size = 46;
  while (size > 18 && measure(input.value || '0', size) > input.clientWidth - 6) size -= 1;
  input.style.fontSize = `${size}px`;
  result.style.fontSize = `${Math.min(30, Math.max(14, size - 6))}px`;
  $('#input-counter').textContent = `${input.value.length} / 128`;
}

function invalidatePreview() {
  clearTimeout(state.previewTimer);
  state.previewController?.abort();
  state.previewController = null;
  state.revision += 1;
}

function updateExpression(text, selection = text.length) {
  if (!fitsInput(text)) {
    toast('这一行已经满了，可以退格修改或先确认计算。');
    input.value = state.expression;
    resizeText();
    return false;
  }
  invalidatePreview();
  state.expression = text;
  state.confirmed = false;
  state.requestId = null;
  state.result = '';
  input.value = text;
  input.setSelectionRange(selection, selection);
  result.textContent = '—';
  $('#result-label').textContent = '实时结果';
  resizeText();
  if (!text.trim()) {
    setMessage('输入一个表达式，结果会在下方出现。');
    return true;
  }
  setMessage('等待计算服务返回预览…');
  state.previewTimer = setTimeout(preview, config.previewDelay);
  return true;
}

async function preview() {
  const revision = state.revision;
  const controller = new AbortController();
  state.previewController = controller;
  try {
    const data = await apiRequest('/api/preview', {
      method: 'POST', body: JSON.stringify({expression: state.expression}),
      signal: controller.signal,
    });
    if (revision !== state.revision) return;
    state.result = data.result;
    result.textContent = data.result;
    setMessage('预览已就绪 · 按 Enter 确认并保存。');
  } catch (error) {
    if (controller.signal.aborted || revision !== state.revision) return;
    result.textContent = '—';
    setMessage(error.message, error.code === 'INCOMPLETE_EXPRESSION' ? '' : 'error');
  }
}

function insertText(text) {
  if (state.confirmed) {
    if (/^[+−×÷^%]$/.test(text)) {
      updateExpression(state.result + text);
    } else {
      updateExpression(text === '.' ? '0.' : text);
    }
    input.focus();
    return;
  }
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const next = input.value.slice(0, start) + text + input.value.slice(end);
  updateExpression(next, start + text.length);
  input.focus();
}

function backspace() {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const left = start === end ? Math.max(0, start - 1) : start;
  updateExpression(input.value.slice(0, left) + input.value.slice(end), left);
  input.focus();
}

async function calculate() {
  if (state.busy) return;
  if (!state.expression.trim()) { setMessage('请先输入表达式。', 'error'); return; }
  if (state.confirmed) { toast('这次计算已经保存，可以继续输入。'); return; }
  invalidatePreview();
  const revision = state.revision;
  const expression = state.expression;
  state.requestId ||= crypto.randomUUID ? crypto.randomUUID() : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  state.busy = true;
  calculateButton.disabled = true;
  result.textContent = '…';
  setMessage('正在计算并保存…');
  try {
    const data = await apiRequest('/api/calculate', {
      method: 'POST', body: JSON.stringify({expression, request_id: state.requestId}),
    });
    if (revision === state.revision) {
      state.result = data.result;
      state.confirmed = true;
      result.textContent = data.result;
      $('#result-label').textContent = '计算结果';
      setMessage('已保存到计算手记。输入数字开始新算式，输入运算符继续计算。', 'success');
    } else {
      toast('上一条已确认的算式已保存。');
    }
    state.page = 1;
    await loadHistory();
  } catch (error) {
    if (revision === state.revision) {
      result.textContent = '—';
      state.result = '';
      setMessage(error.message, 'error');
    }
  } finally {
    state.busy = false;
    calculateButton.disabled = false;
  }
}

function setHistoryState(title, text, retry = false) {
  const element = $('#history-state');
  element.replaceChildren();
  const symbol = document.createElement('span');
  symbol.className = 'empty-symbol';
  symbol.textContent = '↳';
  symbol.setAttribute('aria-hidden', 'true');
  const heading = document.createElement('h3');
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  element.append(symbol, heading, paragraph);
  if (retry) {
    const button = document.createElement('button');
    button.textContent = '重新连接';
    button.addEventListener('click', loadHistory);
    element.append(button);
  }
  element.hidden = false;
}

function historyItem(record) {
  const item = document.createElement('li');
  item.className = 'history-item';
  item.dataset.id = record.id;
  const reuse = document.createElement('button');
  reuse.className = 'history-reuse';
  reuse.title = `重新编辑 ${record.expression}`;
  reuse.setAttribute('aria-label', `重新编辑表达式 ${record.expression}`);
  const expression = document.createElement('span');
  expression.className = 'history-expression';
  expression.textContent = record.expression.replaceAll('*', '×').replaceAll('/', '÷');
  const number = document.createElement('span');
  number.className = 'history-result';
  number.textContent = `= ${record.result}`;
  const time = document.createElement('time');
  time.className = 'history-time';
  time.dateTime = record.created_at;
  time.textContent = new Date(record.created_at).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
  reuse.append(expression, number, time);
  reuse.addEventListener('click', () => {
    if (updateExpression(record.expression)) {
      input.focus();
      input.scrollIntoView({behavior: 'smooth', block: 'center'});
      toast('算式已放回输入区，可以继续编辑。');
    }
  });
  const remove = document.createElement('button');
  remove.className = 'delete-button';
  remove.setAttribute('aria-label', `删除记录 ${record.id}`);
  remove.title = '删除这条记录';
  remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  remove.addEventListener('click', async () => {
    remove.disabled = true;
    try {
      await apiRequest(`/api/history/${record.id}`, {method: 'DELETE'});
      await loadHistory();
      toast('记录已删除。');
    } catch (error) {
      if (error.code === 'NOT_FOUND') await loadHistory();
      toast(error.message);
      remove.disabled = false;
    }
  });
  item.append(reuse, remove);
  return item;
}

async function loadHistory() {
  const revision = ++state.historyRevision;
  const params = new URLSearchParams({q: state.query, page: state.page, page_size: state.pageSize});
  try {
    const data = await apiRequest(`/api/history?${params}`);
    if (revision !== state.historyRevision) return;
    const pages = Math.max(1, Math.ceil(data.total / state.pageSize));
    if (state.page > pages) { state.page = pages; await loadHistory(); return; }
    state.total = data.total;
    $('#history-list').replaceChildren(...data.items.map(historyItem));
    $('#history-count').textContent = `${data.total} 条记录`;
    $('#page-label').textContent = `第 ${state.page} / ${pages} 页`;
    $('#previous-page').disabled = state.page <= 1;
    $('#next-page').disabled = state.page >= pages;
    $('#export-button').disabled = data.total === 0 && !state.query;
    if (data.total === 0) {
      setHistoryState(state.query ? '没有找到匹配的记录' : '还没有计算手记',
        state.query ? '试试其他表达式或结果关键词。' : '确认你的第一条算式，让思路留下来。');
    } else { $('#history-state').hidden = true; }
  } catch (error) {
    if (revision !== state.historyRevision) return;
    $('#history-list').replaceChildren();
    $('#export-button').disabled = true;
    $('#previous-page').disabled = true;
    $('#next-page').disabled = true;
    $('#history-count').textContent = '暂不可用';
    setHistoryState('手记暂时无法打开', error.message, true);
  }
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  savePreference('calc-theme', theme);
  $('#theme-button').setAttribute('aria-label', theme === 'dark' ? '切换浅色主题' : '切换深色主题');
}

document.querySelectorAll('[data-insert]').forEach((button) => {
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => insertText(button.dataset.insert));
});
document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    if (button.dataset.action === 'clear') updateExpression('');
    else if (button.dataset.action === 'backspace') backspace();
    else {
      const text = state.confirmed ? state.result : state.expression;
      updateExpression(text.startsWith('-(') && text.endsWith(')') ? text.slice(2, -1) : text ? `-(${text})` : '-');
    }
    input.focus();
  });
});
input.addEventListener('input', () => updateExpression(input.value, input.selectionStart));
input.addEventListener('keydown', (event) => {
  if (state.confirmed && !event.ctrlKey && !event.metaKey && /^[0-9.]$/.test(event.key)) {
    event.preventDefault();
    insertText(event.key);
  } else if (state.confirmed && /^[+*/^%\-]$/.test(event.key)) {
    event.preventDefault();
    insertText({'*': '×', '/': '÷', '-': '−'}[event.key] || event.key);
  }
});
document.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]')) return;
  if (event.target instanceof HTMLInputElement && event.target !== input) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Enter' || event.key === '=') { event.preventDefault(); calculate(); }
  else if (event.key === 'Escape') { event.preventDefault(); updateExpression(''); }
  else if (event.target !== input && event.key === 'Backspace') { event.preventDefault(); backspace(); }
  else if (event.target !== input && /^[0-9.+*/()^%\-]$/.test(event.key)) {
    event.preventDefault();
    insertText({'*': '×', '/': '÷', '-': '−'}[event.key] || event.key);
  }
});
calculateButton.addEventListener('click', calculate);
$('#example-button').addEventListener('click', () => { updateExpression('(12+3)×4'); input.focus(); });
$('#theme-button').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
$('#settings-button').addEventListener('click', () => { $('#api-url').value = apiBaseUrl; $('#settings-error').textContent = ''; $('#settings-dialog').showModal(); });
document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog').close());
});
$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { apiBaseUrl = validApiUrl($('#api-url').value.trim()); }
  catch (error) { $('#settings-error').textContent = error.message; return; }
  savePreference('calc-api-url', apiBaseUrl);
  invalidatePreview();
  state.result = '';
  state.confirmed = false;
  result.textContent = '—';
  $('#settings-dialog').close();
  await loadHistory();
  if (state.expression.trim()) state.previewTimer = setTimeout(preview, config.previewDelay);
});
let searchTimer;
$('#history-search').addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.query = event.target.value; state.page = 1; loadHistory(); }, 250);
});
$('#previous-page').addEventListener('click', () => { state.page -= 1; loadHistory(); });
$('#next-page').addEventListener('click', () => { state.page += 1; loadHistory(); });
$('#export-button').addEventListener('click', async () => {
  try {
    const blob = await apiRequest('/api/history/export', {}, true);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'calculation-history.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出全部历史记录。');
  } catch (error) { toast(error.message); }
});
new ResizeObserver(resizeText).observe($('#input-area'));
setTheme(readPreference('calc-theme', 'light') === 'dark' ? 'dark' : 'light');
resizeText();
loadHistory();
