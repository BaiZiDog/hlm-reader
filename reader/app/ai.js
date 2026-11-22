'use strict';

/* AI 导读悬浮窗：对话展示、设置、拖拽与引用跳转。 */
(() => {
  const desktop = window.hlmDesktop;
  if (!desktop || typeof desktop.aiGetConfig !== 'function') return;
  const reader = window.HLM_READER;
  const MOBILE = Boolean(window.__HLM_MOBILE__);

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const els = {
    float: $('#ai-float'),
    openBtn: $('#ai-open'),
    head: $('#ai-drag'),
    close: $('#ai-close'),
    minimize: $('#ai-minimize'),
    newChat: $('#ai-new'),
    settingsOpen: $('#ai-settings-open'),
    settingsBack: $('#ai-settings-back'),
    chat: $('#ai-chat'),
    messages: $('#ai-messages'),
    settings: $('#ai-settings'),
    input: $('#ai-input'),
    send: $('#ai-send'),
    stop: $('#ai-stop'),
    hint: $('#ai-hint'),
    context: $('#ai-context'),
    spoiler: $('#ai-spoiler'),
    modelChip: $('#ai-model-chip'),
    baseURL: $('#ai-base-url'),
    baseField: $('#ai-base-field'),
    key: $('#ai-key'),
    keyField: $('#ai-key-field'),
    keyStatus: $('#ai-key-status'),
    keyFoot: $('#ai-key-foot'),
    notice: $('#ai-notice'),
    model: $('#ai-model'),
    modelList: $('#ai-model-list'),
    presetHint: $('#ai-preset-hint'),
    presets: $$('.ai-presets button'),
    refresh: $('#ai-refresh-models'),
    save: $('#ai-save'),
    clearKey: $('#ai-clear-key'),
    settingsStatus: $('#ai-settings-status'),
    resize: $('#ai-resize'),
  };

  if (!els.float) return;

  if (MOBILE) {
    const builtinBtn = els.presets.find((btn) => btn.dataset.provider === 'builtin');
    if (builtinBtn) builtinBtn.hidden = true;
  }

  const FLOAT_KEY = 'hlm.ai.float.v1';
  const MIN_WIDTH = 340;
  const MIN_HEIGHT = 380;
  const TOP_MARGIN = 64;
  const MARGIN = 8;

  const state = {
    config: null,
    open: false,
    minimized: false,
    streaming: false,
    expectTurn: false,
    turnId: null,
    assistant: null,
    lastUsage: null,
    spoiler: false,
    formProvider: MOBILE ? 'custom' : 'builtin',
    formModels: [],
    builtinWarmed: false,
    builtinWarming: false,
    rect: null,
    drag: null,
    resize: null,
    settingsOpen: false,
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function truncate(text, length) {
    const s = String(text || '');
    return s.length > length ? s.slice(0, length) + '…' : s;
  }

  function currentHui() {
    return reader ? reader.getCurrentHui() : 1;
  }

  function currentChapter() {
    return reader ? reader.getCurrentChapter() : null;
  }

  function configReady() {
    return Boolean(state.config && state.config.hasKey && state.config.model);
  }

  function updateControls() {
    const ready = configReady();
    els.send.disabled = state.streaming || !ready;
    els.stop.hidden = !state.streaming;
    els.spoiler.disabled = state.streaming;
    els.input.disabled = state.streaming;
    els.hint.textContent = state.streaming
      ? 'AI 正在查阅…'
      : 'Enter 发送 · Shift+Enter 换行';
    els.openBtn.setAttribute('aria-pressed', String(state.open));
    document.body.classList.toggle('ai-open', state.open);
  }

  function updateModelChip() {
    const cfg = state.config;
    let text = '未配置';
    if (cfg && cfg.provider === 'builtin') {
      text = cfg.model ? `内置 · ${cfg.model}` : '内置 · 未选择模型';
    } else if (cfg && cfg.hasKey && cfg.model) {
      text = cfg.model;
    } else if (cfg && cfg.hasKey) {
      text = '未选择模型';
    }
    els.modelChip.textContent = truncate(text, 30);
    els.modelChip.title = text;
  }

  function updateContext() {
    const chapter = currentChapter();
    const label = chapter ? chapter.label : '第一回';
    els.context.textContent = `当前：${label} · ${els.spoiler.checked ? '允许剧透' : '防剧透'}`;
  }

  function scrollBottom(force) {
    const box = els.messages;
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    if (force || nearBottom) box.scrollTop = box.scrollHeight;
  }

  function focusAssistantStart() {
    const assistant = state.assistant;
    const box = els.messages;
    if (!assistant || !box) {
      scrollBottom(true);
      return;
    }
    const rect = assistant.msg.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const top = box.scrollTop + rect.top - boxRect.top;
    if (assistant.msg.offsetHeight > box.clientHeight * 0.85) {
      box.scrollTop = Math.max(0, top - 6);
    } else {
      box.scrollTop = box.scrollHeight;
    }
  }

  // ---------- 悬浮窗位置与拖拽 ----------

  function defaultRect() {
    const width = Math.min(430, Math.max(MIN_WIDTH, window.innerWidth - 24));
    const height = Math.min(620, Math.max(MIN_HEIGHT, window.innerHeight - 90));
    return {
      width,
      height,
      left: Math.max(MARGIN, window.innerWidth - width - 24),
      top: Math.max(TOP_MARGIN, window.innerHeight - height - 24),
    };
  }

  function clampRect(rect) {
    const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - MARGIN * 2);
    const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - TOP_MARGIN - MARGIN);
    const width = Math.min(Math.max(MIN_WIDTH, Number(rect.width) || 430), maxWidth);
    const height = Math.min(Math.max(MIN_HEIGHT, Number(rect.height) || 620), maxHeight);
    const left = Math.min(
      Math.max(MARGIN, Number(rect.left) || 0),
      Math.max(MARGIN, window.innerWidth - width - MARGIN),
    );
    const top = Math.min(
      Math.max(TOP_MARGIN, Number(rect.top) || 0),
      Math.max(TOP_MARGIN, window.innerHeight - height - MARGIN),
    );
    return { left, top, width, height };
  }

  function applyRect(rect, persist) {
    if (MOBILE) {
      // 手机/平板用全屏 CSS，不写内联定位，避免覆盖响应式布局。
      els.float.style.left = '';
      els.float.style.top = '';
      els.float.style.width = '';
      els.float.style.height = '';
      return;
    }
    const next = clampRect(rect);
    state.rect = next;
    els.float.style.left = `${next.left}px`;
    els.float.style.top = `${next.top}px`;
    els.float.style.width = `${next.width}px`;
    els.float.style.height = `${next.height}px`;
    if (persist) saveFloatState();
  }

  function saveFloatState() {
    try {
      localStorage.setItem(FLOAT_KEY, JSON.stringify({
        ...state.rect,
        minimized: state.minimized,
      }));
    } catch {
      /* ignore */
    }
  }

  function restoreFloatState() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(FLOAT_KEY) || 'null');
    } catch {
      saved = null;
    }
    state.rect = saved && Number.isFinite(saved.width) ? clampRect(saved) : defaultRect();
    state.minimized = Boolean(saved && saved.minimized);
    applyRect(state.rect);
    setMinimized(state.minimized, false);
  }

  function setMinimized(minimized, persist = true) {
    state.minimized = Boolean(minimized);
    els.float.classList.toggle('ai-minimized', state.minimized);
    els.minimize.textContent = state.minimized ? '□' : '—';
    els.minimize.title = state.minimized ? '展开' : '收起';
    if (persist) saveFloatState();
  }

  function openFloat() {
    els.float.hidden = false;
    state.open = true;
    if (state.minimized) setMinimized(false);
    applyRect(state.rect);
    updateControls();
    if (configReady()) setTimeout(() => els.input.focus(), 40);
    if (!MOBILE && state.config && state.config.provider === 'builtin') warmBuiltin();
    scrollBottom(true);
  }

  function closeFloat() {
    els.float.hidden = true;
    state.open = false;
    updateControls();
  }

  function toggleFloat() {
    if (state.open) closeFloat();
    else openFloat();
  }

  function bindDrag() {
    if (MOBILE) return;
    els.head.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.target.closest('button')) return;
      const rect = state.rect;
      state.drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
      };
      try { els.head.setPointerCapture(event.pointerId); } catch { /* ignore */ }
      event.preventDefault();
    });
    els.head.addEventListener('pointermove', (event) => {
      if (!state.drag || state.drag.pointerId !== event.pointerId) return;
      applyRect({
        ...state.rect,
        left: state.drag.left + event.clientX - state.drag.startX,
        top: state.drag.top + event.clientY - state.drag.startY,
      });
    });
    const endDrag = (event) => {
      if (!state.drag || state.drag.pointerId !== event.pointerId) return;
      state.drag = null;
      saveFloatState();
    };
    els.head.addEventListener('pointerup', endDrag);
    els.head.addEventListener('pointercancel', endDrag);

    els.resize.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const rect = state.rect;
      state.resize = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        width: rect.width,
        height: rect.height,
      };
      try { els.resize.setPointerCapture(event.pointerId); } catch { /* ignore */ }
      event.preventDefault();
      event.stopPropagation();
    });
    els.resize.addEventListener('pointermove', (event) => {
      if (!state.resize || state.resize.pointerId !== event.pointerId) return;
      applyRect({
        ...state.rect,
        width: state.resize.width + event.clientX - state.resize.startX,
        height: state.resize.height + event.clientY - state.resize.startY,
      });
    });
    const endResize = (event) => {
      if (!state.resize || state.resize.pointerId !== event.pointerId) return;
      state.resize = null;
      saveFloatState();
    };
    els.resize.addEventListener('pointerup', endResize);
    els.resize.addEventListener('pointercancel', endResize);

    window.addEventListener('resize', () => {
      applyRect(state.rect);
      saveFloatState();
    });
  }

  // ---------- 简易 Markdown 渲染 ----------

  function inlineHtml(text) {
    let html = escapeHtml(text);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    return html;
  }

  function renderMarkdown(text) {
    const frag = document.createDocumentFragment();
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    let paragraph = [];
    let list = null;
    let listTag = '';
    let quote = [];
    let code = null;

    function flushParagraph() {
      if (!paragraph.length) return;
      const p = document.createElement('p');
      p.innerHTML = inlineHtml(paragraph.join(' '));
      frag.appendChild(p);
      paragraph = [];
    }
    function flushList() {
      if (list) {
        frag.appendChild(list);
        list = null;
        listTag = '';
      }
    }
    function flushQuote() {
      if (!quote.length) return;
      const q = document.createElement('blockquote');
      q.innerHTML = inlineHtml(quote.join(' '));
      frag.appendChild(q);
      quote = [];
    }
    function flushAll() {
      flushParagraph();
      flushList();
      flushQuote();
    }

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (code) {
        if (/^\s*```/.test(line)) {
          const pre = document.createElement('pre');
          const c = document.createElement('code');
          c.textContent = code.lines.join('\n');
          pre.appendChild(c);
          frag.appendChild(pre);
          code = null;
        } else {
          code.lines.push(raw);
        }
        continue;
      }
      if (/^\s*```/.test(line)) {
        flushAll();
        code = { lines: [] };
        continue;
      }
      if (!line.trim()) {
        flushAll();
        continue;
      }
      if (/^#{1,3}\s+/.test(line)) {
        flushAll();
        const level = Math.min(3, line.match(/^#+/)[0].length);
        const h = document.createElement(`h${level}`);
        h.innerHTML = inlineHtml(line.replace(/^#{1,3}\s+/, ''));
        frag.appendChild(h);
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line)) {
        flushParagraph();
        flushQuote();
        if (!list || listTag !== 'ul') {
          flushList();
          list = document.createElement('ul');
          listTag = 'ul';
        }
        const li = document.createElement('li');
        li.innerHTML = inlineHtml(line.replace(/^\s*[-*+]\s+/, ''));
        list.appendChild(li);
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        flushParagraph();
        flushQuote();
        if (!list || listTag !== 'ol') {
          flushList();
          list = document.createElement('ol');
          listTag = 'ol';
        }
        const li = document.createElement('li');
        li.innerHTML = inlineHtml(line.replace(/^\s*\d+\.\s+/, ''));
        list.appendChild(li);
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        flushParagraph();
        flushList();
        quote.push(line.replace(/^\s*>\s?/, ''));
        continue;
      }
      flushList();
      flushQuote();
      paragraph.push(line.trim());
    }

    if (code) {
      const pre = document.createElement('pre');
      const c = document.createElement('code');
      c.textContent = code.lines.join('\n');
      pre.appendChild(c);
      frag.appendChild(pre);
    }
    flushAll();
    return frag;
  }

  function linkifyCitations(root) {
    if (!reader || !reader.goToCitation) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue || !/第\s*\d+\s*回/.test(node.nodeValue)) continue;
      const parent = node.parentElement;
      if (parent && parent.closest('pre, code, button, .ai-tool')) continue;
      nodes.push(node);
    }
    const re = /第\s*(\d{1,3})\s*回\s*[·:：]?\s*p\s*(\d{1,3})(?:\s*[–—〜~-]\s*p?\s*(\d{1,3}))?/g;
    for (const node of nodes) {
      const text = node.nodeValue;
      const frag = document.createDocumentFragment();
      let last = 0;
      let match;
      re.lastIndex = 0;
      while ((match = re.exec(text)) !== null) {
        if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
        const hui = Number(match[1]);
        const start = Number(match[2]);
        const end = match[3] ? Number(match[3]) : start;
        const label = end !== start ? `第${hui}回·p${start}–p${end}` : `第${hui}回·p${start}`;
        const btn = el('button', 'ai-cite', label);
        btn.type = 'button';
        btn.dataset.hui = String(hui);
        btn.dataset.start = String(start);
        btn.dataset.end = String(end);
        btn.title = end !== start
          ? `跳到第${hui}回第${start}至${end}段`
          : `跳到第${hui}回第${start}段`;
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!reader.goToCitation(hui, start, end) && reader.showToast) {
            reader.showToast('找不到对应的段号');
          }
        });
        frag.appendChild(btn);
        last = match.index + match[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  function renderMarkdownInto(node, text) {
    node.classList.remove('streaming');
    node.replaceChildren(renderMarkdown(text));
    linkifyCitations(node);
  }

  function collectAssistantCitations() {
    const a = state.assistant;
    if (!a) return [];
    const out = [];
    const seen = new Set();
    for (const btn of a.bubble.querySelectorAll('.ai-cite')) {
      const hui = Number(btn.dataset.hui);
      const start = Number(btn.dataset.start);
      const end = Number(btn.dataset.end);
      if (!Number.isInteger(hui) || !Number.isInteger(start) || !Number.isInteger(end)) continue;
      const key = `${hui}:${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ hui, start, end });
    }
    return out;
  }

  function syncReaderCitations() {
    if (!reader) return;
    const citations = collectAssistantCitations();
    if (citations.length) {
      if (reader.setAiCitations) reader.setAiCitations(citations);
    } else if (reader.clearAiCitations) {
      reader.clearAiCitations();
    }
  }

  // ---------- 对话渲染 ----------

  function ensureAssistant(turnId) {
    if (state.assistant) return state.assistant;
    const msg = el('div', 'ai-msg assistant');
    const bubble = el('div', 'ai-bubble');
    msg.appendChild(bubble);
    els.messages.appendChild(msg);
    state.assistant = {
      msg,
      bubble,
      parts: [],
      currentText: null,
      tools: new Map(),
      statusEl: null,
      turnId,
    };
    scrollBottom(true);
    return state.assistant;
  }

  function clearStatus() {
    const a = state.assistant;
    if (a && a.statusEl) {
      a.statusEl.remove();
      a.statusEl = null;
    }
  }

  function setStatus(text) {
    const a = ensureAssistant(state.turnId);
    clearStatus();
    const line = el('div', 'ai-status-line');
    line.append(el('span', 'spin'), el('span', 'status-text', text));
    a.bubble.appendChild(line);
    a.statusEl = line;
    scrollBottom(false);
  }

  function appendText(delta) {
    clearStatus();
    const a = ensureAssistant(state.turnId);
    if (!a.currentText) {
      const node = el('div', 'ai-text-part streaming');
      a.bubble.appendChild(node);
      a.currentText = { el: node, text: '' };
      a.parts.push(a.currentText);
    }
    a.currentText.text += delta;
    a.currentText.el.textContent = a.currentText.text;
    scrollBottom(false);
  }

  function toolLabel(name, input) {
    if (name === 'read_chapter') return `阅读 第${input.chapter}回`;
    if (name === 'search_book') return `检索「${truncate(input.query || '', 14)}」`;
    if (name === 'list_chapters') return '查看回目';
    if (name === 'assign_reading') {
      const start = Number(input.start);
      const end = Number(input.end);
      const range = Number.isInteger(start) && Number.isInteger(end) && end !== start
        ? `p${start}–p${end}`
        : `p${start || 1}`;
      return `布置阅读 第${input.chapter}回 ${range}`;
    }
    return name;
  }

  function addTool(event) {
    clearStatus();
    const a = ensureAssistant(state.turnId);
    a.currentText = null;
    let row = a.bubble.lastElementChild;
    if (!row || !row.classList.contains('ai-tool-row')) {
      row = el('div', 'ai-tool-row');
      a.bubble.appendChild(row);
    }
    const chip = el('span', 'ai-tool');
    chip.dataset.toolId = event.id;
    const spin = el('span', 'spin');
    const label = el('span', 'label', toolLabel(event.name, event.input || {}));
    chip.append(spin, label);
    row.appendChild(chip);
    a.tools.set(event.id, { chip, label });
    scrollBottom(false);
  }

  function updateTool(event) {
    const a = state.assistant;
    if (!a) return;
    const item = a.tools.get(event.id);
    if (!item) return;
    item.chip.classList.add(event.ok ? 'ok' : 'fail');
    const spin = item.chip.querySelector('.spin');
    if (spin) spin.replaceWith(el('span', 'dot'));
    if (event.summary) item.chip.title = event.summary;
    if (event.ok && event.summary && event.name !== 'read_chapter' && event.name !== 'assign_reading') {
      item.chip.appendChild(el('span', 'ai-tool-summary', `· ${event.summary}`));
    }
  }

  function finalizeAssistant() {
    const a = state.assistant;
    if (!a) return;
    clearStatus();
    for (const part of a.parts) {
      if (part.text && part.text.trim()) renderMarkdownInto(part.el, part.text);
      else part.el.remove();
    }
    a.currentText = null;
    if (!a.bubble.querySelector('.ai-text-part') && !a.bubble.querySelector('.ai-tool')) {
      a.bubble.appendChild(el('div', 'ai-text-part', '（没有返回文字）'));
    }
  }

  function usageText(usage) {
    if (!usage) return '';
    const parts = [];
    if (usage.input_tokens) parts.push(`输入 ${usage.input_tokens.toLocaleString('zh-CN')}`);
    if (usage.output_tokens) parts.push(`输出 ${usage.output_tokens.toLocaleString('zh-CN')}`);
    if (usage.cache_read_input_tokens) {
      parts.push(`缓存读 ${usage.cache_read_input_tokens.toLocaleString('zh-CN')}`);
    }
    return parts.length ? `${parts.join(' · ')} tokens` : '';
  }

  function appendUsage(usage) {
    const a = state.assistant;
    const text = usageText(usage);
    if (!a || !text) return;
    a.bubble.appendChild(el('div', 'ai-usage', text));
  }

  function appendUserMessage(text) {
    const msg = el('div', 'ai-msg user');
    msg.appendChild(el('div', 'ai-bubble', text));
    els.messages.appendChild(msg);
    scrollBottom(true);
  }

  function appendSystemMessage(text, withSettings) {
    const msg = el('div', 'ai-msg system');
    const bubble = el('div', 'ai-bubble');
    bubble.appendChild(el('div', 'ai-error', text));
    if (withSettings) {
      const btn = el('button', 'ai-link-btn', '打开 AI 设置');
      btn.type = 'button';
      btn.addEventListener('click', openSettings);
      bubble.appendChild(btn);
    }
    msg.appendChild(bubble);
    els.messages.appendChild(msg);
    scrollBottom(true);
  }

  function resetTurnState() {
    state.streaming = false;
    state.expectTurn = false;
    state.turnId = null;
    state.assistant = null;
    state.lastUsage = null;
    updateControls();
  }

  function handleEvent(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'started') {
      if (!state.streaming) return;
      if (state.turnId !== null && event.turnId !== state.turnId) return;
      state.turnId = event.turnId;
      state.expectTurn = false;
      ensureAssistant(event.turnId);
      setStatus('正在思考…');
      return;
    }
    if (!state.streaming) return;
    if (state.turnId === null) return;
    if (event.turnId !== state.turnId) return;

    switch (event.type) {
      case 'status':
        setStatus(event.text || '正在查阅…');
        break;
      case 'text':
        appendText(event.delta || '');
        break;
      case 'tool_start':
        addTool(event);
        break;
      case 'tool_result':
        updateTool(event);
        if (event.ok && event.name === 'read_chapter' && event.hui && reader
            && reader.followAiChapter) {
          reader.followAiChapter(event.hui);
        }
        break;
      case 'reading_task':
        if (event.reading && reader && reader.setAiReadingTask) {
          reader.setAiReadingTask(event.reading);
        }
        if (MOBILE) {
          // 手机全屏对话会挡住正文；先收起 AI，让用户直接看到标红范围。
          closeFloat();
          if (reader && reader.showToast) {
            reader.showToast('已标出阅读范围，读完后点“读完了，继续”', 2400);
          }
        }
        break;
      case 'usage':
        state.lastUsage = event.usage;
        break;
      case 'truncated':
        if (state.assistant) {
          state.assistant.bubble.appendChild(el('div', 'ai-usage', '回答达到长度上限，可能没有写完。'));
        }
        break;
      case 'done': {
        finalizeAssistant();
        syncReaderCitations();
        appendUsage(event.usage || state.lastUsage);
        focusAssistantStart();
        resetTurnState();
        if (reader && reader.endAiReadingSession) reader.endAiReadingSession();
        break;
      }
      case 'error': {
        if (state.assistant) finalizeAssistant();
        const message = event.message || 'AI 请求失败。';
        const needsSettings = /Key|密钥|连接|接口|模型|服务|设置/.test(message);
        if (state.assistant) {
          state.assistant.bubble.appendChild(el('div', 'ai-error', message));
        } else {
          appendSystemMessage(message, needsSettings);
        }
        resetTurnState();
        if (reader && reader.endAiReadingSession) reader.endAiReadingSession();
        scrollBottom(true);
        break;
      }
      case 'aborted': {
        finalizeAssistant();
        appendSystemMessage('已停止。', false);
        resetTurnState();
        if (reader && reader.endAiReadingSession) reader.endAiReadingSession();
        scrollBottom(true);
        break;
      }
      default:
        break;
    }
  }

  // ---------- 发送与停止 ----------

  async function sendMessage(options) {
    if (state.streaming) return false;
    if (!configReady()) {
      openSettings();
      return false;
    }
    const override = options && typeof options.text === 'string' ? options.text : '';
    const keepReading = Boolean(options && options.keepReading);
    const text = (override || els.input.value).trim();
    if (!text) return false;

    if (!keepReading && reader && reader.clearAiReadingTask) reader.clearAiReadingTask();
    if (reader && reader.clearAiCitations) reader.clearAiCitations();
    if (!override) {
      els.input.value = '';
      els.input.style.height = '';
    }
    const welcome = els.messages.querySelector('.ai-welcome, .ai-setup');
    if (welcome) welcome.remove();
    appendUserMessage(text);

    state.streaming = true;
    state.expectTurn = true;
    state.turnId = null;
    state.assistant = null;
    state.lastUsage = null;
    updateControls();

    let result;
    try {
      result = await desktop.aiSend({
        text,
        currentHui: currentHui(),
        spoiler: els.spoiler.checked,
        readingContinue: Boolean(options && options.readingContinue),
      });
    } catch (err) {
      result = { ok: false, error: err.message || '发送失败。' };
    }
    if (!result || !result.ok) {
      resetTurnState();
      if (reader && reader.endAiReadingSession) reader.endAiReadingSession();
      appendSystemMessage((result && result.error) || '发送失败。', true);
      if (result && (result.code === 'NO_KEY' || result.code === 'NO_MODEL')) openSettings();
      return false;
    }
    // 极快的回答可能在 invoke 返回前就已经走完 done/aborted。
    if (!state.streaming) return true;
    if (!state.assistant) ensureAssistant(result.turnId);
    state.turnId = result.turnId;
    state.expectTurn = false;
    updateControls();
    return true;
  }

  function continueReading(task) {
    if (!task || state.streaming || !configReady()) return false;
    const range = task.start === task.end ? `p${task.start}` : `p${task.start}–p${task.end}`;
    const text = `我已读完第${task.hui}回 ${range}。请先讲解这一段（可引用原文），然后标出下一段需要读的范围；如果本次带读已经结束，请总结收束。`;
    openFloat();
    sendMessage({ text, keepReading: true, readingContinue: true });
    return true;
  }

  function stopStreaming() {
    if (!state.streaming) return;
    els.hint.textContent = '正在停止…';
    desktop.aiAbort();
  }

  async function newChat() {
    if (els.messages.querySelector('.ai-msg') && !window.confirm('清空当前对话？')) return;
    if (state.streaming) desktop.aiAbort();
    if (reader && reader.clearAiCitations) reader.clearAiCitations();
    if (reader && reader.clearAiReadingTask) reader.clearAiReadingTask();
    try { await desktop.aiReset(); } catch { /* ignore */ }
    els.messages.replaceChildren();
    resetTurnState();
    renderWelcome();
    scrollBottom(true);
  }

  // ---------- 欢迎与设置 ----------

  function renderWelcome() {
    if (els.messages.querySelector('.ai-msg')) return;
    const cfg = state.config;
    if (!cfg || (!cfg.hasKey && cfg.provider !== 'builtin')) {
      const box = el('div', 'ai-setup');
      box.appendChild(el('h3', '', '还没有配置 AI 服务'));
      if (MOBILE) {
        box.appendChild(el('p', '',
          '移动版不内置免费模型服务。请在 AI 设置中填写一个兼容 Anthropic Messages 的 API。'));
        box.appendChild(el('p', '',
          'API Key 只保存在本机浏览器存储中，不会上传到本项目；聊天时章节原文会发送给你配置的服务。'));
      } else {
        box.appendChild(el('p', '',
          '阅读器内置 Our Free Model 免费模型服务，不需要安装 OFM/DSH，也不需要单独填 API Key。'));
        box.appendChild(el('p', '',
          '默认使用 Kilo 免费池（reflection/beam-free）；也可以切换到自定义 Anthropic 兼容 API。'));
      }
      const btn = el('button', 'ai-primary-btn', '打开 AI 设置');
      btn.type = 'button';
      btn.addEventListener('click', openSettings);
      box.appendChild(btn);
      els.messages.replaceChildren(box);
      return;
    }
    if (!cfg.model) {
      const box = el('div', 'ai-setup');
      box.appendChild(el('h3', '', '还差一个模型'));
      box.appendChild(el('p', '', '打开设置，点「刷新模型 / 测试连接」，然后选一个支持工具调用的模型。'));
      const btn = el('button', 'ai-primary-btn', '选择模型');
      btn.type = 'button';
      btn.addEventListener('click', openSettings);
      box.appendChild(btn);
      els.messages.replaceChildren(box);
      return;
    }

    const wrap = el('div', 'ai-welcome');
    wrap.appendChild(el('h3', '', '红楼梦 AI 导读'));
    wrap.appendChild(el('p', '',
      '我会先定位相关回目，再读取原文与本章注释后回答。引用会标成可点击的「第X回·pN」，点一下就能回到正文。'));
    if (cfg.provider === 'builtin') {
      wrap.appendChild(el('p', '',
        '内置免费模型由阅读器自己启动，默认 reflection/beam-free；第一次使用可能需要几秒。'));
    } else if (MOBILE) {
      wrap.appendChild(el('p', '',
        '移动版使用你配置的 Anthropic 兼容 API；API Key 只保存在本机浏览器存储中。'));
    }
    const examples = el('div', 'ai-examples');
    const prompts = [
      '本回主要讲了什么？',
      '梳理本回的人物关系',
      '这一回在全书结构中起什么作用？',
      '解释本回里一个难懂的词或典故',
    ];
    for (const prompt of prompts) {
      const btn = el('button', 'ai-example', prompt);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        els.input.value = prompt;
        sendMessage();
      });
      examples.appendChild(btn);
    }
    wrap.appendChild(examples);
    els.messages.replaceChildren(wrap);
  }

  function presetHint(provider) {
    if (provider === 'builtin') {
      return '阅读器已内置 Our Free Model 独立运行时，不需要安装 OFM/DSH。' +
        '默认使用 Kilo 免费池（reflection/beam-free），失败时会自动尝试其他免费模型；部分 OpenCode 免费模型需要 Bun，未安装时请选 Kilo 模型。';
    }
    if (provider === 'official') {
      return 'Anthropic 官方 API。模型默认 claude-opus-5-5；也可以手动填写其他 Claude 模型 ID。';
    }
    return '需要兼容 Anthropic Messages（/v1/messages）的端点。Base URL 不要带 /v1。';
  }

  function updatePresetUI() {
    if (MOBILE && state.formProvider === 'builtin') state.formProvider = 'custom';
    for (const btn of els.presets) {
      btn.classList.toggle('active', btn.dataset.provider === state.formProvider);
    }
    const builtin = state.formProvider === 'builtin';
    els.baseField.hidden = builtin;
    els.keyField.hidden = builtin;
    els.keyStatus.hidden = builtin;
    els.keyFoot.hidden = builtin;
    els.refresh.textContent = builtin ? '启动内置服务 / 刷新模型' : '刷新模型 / 测试连接';
    els.notice.textContent = builtin
      ? '内置模式会把所选章节原文与注释发送到 Our Free Model 的免费模型上游（Kilo 等）。免费池的提示词可能被上游记录，请勿发送敏感内容。'
      : (MOBILE
        ? '使用 AI 导读时，所选章节原文与注释会发送到你配置的 AI 服务。API Key 只保存在本机浏览器存储中；请只在个人设备使用，勿发送敏感内容。'
        : '使用 AI 导读时，所选章节原文与注释会发送到你配置的 AI 服务。密钥保存在本机加密存储中，不显示在对话里。');
    els.presetHint.textContent = presetHint(state.formProvider);
  }

  function fillModelList() {
    els.modelList.replaceChildren();
    for (const model of state.formModels || []) {
      const option = document.createElement('option');
      option.value = model.id;
      const name = model.display_name || model.id;
      option.label = model.requiresBun ? `${name}（需 Bun）` : name;
      els.modelList.appendChild(option);
    }
  }

  function keyStatusText() {
    const cfg = state.config;
    if (cfg && cfg.provider === 'builtin') return '内置免费模型不需要 API Key。';
    if (!cfg || !cfg.hasKey) return '尚未配置 API Key。';
    if (cfg.keySource === 'env') return '当前使用环境变量中的 API Key。';
    if (cfg.keySource === 'local') return '已保存 API Key（本机浏览器存储；输入新 Key 可替换）。';
    if (cfg.keySource === 'stored') {
      return cfg.encryptionAvailable
        ? '已保存 API Key（本机加密存储；输入新 Key 可替换）。'
        : '已保存 API Key（系统加密不可用，仅本次运行有效）。';
    }
    if (cfg.keySource === 'session') return '密钥只保存在本次运行中。';
    return '已配置 API Key。';
  }

  function setSettingsStatus(text, kind) {
    els.settingsStatus.textContent = text || '';
    els.settingsStatus.className = 'ai-settings-status' + (kind ? ' ' + kind : '');
  }

  function fillSettingsForm() {
    const cfg = state.config || {};
    state.formProvider = cfg.provider || (MOBILE ? 'custom' : 'builtin');
    if (MOBILE && state.formProvider === 'builtin') state.formProvider = 'custom';
    state.formModels = Array.isArray(cfg.models) ? cfg.models.slice() : [];
    els.baseURL.value = cfg.baseURL || (MOBILE ? 'https://api.anthropic.com' : '');
    els.model.value = cfg.model
      || (MOBILE ? '' : cfg.defaultModel)
      || (cfg.provider === 'builtin' && !MOBILE ? 'reflection/beam-free' : '');
    els.key.value = '';
    els.key.placeholder = cfg.keySource === 'env'
      ? '使用环境变量密钥，留空保留'
      : (cfg.hasKey ? '已保存密钥，留空保留' : '粘贴 API Key');
    els.keyStatus.textContent = keyStatusText();
    updatePresetUI();
    fillModelList();
    let status = '';
    if (cfg.provider === 'builtin') {
      status = cfg.serviceStatus && cfg.serviceStatus.running
        ? '内置服务正在运行。'
        : '内置服务会在首次刷新或提问时启动。';
    } else if (cfg.envOverride) {
      status = '当前有环境变量覆盖服务地址/模型/密钥。';
    }
    setSettingsStatus(status, '');
  }

  async function openSettings() {
    if (!state.open) openFloat();
    if (!state.config) await refreshConfig();
    fillSettingsForm();
    state.settingsOpen = true;
    els.settings.hidden = false;
    els.settings.scrollTop = 0;
    setTimeout(() => {
      if (state.formProvider === 'builtin') els.refresh.focus();
      else els.baseURL.focus();
    }, 30);
  }

  function closeSettings() {
    state.settingsOpen = false;
    els.settings.hidden = true;
  }

  async function refreshConfig() {
    try {
      state.config = await desktop.aiGetConfig();
    } catch {
      state.config = null;
    }
    state.spoiler = Boolean(state.config && state.config.spoiler);
    els.spoiler.checked = state.spoiler;
    if (state.config && state.config.provider === 'builtin'
        && state.config.serviceStatus && state.config.serviceStatus.running) {
      state.builtinWarmed = true;
    }
    updateModelChip();
    updateContext();
    updateControls();
    if (!els.messages.querySelector('.ai-msg')) renderWelcome();
  }

  async function warmBuiltin() {
    if (!state.config || state.config.provider !== 'builtin') return;
    if (state.builtinWarmed || state.builtinWarming) return;
    state.builtinWarming = true;
    try {
      const result = await desktop.aiListModels({ provider: 'builtin' });
      if (result && result.ok) {
        state.builtinWarmed = true;
        state.config.models = result.models || [];
        if (!state.config.model || !state.config.models.some((m) => m.id === state.config.model)) {
          state.config.model = result.defaultModel || 'reflection/beam-free';
        }
        if (state.config.serviceStatus) state.config.serviceStatus.running = true;
        updateModelChip();
        updateControls();
      }
    } catch {
      /* 首次发送时会再次尝试并显示具体错误 */
    }
    state.builtinWarming = false;
  }

  async function refreshModels() {
    if (!state.config) await refreshConfig();
    const builtin = state.formProvider === 'builtin';
    let baseURL = els.baseURL.value.trim();
    if (!builtin && !baseURL) baseURL = 'https://api.anthropic.com';
    const payload = builtin
      ? { provider: 'builtin' }
      : {
        provider: state.formProvider,
        baseURL,
        model: els.model.value.trim(),
        apiKey: els.key.value.trim(),
      };
    els.refresh.disabled = true;
    setSettingsStatus(builtin ? '正在启动内置免费模型服务…' : '正在连接…', '');
    let result;
    try {
      result = await desktop.aiListModels(payload);
    } catch (err) {
      result = { ok: false, error: err.message || '连接失败。' };
    }
    els.refresh.disabled = false;
    if (!result || !result.ok) {
      setSettingsStatus(
        `${result && result.error ? result.error : '连接失败。'} ` +
        (builtin ? '请重试；也可以切换到自定义 API。' : '请检查地址与密钥。'),
        'error',
      );
      return;
    }
    state.formModels = result.models || [];
    fillModelList();
    if (builtin) {
      const fallback = result.defaultModel || 'reflection/beam-free';
      if (!els.model.value.trim() || !state.formModels.some((m) => m.id === els.model.value.trim())) {
        els.model.value = fallback;
      }
      state.builtinWarmed = true;
      state.config.models = state.formModels;
      if (state.config.serviceStatus) state.config.serviceStatus.running = true;
      updateModelChip();
      setSettingsStatus(
        `内置服务已就绪，找到 ${state.formModels.length} 个模型。默认 ${fallback}；OpenCode 模型需要 Bun，未安装时请选 Kilo 模型。`,
        'ok',
      );
    } else {
      if (!els.model.value.trim() && state.formModels[0]) {
        els.model.value = state.formModels[0].id;
      }
      els.baseURL.value = result.baseURL || baseURL;
      setSettingsStatus(`连接成功，找到 ${state.formModels.length} 个模型。选好模型后点保存。`, 'ok');
    }
  }

  async function saveSettings() {
    if (!state.config) await refreshConfig();
    const builtin = state.formProvider === 'builtin';
    let baseURL = '';
    if (!builtin) {
      baseURL = els.baseURL.value.trim();
      if (!baseURL) baseURL = 'https://api.anthropic.com';
    }
    const model = els.model.value.trim() || (builtin ? 'reflection/beam-free' : '');
    const apiKey = els.key.value.trim();
    if (!model) {
      setSettingsStatus('请选择或填写模型 ID。', 'error');
      return;
    }
    if (!builtin && !apiKey && !(state.config && state.config.hasKey)) {
      setSettingsStatus('请填写 API Key。', 'error');
      return;
    }

    const old = state.config;
    const oldKey = old ? `${old.provider}|${old.baseURL}|${old.model}` : '';
    const payload = {
      provider: state.formProvider,
      model,
      models: state.formModels,
      spoiler: els.spoiler.checked,
    };
    if (!builtin) {
      payload.baseURL = baseURL;
      if (apiKey) payload.apiKey = apiKey;
    }

    els.save.disabled = true;
    setSettingsStatus('正在保存…', '');
    let result;
    try {
      result = await desktop.aiSaveConfig(payload);
    } catch (err) {
      result = { ok: false, error: err.message || '保存失败。' };
    }
    els.save.disabled = false;
    if (!result || !result.ok) {
      setSettingsStatus((result && result.error) || '保存失败。', 'error');
      return;
    }

    const next = result.config;
    const changed = Boolean(oldKey) && oldKey !== `${next.provider}|${next.baseURL}|${next.model}`;
    state.config = next;
    state.spoiler = next.spoiler;
    els.spoiler.checked = state.spoiler;
    els.key.value = '';
    els.keyStatus.textContent = keyStatusText();
    if (builtin) {
      state.builtinWarmed = Boolean(next.serviceStatus && next.serviceStatus.running) || state.builtinWarmed;
    } else {
      state.builtinWarmed = false;
    }
    updateModelChip();
    updateContext();
    updateControls();
    setSettingsStatus('已保存。', 'ok');
    closeSettings();
    if (changed) {
      try { await desktop.aiReset(); } catch { /* ignore */ }
      els.messages.replaceChildren();
      resetTurnState();
    }
    if (!els.messages.querySelector('.ai-msg')) renderWelcome();
    if (result.warning) appendSystemMessage(result.warning, false);
    if (reader && reader.showToast) reader.showToast('AI 设置已保存');
  }

  async function clearKey() {
    if (state.config && state.config.provider === 'builtin') return;
    if (!window.confirm('删除已保存的 API Key？')) return;
    const result = await desktop.aiSaveConfig({ clearKey: true });
    if (!result || !result.ok) {
      setSettingsStatus((result && result.error) || '删除失败。', 'error');
      return;
    }
    state.config = result.config;
    els.key.value = '';
    els.keyStatus.textContent = keyStatusText();
    updateModelChip();
    updateControls();
    setSettingsStatus('已删除保存的密钥。', 'ok');
    if (!els.messages.querySelector('.ai-msg')) renderWelcome();
  }

  // ---------- 事件绑定 ----------

  function bindEvents() {
    els.openBtn.addEventListener('click', toggleFloat);
    els.close.addEventListener('click', closeFloat);
    els.minimize.addEventListener('click', () => setMinimized(!state.minimized));
    els.newChat.addEventListener('click', newChat);
    els.settingsOpen.addEventListener('click', openSettings);
    els.modelChip.addEventListener('click', openSettings);
    els.settingsBack.addEventListener('click', closeSettings);
    els.refresh.addEventListener('click', refreshModels);
    els.save.addEventListener('click', saveSettings);
    els.clearKey.addEventListener('click', clearKey);

    for (const btn of els.presets) {
      btn.addEventListener('click', () => {
        state.formProvider = btn.dataset.provider;
        if (state.formProvider === 'builtin') {
          els.baseURL.value = '';
          if (!els.model.value.trim() || /^(mock-|claude-)/.test(els.model.value.trim())) {
            els.model.value = (state.config && state.config.defaultModel) || 'reflection/beam-free';
          }
        } else if (state.formProvider === 'official') {
          els.baseURL.value = 'https://api.anthropic.com';
          if (!els.model.value.trim() || !els.model.value.trim().startsWith('claude-')) {
            els.model.value = 'claude-opus-5-5';
          }
        }
        updatePresetUI();
        setSettingsStatus('', '');
      });
    }

    els.input.addEventListener('input', () => {
      els.input.style.height = 'auto';
      els.input.style.height = `${Math.min(118, els.input.scrollHeight)}px`;
    });
    els.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      sendMessage();
    });
    els.send.addEventListener('click', sendMessage);
    els.stop.addEventListener('click', stopStreaming);
    els.spoiler.addEventListener('change', () => {
      state.spoiler = els.spoiler.checked;
      updateContext();
      desktop.aiSaveConfig({ spoiler: state.spoiler }).catch(() => {});
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.settingsOpen) {
        event.preventDefault();
        event.stopPropagation();
        closeSettings();
      }
    }, true);

    window.addEventListener('hlm:chapterchange', updateContext);
    if (reader && reader.data && reader.data.meta) {
      updateContext();
    }
  }

  // ---------- 启动 ----------

  desktop.onAiEvent(handleEvent);
  restoreFloatState();
  bindEvents();
  updateControls();
  refreshConfig().then(() => {
    if (!els.messages.querySelector('.ai-msg')) renderWelcome();
  });
  window.HLM_AI = {
    open: openFloat,
    close: closeFloat,
    send: sendMessage,
    continueReading,
    state,
  };
})();
