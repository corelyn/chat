// ============================
// Helpers
// ============================

function scrollToBottom(smooth){
  const container = document.querySelector('.messages-container');
  if(smooth) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  else container.scrollTop = container.scrollHeight;
}

function autoResize(){
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
}

function updateChatTitle(chat, content){
  if(chat.title === 'New Chat'){
    chat.title = content.slice(0, 40);
    topbarTitle.textContent = chat.title;
  }
}

function updateModelLabel(){
  modelLabel.textContent = `${state.provider} • ${state.model}`;
}

// ============================
// ---- Markdown parser (safe for code blocks) ----
function markdownToHtml(text) {
  if (!text) return '';

  const codeBlocks = [];
  let html = text;

  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const placeholder = `%%CODEBLOCK${codeBlocks.length}%%`;
    codeBlocks.push(
      `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`
    );
    return placeholder;
  });

  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const placeholder = `%%INLINECODE${codeBlocks.length}%%`;
    codeBlocks.push(`<code>${escapeHtml(code)}</code>`);
    return placeholder;
  });

  html = html
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');

  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  html = html.split(/\n{2,}/).map(p => `<p>${p}</p>`).join('');

  codeBlocks.forEach((codeHtml, idx) => {
    html = html.replace(`%%CODEBLOCK${idx}%%`, codeHtml);
    html = html.replace(`%%INLINECODE${idx}%%`, codeHtml);
  });

  return html;
}

const escapeHtml = (str) => {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};


// ============================
// AI Tool Commands
// ============================
// The AI can embed commands in its response using the syntax:
//   <tool:command_name arg1 arg2 ...>optional body</tool>
//
// Supported commands:
//   <tool:create_file filename.txt>file content here</tool>
//   <tool:open_url https://example.com></tool>
//   <tool:alert message text here></tool>
//   <tool:set_title New Chat Title></tool>
//
// Commands are stripped from the visible response and executed silently,
// then the AI gets a follow-up "tool result" message injected into the chat.

const AI_TOOLS = {

  create_file(args, body) {
    const filename = args[0];
    if (!filename) return { ok: false, msg: 'No filename provided.' };
    const content = body || args.slice(1).join(' ');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    return { ok: true, msg: `File **${escapeHtml(filename)}** created and downloaded (${content.length} bytes).` };
  },

  open_url(args) {
    const url = args[0];
    if (!url) return { ok: false, msg: 'No URL provided.' };
    window.open(url, '_blank', 'noopener');
    return { ok: true, msg: `Opened URL: ${escapeHtml(url)}` };
  },

  alert(args, body) {
    const msg = body || args.join(' ');
    alert(msg);
    return { ok: true, msg: `Alert shown: "${escapeHtml(msg)}"` };
  },

  set_title(args, body) {
    const title = body || args.join(' ');
    const chat = getActiveChat();
    if (chat) { chat.title = title; topbarTitle.textContent = title; saveChats(); renderChatList(); }
    return { ok: true, msg: `Chat title set to **${escapeHtml(title)}**.` };
  },

};

/**
 * Parse and execute all <tool:...> commands found in an AI response.
 * Returns { cleanText, toolResults } where cleanText has the tags stripped
 * and toolResults is an array of result strings.
 */
function processAiTools(text) {
  const toolResults = [];
  // Match <tool:name args>body</tool> — body is optional
  const cleanText = text.replace(/<tool:(\w+)([^>]*)>([\s\S]*?)<\/tool>/gi, (_, name, argsStr, body) => {
    const args = argsStr.trim().split(/\s+/).filter(Boolean);
    const fn = AI_TOOLS[name.toLowerCase()];
    if (!fn) {
      toolResults.push({ ok: false, name, msg: `Unknown tool: \`${name}\`` });
      return '';
    }
    try {
      const result = fn(args, body.trim());
      toolResults.push({ name, ...result });
    } catch(e) {
      toolResults.push({ ok: false, name, msg: `Tool \`${name}\` threw: ${e.message}` });
    }
    return ''; // strip from visible text
  });

  // Also support single-line shorthand: @@create_file banana.txt This is the content
  const cleanText2 = cleanText.replace(/^@@(\w+)\s+(.*)$/gm, (_, name, rest) => {
    const fn = AI_TOOLS[name.toLowerCase()];
    if (!fn) {
      toolResults.push({ ok: false, name, msg: `Unknown tool: \`${name}\`` });
      return '';
    }
    try {
      // For shorthand, first word = first arg (e.g. filename), rest = body
      const parts = rest.split(/\s+/);
      const args = [parts[0]];
      const body = parts.slice(1).join(' ');
      const result = fn(args, body);
      toolResults.push({ name, ...result });
    } catch(e) {
      toolResults.push({ ok: false, name, name, msg: `Tool \`${name}\` threw: ${e.message}` });
    }
    return '';
  });

  return { cleanText: cleanText2.trim(), toolResults };
}

/**
 * Build a tool-result feedback message to inject into the chat as a system notice.
 */
function buildToolFeedbackMessage(toolResults) {
  if (!toolResults.length) return null;
  const lines = toolResults.map(r => {
    const icon = r.ok ? '✅' : '❌';
    return `${icon} **\`${r.name}\`** — ${r.msg}`;
  });
  return `🔧 **Tool results:**\n\n${lines.join('\n')}`;
}


// ============================
// Providers
// ============================

const PROVIDERS = {
  anthropic: { name: 'Anthropic', endpoint: 'https://api.anthropic.com/v1/messages' },
  openai: { name: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions' },
  cerebras: { name: 'Cerebras', endpoint: 'https://api.cerebras.ai/v1/chat/completions' }
};

// ============================
// State
// ============================

let state = {
  apiKey: localStorage.getItem('nc_apikey') || '',
  provider: localStorage.getItem('nc_provider') || 'anthropic',
  model: localStorage.getItem('nc_model') || 'claude-sonnet-4-6',
  systemPrompt: localStorage.getItem('nc_systemprompt') || `You are Corelyn, a useful AI assistant.
If user asks to generate code, give actually working valid code, no AI slop.
Respond only in markdown.

You have access to special tool commands you can embed in your response.
Use them like this:
  <tool:create_file filename.txt>file content here</tool>
  <tool:open_url https://example.com></tool>
  <tool:alert some message to show></tool>
  <tool:set_title New conversation title></tool>

Or using shorthand on its own line:
  @@create_file banana.txt This is the file content

The tool tags are invisible to the user — they get executed automatically.
Only use tools when the user explicitly asks for file creation, opening URLs, etc.`,
  triggers: JSON.parse(localStorage.getItem('nc_triggers') || '[]'),
  chats: JSON.parse(localStorage.getItem('nc_chats') || '[]'),
  activeChatId: null,
  streaming: false,
};

// ============================
// DOM
// ============================

const $ = id => document.getElementById(id);
const messagesEl = $('messages');
const welcomeEl = $('welcomeScreen');
const inputEl = $('userInput');
const sendBtn = $('sendBtn');
const chatListEl = $('chatList');
const topbarTitle = $('topbarTitle');
const modelLabel = $('modelLabel');
const modelDropdown = $('modelDropdown');
const modelSelector = $('modelSelector');
const sidebar = $('sidebar');
const sidebarToggle = $('sidebarToggle');

// Settings Modal
const settingsModal = $('settingsModal');
const openSettingsBtn = $('openSettingsBtn');
const closeSettingsBtn = $('closeSettings');
const saveSettingsBtn = $('saveSettingsBtn');
const apiKeyInput = $('apiKeyInput');
const providerSelect = $('providerSelect');
const modelSelect = $('modelSelect');
const systemPromptInput = $('systemPromptInput');
const triggerListEl = $('triggerList');
const addTriggerBtn = $('addTriggerBtn');

// ============================
// Init
// ============================

function init() {
  renderChatList();
  if (state.chats.length > 0) loadChat(state.chats[0].id);
  setupEventListeners();
  updateModelLabel();
  if (!state.apiKey) promptForKey();
}

function promptForKey() {
  const key = window.prompt('Enter API Key:', '');
  if (key && key.trim()) {
    state.apiKey = key.trim();
    localStorage.setItem('nc_apikey', state.apiKey);
  }
}

// ============================
// Chat Management
// ============================

function createChat() {
  const chat = { id: Date.now().toString(), title: 'New Chat', messages: [], createdAt: Date.now() };
  state.chats.unshift(chat);
  saveChats();
  renderChatList();
  loadChat(chat.id);
}

function loadChat(id) {
  state.activeChatId = id;
  const chat = getChat(id);
  if (!chat) return;
  topbarTitle.textContent = chat.title;
  messagesEl.innerHTML = '';
  if (chat.messages.length === 0) {
    welcomeEl.style.display = 'flex';
    messagesEl.style.display = 'none';
  } else {
    welcomeEl.style.display = 'none';
    messagesEl.style.display = 'flex';
    chat.messages.forEach(msg => {
      // Tool-feedback messages are stored with role 'tool-feedback'
      if (msg.role === 'tool-feedback') {
        renderToolFeedback(msg.content);
      } else {
        renderMessage(msg.role, msg.content);
      }
    });
    attachRunButtons();
  }
  renderChatList();
  scrollToBottom(true);
}

function getChat(id) { return state.chats.find(c => c.id === id); }
function getActiveChat() { return getChat(state.activeChatId); }

function deleteChat(id) {
  state.chats = state.chats.filter(c => c.id !== id);
  saveChats();
  if (state.activeChatId === id) {
    if (state.chats.length > 0) loadChat(state.chats[0].id);
    else { state.activeChatId = null; messagesEl.innerHTML = ''; welcomeEl.style.display = 'flex'; topbarTitle.textContent = 'New Conversation'; }
  }
  renderChatList();
}

function saveChats() { localStorage.setItem('nc_chats', JSON.stringify(state.chats)); }

function renderChatList() {
  chatListEl.innerHTML = '';
  if (state.chats.length === 0) { chatListEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted);">No chats yet</div>'; return; }
  state.chats.forEach(chat => {
    const item = document.createElement('div');
    item.className = 'chat-item' + (chat.id === state.activeChatId ? ' active' : '');
    item.dataset.id = chat.id;
    const title = document.createElement('span');
    title.className = 'chat-item-title'; title.textContent = chat.title;
    const del = document.createElement('button'); del.className = 'chat-item-del'; del.innerHTML = '×'; del.onclick = e => { e.stopPropagation(); deleteChat(chat.id); };
    item.appendChild(title); item.appendChild(del); item.onclick = () => loadChat(chat.id);
    chatListEl.appendChild(item);
  });
}

// ============================
// Messaging
// ============================

async function sendMessage(content) {
  if (!content.trim() || state.streaming) return;
  if (!state.apiKey) return promptForKey();

  if (!state.activeChatId) createChat();
  const chat = getActiveChat(); if (!chat) return;

  welcomeEl.style.display = 'none'; messagesEl.style.display = 'flex';

  chat.messages.push({ role: 'user', content }); await renderMessageAsync('user', content); updateChatTitle(chat, content); saveChats();
  inputEl.value = ''; autoResize(); sendBtn.disabled = true;
  const typingEl = showTyping(); state.streaming = true;

  try {
    // Only pass actual user/assistant messages to the API (not tool-feedback entries)
    const apiMessages = chat.messages.filter(m => m.role === 'user' || m.role === 'assistant');
    const rawText = await callProvider(apiMessages);
    typingEl.remove();

    // Process tool commands embedded in the response
    const { cleanText, toolResults } = processAiTools(rawText);

    // Store and render the cleaned AI response
    const displayText = cleanText || rawText;
    chat.messages.push({ role: 'assistant', content: displayText });
    saveChats();
    await renderMessageAsync('assistant', displayText);

    // If any tools fired, inject a feedback message
    if (toolResults.length) {
      const feedbackText = buildToolFeedbackMessage(toolResults);
      chat.messages.push({ role: 'tool-feedback', content: feedbackText });
      saveChats();
      await renderToolFeedbackAsync(feedbackText);
    }

  } catch (err) {
    typingEl.remove(); renderError(err.message || 'All providers failed.');
  } finally {
    state.streaming = false;
    sendBtn.disabled = !inputEl.value.trim();
  }
}

// ============================
// Provider Calls
// ============================

async function callProvider(messages) {
  const provider = PROVIDERS[state.provider]; if (!provider) throw new Error("Invalid provider");

  let body;
  if (state.provider === 'anthropic') {
    body = { model: state.model, messages, max_tokens: 4096, temperature: 0.7 };
    if (state.systemPrompt) body.system = state.systemPrompt;
  } else {
    const msgs = state.systemPrompt
      ? [{ role: 'system', content: state.systemPrompt }, ...messages]
      : messages;
    body = { model: state.model, messages: msgs, temperature: 0.7 };
  }

  const res = await fetch(provider.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.apiKey}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Provider error: ${res.status}`);
  }
  const data = await res.json();

  if (state.provider === 'anthropic') {
    return data.content?.[0]?.text || "(no response)";
  }
  return data.choices?.[0]?.message?.content || "(no response)";
}

// ============================
// Rendering
// ============================

function renderMessage(role, content) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;
  if(role === 'assistant') {
    msg.innerHTML = `<div class="message-row"><div class="avatar assistant">✦</div><div class="bubble">${markdownToHtml(content)}</div></div>`;
  } else {
    msg.innerHTML = `<div class="message-row"><div class="avatar user">U</div><div class="bubble">${escapeHtml(content)}</div></div>`;
  }
  messagesEl.appendChild(msg);
  scrollToBottom(true);
}

/** Render a tool-feedback card (static, no animation needed on history reload) */
function renderToolFeedback(content) {
  const el = document.createElement('div');
  el.className = 'message tool-feedback';
  el.innerHTML = `
    <div class="message-row">
      <div class="avatar tool-fb-avatar">🔧</div>
      <div class="bubble tool-fb-bubble">${markdownToHtml(content)}</div>
    </div>`;
  messagesEl.appendChild(el);
  scrollToBottom(true);
}

/** Animated version used after live AI response */
async function renderToolFeedbackAsync(content) {
  const el = document.createElement('div');
  el.className = 'message tool-feedback';
  // Start collapsed/faded
  el.style.opacity = '0';
  el.style.transform = 'translateY(6px)';
  el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
  el.innerHTML = `
    <div class="message-row">
      <div class="avatar tool-fb-avatar">🔧</div>
      <div class="bubble tool-fb-bubble">${markdownToHtml(content)}</div>
    </div>`;
  messagesEl.appendChild(el);
  scrollToBottom(true);
  // Trigger animation
  await new Promise(r => setTimeout(r, 30));
  el.style.opacity = '1';
  el.style.transform = 'translateY(0)';
  scrollToBottom(true);
}

function showTyping() {
  const msg = document.createElement('div'); msg.className = 'message assistant';
  msg.innerHTML = `<div class="message-row"><div class="avatar assistant">✦</div><div class="bubble">Typing...</div></div>`;
  messagesEl.appendChild(msg); scrollToBottom(true); return msg;
}

function renderError(text) {
  const msg = document.createElement('div'); msg.className = 'message assistant';
  msg.innerHTML = `<div class="message-row"><div class="avatar assistant" style="color:red;">!</div><div class="bubble" style="color:red;">${escapeHtml(text)}</div></div>`;
  messagesEl.appendChild(msg);
}

// ============================
// Trigger Engine
// ============================

function checkTriggers(text) {
  state.triggers.forEach((trigger, idx) => {
    if (!trigger.match || !trigger.action) return;
    let matched = false;
    let matchResult = null;
    try {
      if (trigger.type === 'regex') {
        const re = new RegExp(trigger.match, 'i');
        matchResult = text.match(re);
        matched = !!matchResult;
      } else {
        matched = text.toLowerCase().includes(trigger.match.toLowerCase());
        matchResult = matched ? [trigger.match] : null;
      }
    } catch(e) {
      showToast(`Trigger #${idx+1} match error: ${e.message}`, 'error');
      return;
    }

    if (!matched) return;

    // Run the JS action
    let actionResult = null;
    let actionError = null;
    try {
      // eslint-disable-next-line no-new-func
      actionResult = new Function('response', 'match', trigger.action)(text, matchResult);
    } catch(e) {
      actionError = e.message;
      showToast(`Trigger #${idx+1} JS error: ${e.message}`, 'error');
    }

    // Build a feedback message and inject it into the chat
    const feedbackLines = [];
    feedbackLines.push(`⚡ **Trigger fired** — matched \`${escapeHtml(trigger.match)}\``);
    if (trigger.type === 'regex' && matchResult) {
      feedbackLines.push(`↳ Regex capture: \`${matchResult[0]}\``);
    }
    if (actionError) {
      feedbackLines.push(`❌ Action error: ${escapeHtml(actionError)}`);
    } else {
      feedbackLines.push(`✅ Action ran successfully${actionResult !== undefined && actionResult !== null ? ` → \`${String(actionResult).slice(0,80)}\`` : ''}`);
    }
    const feedbackText = feedbackLines.join('\n\n');

    // Inject into chat history and render
    const chat = getActiveChat();
    if (chat) {
      chat.messages.push({ role: 'tool-feedback', content: feedbackText });
      saveChats();
      renderToolFeedbackAsync(feedbackText);
    }

    showToast(`Trigger fired: "${trigger.match}"`);
  });
}

function showToast(msg, type) {
  const toast = document.createElement('div');
  toast.className = 'trigger-toast' + (type === 'error' ? ' trigger-toast-error' : '');
  const icon = type === 'error' ? '⚠️' : '⚡';
  toast.innerHTML = `<span class="trigger-toast-icon">${icon}</span><span>${escapeHtml(msg)}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ============================
// JS Code Runner
// ============================

function attachRunButtons() {
  messagesEl.querySelectorAll('pre code[class*="language-j"]').forEach(codeEl => {
    const pre = codeEl.parentElement;
    if (pre.querySelector('.run-js-btn')) return;

    const lang = codeEl.className || '';
    if (!lang.match(/language-j(s|avascript)?$/i)) return;

    const btn = document.createElement('button');
    btn.className = 'run-js-btn';
    btn.textContent = '▶ Run';
    pre.style.position = 'relative';
    pre.appendChild(btn);

    btn.addEventListener('click', () => {
      const existing = pre.nextElementSibling;
      if (existing && existing.classList.contains('js-output')) existing.remove();

      const code = codeEl.textContent;
      const outputEl = document.createElement('div');

      const logs = [];
      const origLog = console.log;
      const origWarn = console.warn;
      const origError = console.error;
      console.log = (...a) => { logs.push(a.map(String).join(' ')); origLog(...a); };
      console.warn = (...a) => { logs.push('[warn] ' + a.map(String).join(' ')); origWarn(...a); };
      console.error = (...a) => { logs.push('[error] ' + a.map(String).join(' ')); origError(...a); };

      try {
        const result = new Function(code)();
        console.log = origLog; console.warn = origWarn; console.error = origError;
        const output = [...logs, result !== undefined ? `→ ${String(result)}` : ''].filter(Boolean).join('\n') || '(no output)';
        outputEl.className = 'js-output success';
        outputEl.textContent = output;
      } catch(e) {
        console.log = origLog; console.warn = origWarn; console.error = origError;
        outputEl.className = 'js-output error';
        outputEl.textContent = `Error: ${e.message}`;
      }

      pre.insertAdjacentElement('afterend', outputEl);
    });
  });
}

// ============================
// Async character-by-character rendering
// ============================

async function renderMessageAsync(role, content) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  if (role === 'assistant') {
    const row = document.createElement('div');
    row.className = 'message-row';
    const avatar = document.createElement('div');
    avatar.className = 'avatar assistant';
    avatar.textContent = '✦';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    row.appendChild(avatar);
    row.appendChild(bubble);
    msg.appendChild(row);
    messagesEl.appendChild(msg);

    let rendered = '';
    const chunkSize = 6;
    for (let i = 0; i < content.length; i += chunkSize) {
      rendered += content.slice(i, i + chunkSize);
      bubble.innerHTML = markdownToHtml(rendered);
      scrollToBottom(false);
      await new Promise(r => setTimeout(r, 8));
    }
    bubble.innerHTML = markdownToHtml(content);
    attachRunButtons();
    checkTriggers(content);
  } else {
    msg.innerHTML = `<div class="message-row"><div class="avatar user">U</div><div class="bubble">${escapeHtml(content)}</div></div>`;
    messagesEl.appendChild(msg);
  }
  scrollToBottom(true);
}

// ============================
// Events
// ============================

function setupEventListeners() {
  sendBtn.onclick = () => sendMessage(inputEl.value);
  inputEl.addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMessage(inputEl.value); } });
  inputEl.addEventListener('input', () => { autoResize(); sendBtn.disabled=!inputEl.value.trim()||state.streaming; });
  $('newChatBtn').onclick = createChat;
  $('clearBtn').onclick = () => { const chat=getActiveChat(); if(chat){ chat.messages=[]; chat.title='New Chat'; saveChats(); loadChat(chat.id); } };
  sidebarToggle.onclick = () => sidebar.classList.toggle('collapsed');

  modelSelector.addEventListener('click', e=>{ e.stopPropagation(); modelDropdown.classList.toggle('open'); });
  document.querySelectorAll('.model-option').forEach(opt => {
    opt.addEventListener('click', () => {
      state.provider = opt.dataset.provider || state.provider;
      state.model = opt.dataset.model || state.model;
      updateModelLabel();
      document.querySelectorAll('.model-option').forEach(o=>o.classList.remove('active'));
      opt.classList.add('active');
      modelDropdown.classList.remove('open');
      localStorage.setItem('nc_provider', state.provider);
      localStorage.setItem('nc_model', state.model);
    });
  });
  document.addEventListener('click', () => modelDropdown.classList.remove('open'));
  modelLabel.addEventListener('dblclick', promptForKey);

  document.querySelectorAll('.suggestion-card').forEach(card=>{
    card.onclick=()=>{ const prompt=card.dataset.prompt; inputEl.value=prompt; autoResize(); sendBtn.disabled=false; sendMessage(prompt); };
  });

  // Settings modal
  openSettingsBtn.onclick=()=>{
    apiKeyInput.value=state.apiKey;
    providerSelect.value=state.provider;
    modelSelect.value=state.model;
    systemPromptInput.value=state.systemPrompt;
    renderTriggerList();
    settingsModal.style.display = 'flex';
  };
  closeSettingsBtn.onclick=()=>{ settingsModal.style.display='none'; };
  window.onclick = e => { if(e.target===settingsModal) settingsModal.style.display='none'; };
  addTriggerBtn.onclick = () => {
    state.triggers.push({ match: '', type: 'contains', action: '' });
    renderTriggerList();
  };
  saveSettingsBtn.onclick=()=>{
    state.apiKey = apiKeyInput.value.trim();
    state.provider = providerSelect.value;
    state.model = modelSelect.value.trim() || state.model;
    state.systemPrompt = systemPromptInput.value;
    state.triggers = [];
    triggerListEl.querySelectorAll('.trigger-row').forEach(row => {
      const match = row.querySelector('.trigger-match').value.trim();
      const type = row.querySelector('.trigger-type').value;
      const action = row.querySelector('.trigger-action').value.trim();
      if (match) state.triggers.push({ match, type, action });
    });
    localStorage.setItem('nc_apikey', state.apiKey);
    localStorage.setItem('nc_provider', state.provider);
    localStorage.setItem('nc_model', state.model);
    localStorage.setItem('nc_systemprompt', state.systemPrompt);
    localStorage.setItem('nc_triggers', JSON.stringify(state.triggers));
    updateModelLabel(); settingsModal.style.display='none';
    showToast('✓ Settings saved');
  };
}

// ============================
// Trigger List UI
// ============================

function renderTriggerList() {
  triggerListEl.innerHTML = '';
  if (state.triggers.length === 0) {
    triggerListEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 2px;">No triggers yet. Add one below — the action runs as JavaScript when the AI response matches.</div>';
    return;
  }
  state.triggers.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'trigger-row trigger-row-vertical';
    const defaultAction = t.action || '// Variables: response (full text), match (array)\n// Examples:\n// alert("AI said: " + match[0])\n// fetch("https://your-webhook.com", { method:"POST", body: response })';
    row.innerHTML = `
      <div class="trigger-row-top">
        <select class="trigger-type">
          <option value="contains" ${t.type==='contains'?'selected':''}>contains</option>
          <option value="regex" ${t.type==='regex'?'selected':''}>regex</option>
        </select>
        <input class="trigger-match" type="text" placeholder="match text or pattern…" value="${escapeHtml(t.match)}">
        <button class="trigger-del-btn" data-i="${i}" title="Delete trigger">×</button>
      </div>
      <div class="trigger-row-bottom">
        <span class="trigger-js-label">JS</span>
        <textarea class="trigger-action" rows="4" spellcheck="false" placeholder="// JS to run. Variables: response, match">${escapeHtml(defaultAction)}</textarea>
      </div>
    `;
    row.querySelector('.trigger-del-btn').onclick = () => {
      state.triggers.splice(i, 1);
      renderTriggerList();
    };
    row.querySelector('.trigger-action').addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.target;
        const s = ta.selectionStart, end = ta.selectionEnd;
        ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = s + 2;
      }
    });
    triggerListEl.appendChild(row);
  });
}

// ============================
// CSS for tool-feedback bubbles (injected once)
// ============================
(function injectToolFeedbackStyles() {
  if (document.getElementById('tool-feedback-styles')) return;
  const style = document.createElement('style');
  style.id = 'tool-feedback-styles';
  style.textContent = `
    .message.tool-feedback .tool-fb-avatar {
      background: linear-gradient(135deg, #2a2a3a, #3a3a50);
      border: 1px solid #555;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .message.tool-feedback .tool-fb-bubble {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border: 1px solid #334;
      color: #aac4e0;
      font-size: 13px;
      border-radius: 8px;
      padding: 10px 14px;
    }
    .message.tool-feedback .tool-fb-bubble strong {
      color: #7eb8f7;
    }
    .message.tool-feedback .tool-fb-bubble code {
      background: #0d1117;
      color: #79c0ff;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);
})();

init();
// ============================
// Playground
// ============================

(function initPlayground() {
  const playgroundBtn = document.getElementById('playgroundBtn');
  const playgroundModal = document.getElementById('playgroundModal');
  const playgroundClose = document.getElementById('playgroundClose');
  const pgRunBtn = document.getElementById('pgRunBtn');
  const pgClearBtn = document.getElementById('pgClearBtn');
  const pgShareBtn = document.getElementById('pgShareBtn');
  const pgHtml = document.getElementById('pgHtml');
  const pgCss = document.getElementById('pgCss');
  const pgJs = document.getElementById('pgJs');
  const pgPreview = document.getElementById('pgPreview');
  const deviceBtns = document.querySelectorAll('.pg-device-btn');

  // ---- AI Panel elements ----
  const pgAiToggle = document.getElementById('pgAiToggle');
  const pgAiPanel = document.getElementById('pgAiPanel');
  const pgAiMessages = document.getElementById('pgAiMessages');
  const pgAiInput = document.getElementById('pgAiInput');
  const pgAiSend = document.getElementById('pgAiSend');
  const pgAiClearBtn = document.getElementById('pgAiClearBtn');

  let pgAiOpen = false;
  let pgAiHistory = []; // {role, content}
  let pgAiStreaming = false;

  const PG_AI_SYSTEM = `You are an expert web developer embedded in a live code playground.
The user will describe websites, apps, or UI components they want to build.
Your job is to generate complete, working HTML, CSS, and JavaScript.

STRICT OUTPUT FORMAT — always respond with exactly this structure:

[THOUGHT]
One sentence describing what you're building.
[/THOUGHT]

[HTML]
(complete HTML body content, no <html>/<head>/<body> tags)
[/HTML]

[CSS]
(complete CSS)
[/CSS]

[JS]
(complete JavaScript, or empty if none needed)
[/JS]

Rules:
- Make it visually beautiful, modern, and polished by default.
- Use CSS variables for theming when possible.
- JavaScript must be self-contained, no imports.
- Never include markdown fences. Output raw code only inside the tags.
- If the user asks to modify existing code, they will provide it. Preserve what they want to keep, update what they ask to change.
- Always output all three sections even if one is empty.`;

  function toggleAiPanel() {
    pgAiOpen = !pgAiOpen;
    pgAiPanel.classList.toggle('open', pgAiOpen);
    pgAiToggle.classList.toggle('active', pgAiOpen);
    if (pgAiOpen) setTimeout(() => pgAiInput.focus(), 300);
  }

  pgAiToggle.addEventListener('click', toggleAiPanel);

  // Clear AI conversation
  pgAiClearBtn.addEventListener('click', () => {
    pgAiHistory = [];
    pgAiMessages.innerHTML = `<div class="pg-ai-welcome">
      <div class="pg-ai-welcome-icon">✦</div>
      <p>Describe the website you want to build and I'll generate the HTML, CSS, and JS for you.</p>
      <div class="pg-ai-suggestions">
        <button class="pg-ai-suggestion" data-prompt="Build a sleek landing page for a SaaS product with a hero section, features grid, and CTA button">Landing page</button>
        <button class="pg-ai-suggestion" data-prompt="Create an interactive todo app with add, complete, and delete functionality, dark theme">Todo app</button>
        <button class="pg-ai-suggestion" data-prompt="Build a personal portfolio page with animated sections, skills bars, and contact form">Portfolio</button>
        <button class="pg-ai-suggestion" data-prompt="Create a CSS-only animated loading screen with particles and a progress bar">Loading screen</button>
      </div>
    </div>`;
    bindSuggestions();
  });

  function bindSuggestions() {
    pgAiMessages.querySelectorAll('.pg-ai-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        pgAiInput.value = btn.dataset.prompt;
        pgAiInput.dispatchEvent(new Event('input'));
        sendAiMessage();
      });
    });
  }
  bindSuggestions();

  // Input auto-resize and enable/disable send
  pgAiInput.addEventListener('input', () => {
    pgAiInput.style.height = 'auto';
    pgAiInput.style.height = Math.min(pgAiInput.scrollHeight, 120) + 'px';
    pgAiSend.disabled = !pgAiInput.value.trim() || pgAiStreaming;
  });

  pgAiInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!pgAiSend.disabled) sendAiMessage();
    }
  });
  pgAiSend.addEventListener('click', sendAiMessage);

  function appendUserMsg(text) {
    const el = document.createElement('div');
    el.className = 'pg-msg pg-msg-user';
    el.innerHTML = '<div class="pg-msg-role">You</div><div class="pg-msg-bubble">' + escapeHtml(text) + '</div>';
    pgAiMessages.appendChild(el);
    pgAiMessages.scrollTop = pgAiMessages.scrollHeight;
  }

  function appendTyping() {
    const wrap = document.createElement('div');
    wrap.className = 'pg-msg pg-msg-assistant';
    wrap.innerHTML = '<div class="pg-msg-role">AI</div>';
    const dot = document.createElement('div');
    dot.className = 'pg-typing';
    dot.innerHTML = '<span></span><span></span><span></span>';
    wrap.appendChild(dot);
    pgAiMessages.appendChild(wrap);
    pgAiMessages.scrollTop = pgAiMessages.scrollHeight;
    return { wrap, dot };
  }

  function parseAiBlocks(text) {
    const get = (tag) => {
      const m = text.match(new RegExp('\\[' + tag + '\\]([\\s\\S]*?)\\[\\/' + tag + '\\]', 'i'));
      return m ? m[1].trim() : '';
    };
    const thought = get('THOUGHT');
    const html = get('HTML');
    const css = get('CSS');
    const js = get('JS');
    return { thought, html, css, js };
  }

  function applyToEditors(html, css, js) {
    if (html !== undefined) pgHtml.value = html;
    if (css !== undefined) pgCss.value = css;
    if (js !== undefined) pgJs.value = js;
    run();
  }

  async function sendAiMessage() {
    const text = pgAiInput.value.trim();
    if (!text || pgAiStreaming) return;
    if (!state.apiKey) { showToast('No API key set', 'error'); return; }

    // Hide welcome if present
    const welcome = pgAiMessages.querySelector('.pg-ai-welcome');
    if (welcome) welcome.remove();

    appendUserMsg(text);
    pgAiInput.value = '';
    pgAiInput.style.height = 'auto';
    pgAiSend.disabled = true;
    pgAiStreaming = true;

    // Build message history — include current editor state as context
    const currentCode = pgHtml.value || pgCss.value || pgJs.value
      ? '\n\nCurrent editor state:\n[HTML]\n' + pgHtml.value + '\n[/HTML]\n[CSS]\n' + pgCss.value + '\n[/CSS]\n[JS]\n' + pgJs.value + '\n[/JS]'
      : '';

    const userMsg = { role: 'user', content: text + currentCode };
    pgAiHistory.push(userMsg);

    const { wrap, dot } = appendTyping();

    try {
      const provider = PROVIDERS[state.provider];
      let body;
      if (state.provider === 'anthropic') {
        body = { model: state.model, messages: pgAiHistory, max_tokens: 4096, system: PG_AI_SYSTEM };
      } else {
        body = { model: state.model, messages: [{ role: 'system', content: PG_AI_SYSTEM }, ...pgAiHistory], max_tokens: 4096 };
      }

      const res = await fetch(provider.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.apiKey },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || 'API error ' + res.status);
      }

      const data = await res.json();
      const rawText = state.provider === 'anthropic'
        ? (data.content?.[0]?.text || '')
        : (data.choices?.[0]?.message?.content || '');

      pgAiHistory.push({ role: 'assistant', content: rawText });

      // Parse blocks
      const { thought, html, css, js } = parseAiBlocks(rawText);

      // Replace typing indicator with real response
      dot.remove();
      const bubble = document.createElement('div');
      bubble.className = 'pg-msg-bubble';

      const hasCode = html || css || js;
      let innerHtml = thought ? '<p>' + escapeHtml(thought) + '</p>' : '';

      if (hasCode) {
        const badge = '<div class="pg-applied-badge" id="pgApplyBadge">✓ Code applied — click to re-apply</div>';
        innerHtml += badge;
      } else {
        innerHtml += '<p>' + escapeHtml(rawText.replace(/\[[\w\/]+\]/g, '').trim().slice(0, 300)) + '</p>';
      }

      bubble.innerHTML = innerHtml;
      wrap.appendChild(bubble);
      pgAiMessages.scrollTop = pgAiMessages.scrollHeight;

      // Auto-apply
      if (hasCode) {
        applyToEditors(html, css, js);
        const badge = bubble.querySelector('#pgApplyBadge');
        if (badge) {
          badge.addEventListener('click', () => applyToEditors(html, css, js));
        }
      }

    } catch (err) {
      dot.remove();
      const errBubble = document.createElement('div');
      errBubble.className = 'pg-msg-bubble';
      errBubble.style.color = '#ff5f5f';
      errBubble.textContent = 'Error: ' + err.message;
      wrap.appendChild(errBubble);
      pgAiHistory.pop(); // remove failed user message
    } finally {
      pgAiStreaming = false;
      pgAiSend.disabled = !pgAiInput.value.trim();
    }
  }

  // ---- Open / Close ----
  let autoRunTimer = null;

  function openPlayground() {
    playgroundModal.classList.add('open');
    pgHtml.focus();
  }

  function closePlayground() {
    playgroundModal.classList.remove('open');
  }

  playgroundBtn.onclick = openPlayground;
  playgroundClose.onclick = closePlayground;
  playgroundModal.addEventListener('click', e => { if (e.target === playgroundModal) closePlayground(); });

  function run() {
    const html = pgHtml.value;
    const css = pgCss.value;
    const js = pgJs.value;
    const doc = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body>' + html + '<script>(function(){' + js + '})();<\/script></body></html>';
    pgPreview.srcdoc = doc;
  }

  pgRunBtn.onclick = run;

  function scheduleAutoRun() {
    clearTimeout(autoRunTimer);
    autoRunTimer = setTimeout(run, 800);
  }
  [pgHtml, pgCss, pgJs].forEach(ta => ta.addEventListener('input', scheduleAutoRun));

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && playgroundModal.classList.contains('open')) {
      e.preventDefault(); run();
    }
    if (e.key === 'Escape' && playgroundModal.classList.contains('open')) {
      closePlayground();
    }
  });

  pgClearBtn.onclick = () => {
    if (confirm('Clear all editors?')) {
      pgHtml.value = ''; pgCss.value = ''; pgJs.value = ''; pgPreview.srcdoc = '';
    }
  };

  pgShareBtn.onclick = () => {
    const doc = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + pgCss.value + '</style></head><body>' + pgHtml.value + '<script>' + pgJs.value + '<\/script></body></html>';
    const blob = new Blob([doc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'playground.html'; a.click();
    URL.revokeObjectURL(url);
    showToast('Exported as playground.html');
  };

  deviceBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      deviceBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const w = btn.dataset.w;
      const wrap = document.querySelector('.pg-preview-wrap');
      pgPreview.style.width = w;
      pgPreview.style.flex = w === '100%' ? '1' : '0 0 ' + w;
      wrap.style.justifyContent = w === '100%' ? 'stretch' : 'center';
      wrap.style.background = w === '100%' ? '#fff' : '#e8e8ec';
    });
  });

  [pgHtml, pgCss, pgJs].forEach(ta => {
    ta.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = ta.selectionStart, end = ta.selectionEnd;
        ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = s + 2;
      }
    });
  });

  document.querySelectorAll('.pg-pane-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.pane;
      const paneId = 'pg' + key.charAt(0).toUpperCase() + key.slice(1) + 'Pane';
      const pane = document.getElementById(paneId);
      const collapsed = pane.classList.toggle('collapsed');
      btn.textContent = collapsed ? '+' : '-';
    });
  });

  document.querySelectorAll('.pg-resizer').forEach(resizer => {
    resizer.addEventListener('mousedown', e => {
      e.preventDefault();
      resizer.classList.add('dragging');
      const startY = e.clientY;
      const prev = resizer.previousElementSibling;
      const next = resizer.nextElementSibling;
      const startPrev = prev.getBoundingClientRect().height;
      const startNext = next.getBoundingClientRect().height;

      const onMove = ev => {
        const dy = ev.clientY - startY;
        const newPrev = Math.max(34, startPrev + dy);
        const newNext = Math.max(34, (startPrev + startNext) - newPrev);
        prev.style.flex = '0 0 ' + newPrev + 'px';
        next.style.flex = '0 0 ' + newNext + 'px';
      };
      const onUp = () => {
        resizer.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  const pgEditors = document.querySelector('.pg-editors');
  const pgPreviewCol = document.querySelector('.pg-preview-col');
  const colResizer = document.createElement('div');
  colResizer.className = 'pg-col-resizer';
  pgEditors.parentElement.insertBefore(colResizer, pgPreviewCol);

  colResizer.addEventListener('mousedown', e => {
    e.preventDefault();
    colResizer.classList.add('dragging');
    const startX = e.clientX;
    const startW = pgEditors.getBoundingClientRect().width;
    const parentW = pgEditors.parentElement.getBoundingClientRect().width;

    const onMove = ev => {
      const newW = Math.min(Math.max(200, startW + (ev.clientX - startX)), parentW - 200);
      pgEditors.style.cssText = 'width:' + newW + 'px;min-width:' + newW + 'px;max-width:' + newW + 'px';
    };
    const onUp = () => {
      colResizer.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  window.openPlaygroundWith = function(opts) {
    opts = opts || {};
    if (opts.html) pgHtml.value = opts.html;
    if (opts.css) pgCss.value = opts.css;
    if (opts.js) pgJs.value = opts.js;
    openPlayground();
    run();
  };

})();