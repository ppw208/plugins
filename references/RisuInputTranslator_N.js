// ===== V1-style UI (//@arg) =====
//@name RisuInputTranslator
//@display-name 📝 인풋 번역 플러그인 (누더기 개조)
//@version 2.1.1
//@description 영입 영출을 조금 더 편하게 (Gemini: System→User, Assistant 유지)

// ---- [맨 위] 토글/숫자 옵션 (0/1) ----
//@arg enable_plugin int 1 "플러그인 활성화 (1=ON)"
//@arg only_if_korean int 0 "한글 포함시에만 번역"
//@arg preserve_quotes int 1 "따옴표/백틱 감싸임 보존"
//@arg debug int 1 "디버그 로그"
//@arg show_errors int 1 "오류/안내 토스트"

// ---- API 기본 설정 ----
//@arg translator_api_type string openai "API 타입(OpenAI/Gemini/Anthropic 등)"
//@arg translator_api_url string https://api.openai.com/v1/chat/completions "API URL"
//@arg translator_api_key string  "API Key (...)"
//@arg translator_model string gpt-4o-mini "모델명"

// ---- 생성 설정 (New) ----
//@arg translator_temp string 0 "온도 (Temperature, 0~2)"
//@arg translator_max_tokens int 0 "최대 토큰 (0=자동/기본)"

// ---- 번역 품질 관련 ----
//@arg system_prompt string  "번역 템플릿({{solt::content}} 포함시 템플릿 모드)"
//@arg translator_notes string  "번역가의 노트({{slot::tnote}}로 삽입)"

// ===== RisuInputTranslator v2.1.1  =====
console.info("[RisuInputTranslator] boot start (v2.1.1)");

;(() => {
  // --- setArg/getArg polyfill ---
  try {
    const g = globalThis;
    g.__pluginApis__ = g.__pluginApis__ || {};
    const apis = g.__pluginApis__;
    if (typeof apis.setArg !== "function") {
      const store = apis.__argStore__ || {};
      apis.__argStore__ = store;
      const oldGet = typeof apis.getArg === "function" ? apis.getArg.bind(apis) : null;
      apis.setArg = function (k, v) { store[k] = v; return v; };
      apis.getArg = function (k) {
        if (Object.prototype.hasOwnProperty.call(store, k)) return store[k];
        return oldGet ? oldGet(k) : undefined;
      };
    }
  } catch (e) { console.error("[RisuInputTranslator] polyfill error", e); }

  const PLUGIN_NAME  = "RisuInputTranslator";
  const DISPLAY_NAME = "📝 인풋 번역 플러그인";
  const apis = globalThis.__pluginApis__ || {};
  const risuFetch = apis.risuFetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);

  // ----- robust getters -----
  function _readFromParams(key){
    try {
      const p = globalThis.__pluginParams__ || {};
      const args = p.args || p || {};
      const v = args[key];
      return v === undefined ? undefined : v;
    } catch { return undefined; }
  }
  function _lsKey(k){ return `engf_${k}`; }
  function getArgRaw(key) {
    try {
      const fn = apis.getArg;
      if (fn) {
        let v = fn(key); if (v !== undefined) return v;
        v = fn(`${PLUGIN_NAME}::${key}`); if (v !== undefined) return v;
        v = fn(`${DISPLAY_NAME}::${key}`); if (v !== undefined) return v;
      }
    } catch {}
    const pv = _readFromParams(key);
    if (pv !== undefined && pv !== null) return pv;
    try {
      const lv = localStorage.getItem(_lsKey(key));
      if (lv !== null) return lv;
    } catch {}
    return undefined;
  }
  function getArg(key, defVal = "") {
    const v = getArgRaw(key);
    const s = (v === undefined || v === null) ? "" : String(v);
    return s.trim() !== "" ? s.trim() : defVal;
  }
  function setArg(key, val) {
    try {
      const fn = apis.setArg;
      if (fn) { fn(key, val); fn(`${PLUGIN_NAME}::${key}`, val); fn(`${DISPLAY_NAME}::${key}`, val); }
    } catch {}
    try { localStorage.setItem(_lsKey(key), String(val ?? "")); } catch {}
  }
  function getInt(key, defVal = 0) {
    const n = Number(getArg(key, String(defVal)));
    return Number.isFinite(n) ? n : defVal;
  }
  function getFloat(key, defVal = 0.0) {
    const n = Number(getArg(key, String(defVal)));
    return Number.isFinite(n) ? n : defVal;
  }

  // read args
  const API_TYPE_RAW = getArg("translator_api_type", "openai");
  const API_URL      = getArg("translator_api_url", "https://api.openai.com/v1/chat/completions");
  const API_KEY      = getArg("translator_api_key", "");
  const MODEL        = getArg("translator_model", "gpt-4o-mini");

  const TEMP_VAL     = getFloat("translator_temp", 0);
  const MAX_TOK_VAL  = getInt("translator_max_tokens", 0);

  const ENABLED  = getInt("enable_plugin", 1) === 1;
  const ONLY_KO  = getInt("only_if_korean", 0) === 1;
  const PRESERVE_QUOTES = getInt("preserve_quotes", 1) === 1;
  const DEBUG    = getInt("debug", 1) === 1;
  const SHOW_ERR = getInt("show_errors", 1) === 1;

  if (!ENABLED) { console.info("[RisuInputTranslator] disabled by setting"); return; }
  if (!risuFetch) { console.error("[RisuInputTranslator] risuFetch/fetch not available"); return; }

  function normalizeApiType(s) {
    const v = String(s || "").trim().toLowerCase();
    const map = {
      "openai":"openai","openai-compatible":"openai","openrouter":"openai","deepseek":"openai","groq":"openai","novita":"openai",
      "anthropic":"anthropic","claude":"anthropic",
      "gemini":"gemini","google":"gemini","google-ai":"gemini","googleai":"gemini"
    };
    return map[v] || (v.includes("open") ? "openai" : v.includes("claude") ? "anthropic" : (v.includes("gemini")||v.includes("google")) ? "gemini" : "openai");
  }
  const API_TYPE = normalizeApiType(API_TYPE_RAW);

  // ===== styles =====
  const style = document.createElement("style");
  style.textContent = `
    .rit-translate-btn{padding:5px 9px;border:1px solid #3b82f6;border-radius:8px;background:#1e293b;color:#e5e7eb;font-size:12px;line-height:1;margin-right:6px;display:inline-flex;align-items:center;gap:6px}
    .rit-translate-btn.busy{opacity:.65;cursor:wait;pointer-events:none}
    .rit-translate-btn .spin{width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:rit-spin .8s linear infinite}
    @keyframes rit-spin{to{transform:rotate(360deg)}}
    .rit-gear-btn{padding:5px 7px;border:1px solid #475569;border-radius:8px;background:#0f172a;color:#cbd5e1;display:inline-flex;align-items:center;line-height:1;font-size:14px}
    .rit-gear-btn:hover{background:#111827}
    .rit-shake{animation:rit-shake .24s linear 1}
    @keyframes rit-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-2px)}75%{transform:translateX(2px)}}
    .rit-toast-wrap{position:absolute;right:6px;bottom:6px;display:flex;flex-direction:column;gap:6px;z-index:2147483647}
    .rit-toast{padding:7px 9px;border-radius:8px;font-size:12px;color:#e5e7eb;box-shadow:0 4px 12px rgba(0,0,0,.25);max-width:340px;line-height:1.35}
    .rit-toast.error{background:#7f1d1d;border:1px solid #ef4444}
    .rit-toast.warn{background:#5b470a;border:1px solid #eab308}
    .rit-toast.ok{background:#0b3d2e;border:1px solid #22c55e}
    .rit-toast .code{font-family:ui-monospace,Menlo,Consolas,monospace;background:rgba(0,0,0,.2);padding:1px 4px;border-radius:4px}

    .rit-panel-wrap{position:absolute;right:6px;bottom:48px;z-index:2147483647}
    .rit-panel{position:relative;width:min(500px,92vw);background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.35);padding:10px}
    .rit-panel h4{margin:0 0 6px 0;font-size:13px;color:#cbd5e1}
    .rit-tabs-row{display:flex;align-items:center;gap:6px;margin-bottom:6px}
    .rit-tabs{display:flex;gap:6px}
    .rit-tab{padding:5px 8px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#cbd5e1;font-size:12px;cursor:pointer}
    .rit-tab.active{border-color:#3b82f6;background:#1e293b;color:#e5e7eb}

    .rit-section{display:none}
    .rit-section.active{display:block}
    .rit-field{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}
    .rit-field label{font-size:11.5px;color:#94a3b8}
    .rit-field input, .rit-field textarea{width:100%;min-height:34px;background:#0a0f1a;color:#e5e7eb;border:1px solid #334155;border-radius:8px;padding:6px;font-size:12px}
    .rit-field textarea{min-height:48px;resize:vertical}
    .rit-row{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
    .rit-btn{padding:5px 9px;border-radius:8px;font-size:12px;border:1px solid #475569;background:#111827;color:#e5e7eb}
    .rit-btn.primary{border-color:#3b82f6;background:#1e293b}
    .rit-inline-caption{font-size:10.5px;color:#9ca3af}
    .rit-metrics{display:flex;gap:10px;font-size:10.5px;color:#9ca3af}
    .rit-metrics .warn{color:#fbbf24}.rit-metrics .danger{color:#f87171}
    .rit-label-row{display:flex;align-items:center;justify-content:space-between;gap:6px}
    .rit-copy-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;border:1px solid #334155;background:#0f172a;color:#cbd5e1;cursor:pointer;flex:0 0 auto}
    .rit-copy-btn:hover{background:#111827}
    .rit-copy-btn svg{width:14px;height:14px;display:block;flex:0 0 auto}
    .rit-passwrap{display:flex;gap:6px}
    .rit-passwrap input{flex:1}
    .rit-passwrap button{padding:5px 8px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#cbd5e1;cursor:pointer}
    .rit-preview-out{min-height:64px;white-space:pre-wrap;background:#0a0f1a;border:1px solid #334155;border-radius:8px;padding:8px;font-size:12px}
  `;
  document.head.appendChild(style);

  // ---- utils ----
  const qa = (sel, root=document)=> { try { return sel ? Array.from(root.querySelectorAll(sel)) : []; } catch { return []; } };
  const q1 = (sel, root=document)=> { try { return sel ? root.querySelector(sel) : null; } catch { return null; } };
  const vis = el => !!(el && el.offsetParent !== null);
  const hasHangul = (s)=> /[ㄱ-ㅎ가-힣]/.test(s || "");
  const isEditable = el => !!el && (el.tagName?.toLowerCase() === "textarea" || el.isContentEditable || el.getAttribute?.("contenteditable") === "true");
  const kindOf = el => el?.tagName?.toLowerCase() === "textarea" ? "textarea" : (el?.isContentEditable ? "editable" : "unknown");
  const getText = (el,k)=> k==="textarea" ? String(el.value ?? "") : k==="editable" ? String(el.innerText ?? el.textContent ?? "") : "";
  const setText = (el,k,val)=> { if (!el) return; if (k==="textarea") el.value=val; else if (k==="editable") el.innerText=val; else { try{el.value=val;}catch{} try{el.innerText=val;}catch{} }
    el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); el.dispatchEvent(new KeyboardEvent("keyup",{key:" ",bubbles:true}));
  };
  function nudge(el){ try{ el.classList.remove("rit-shake"); void el.offsetWidth; el.classList.add("rit-shake"); setTimeout(()=>el.classList.remove("rit-shake"), 240);}catch{} }
  const esc = s => String(s || "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  function ensureToastWrap(scope) {
    const host = scope || document.body;
    let wrap = host.querySelector(".rit-toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "rit-toast-wrap";
      const cs = getComputedStyle(host);
      if (cs.position === "static") host.style.position = "relative";
      host.appendChild(wrap);
    }
    return wrap;
  }
  function showToast(scope, type, msg, timeoutMs=3800) {
    if (!SHOW_ERR) return;
    const wrap = ensureToastWrap(scope);
    const t = document.createElement("div");
    t.className = `rit-toast ${type}`;
    t.innerHTML = msg;
    wrap.appendChild(t);
    setTimeout(()=> { try { t.remove(); } catch {} }, timeoutMs);
    return t;
  }

  async function copyText(text, scope) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position="fixed"; ta.style.left="-9999px"; ta.style.top="-9999px";
      (scope || document.body).appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return !!ok;
    } catch { return false; }
  }

  // composer scan
  function composerCandidates() {
    const sendBtns = qa('button[type="submit"], button.button-icon-send').filter(vis);
    const compos = new Set();
    for (const b of sendBtns) {
      let cur = b;
      for (let i=0; cur && i<6; i++, cur = cur.parentElement) {
        const hasSend = cur.querySelector?.('button[type="submit"], button.button-icon-send');
        const hasChatTa = cur.querySelector?.('textarea.text-input-area, textarea.input-text');
        if (hasSend && hasChatTa) { compos.add(cur); break; }
      }
    }
    qa('textarea.text-input-area, textarea.input-text').filter(vis).forEach(t => {
      let cur = t;
      for (let i=0; cur && i<6; i++, cur = cur.parentElement) {
        const hasSend = cur.querySelector?.('button[type="submit"], button.button-icon-send');
        const hasChatTa = cur.querySelector?.('textarea.text-input-area, textarea.input-text');
        if (hasSend && hasChatTa) { compos.add(cur); break; }
      }
    });
    return Array.from(compos);
  }
  function pickMainComposer() {
    const cands = composerCandidates();
    if (cands.length === 0) return null;
    const scored = cands.map(c => ({ c, rect: c.getBoundingClientRect() }))
                        .filter(o => o.rect && isFinite(o.rect.top));
    if (scored.length === 0) return cands[0];
    scored.sort((a,b) => a.rect.top - b.rect.top);
    return scored[scored.length - 1].c;
  }
  function inputsIn(comp) { return qa('textarea.text-input-area, textarea.input-text, [contenteditable="true"],[role="textbox"],[aria-multiline="true"]', comp); }
  function getLiveInput(comp){
    const ae = document.activeElement;
    if (isEditable(ae) && comp?.contains?.(ae)) return { el: ae, kind: kindOf(ae) };
    const list = inputsIn(comp).filter(vis);
    const last = list[list.length-1];
    return last ? { el:last, kind:kindOf(last) } : null;
  }
  function findSendButton(comp) {
    if (!comp) return null;
    let btn = q1('button[type="submit"]', comp); if (btn) return btn;
    btn = q1('button.button-icon-send', comp); if (btn) return btn;
    return null;
  }

  // ===== ChatML Parsing Logic =====
  const defaultSystemPrompt =
`<|im_start|>system
You are a professional translator. Translate the user's Korean input into natural, context-appropriate ENGLISH.
Preserve ALL punctuation exactly, including any leading/trailing quotation marks and backticks.
Return ONLY the translated text; no commentary, labels, or extra quotes.
{{slot::tnote}}<|im_end|>
<|im_start|>user
{{solt::content}}<|im_end|>`;

  const fallbackLegacySystemPrompt =
    "You are a professional translator. Translate the user's Korean input into natural, context-appropriate ENGLISH.\n" +
    "Preserve ALL punctuation exactly, including any leading/trailing quotation marks and backticks.\n" +
    "Return ONLY the translated text; no commentary, labels, or extra quotes.";

  function parseChatMLToMessages(text) {
    const messages = [];
    const parts = text.split(/<\|im_start\|>/i);
    for (const p of parts) {
      const trimmed = p.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^([a-z]+)\s*([\s\S]*)/i);
      if (match) {
        let role = match[1].toLowerCase();
        let content = match[2];
        content = content.replace(/<\|im_end\|>$/i, "").trim();
        if (content) messages.push({ role, content });
      }
    }
    if (messages.length === 0 && text.trim()) return [{ role: "user", content: text }];
    return messages;
  }

  function buildSystemPromptLegacy(sysOverride, notesOverride) {
    const base = (String(sysOverride || "").trim()) || fallbackLegacySystemPrompt;
    const notes = String(notesOverride ?? "").trim();
    if (!notes) return base;
    return base + `\n\nTranslator's Notes (hard constraints):\n${notes}\n- Enforce terminology and style from the notes above.`;
  }

  // http helpers
  function normUrl(u){ return String(u||"").replace(/\/+$/,""); }
  async function postJSONWithFallback(endpoint, headersBase, payload){
    const variants = [
      { key: "json-key",         init: { method:"POST", headers:{...headersBase, "Accept":"application/json"},       json: payload }},
      { key: "stringified-body", init: { method:"POST", headers:{...headersBase, "Content-Type":"application/json"}, body: JSON.stringify(payload) }},
      { key: "raw-body",         init: { method:"POST", headers:{...headersBase, "Content-Type":"application/json"}, body: payload }},
    ];
    let last = null;
    for (let i=0;i<variants.length;i++){
      const v = variants[i];
      const res = await risuFetch(endpoint, v.init);
      last = res;
      if (res?.ok) { if (DEBUG) console.log("[RisuInputTranslator] http ok via", v.key); return res; }
    }
    return last;
  }

  // API Callers
  async function callOpenAI(url, key, model, messages, temp, maxTokens) {
    const base = normUrl(url);
    const endpoint = /chat\/completions$/.test(base) ? base
                    : /\/v1$/.test(base) ? base + "/chat/completions"
                    : base.includes("/v1/chat/completions") ? base
                    : base + "/v1/chat/completions";
    const payload = { model, temperature: temp, messages, stop: ["<|im_end|>"] };
    if (maxTokens > 0) payload.max_tokens = maxTokens;

    const headers = { "Authorization": `Bearer ${key}` };
    if (/openrouter\.ai/i.test(endpoint)) { headers["HTTP-Referer"] = location.origin || "https://risu.ai"; headers["X-Title"] = "RisuInputTranslator"; }
    return await postJSONWithFallback(endpoint, headers, payload);
  }

  async function callAnthropic(url, key, model, messages, temp, maxTokens) {
    const base = normUrl(url);
    const endpoint = /\/v1\/messages$/.test(base) ? base : base.endsWith("/v1") ? base + "/messages" : base + "/v1/messages";
    const sysMsg = messages.find(m => m.role === "system")?.content || "";
    const msg = messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: [{ type:"text", text: m.content }] }));
    
    // Anthropic requires max_tokens
    const tokens = maxTokens > 0 ? maxTokens : 4096;
    const payload = { model, system: sysMsg || undefined, messages: msg, max_tokens: tokens, temperature: temp };
    return await postJSONWithFallback(endpoint, { "x-api-key": key, "anthropic-version":"2023-06-01" }, payload);
  }

  // [Fix] Gemini: System->User, User->User, Assistant->Model mapping
  // Also merges consecutive identical roles (e.g. System(->User) + User)
  async function callGemini(url, key, model, messages, temp, maxTokens) {
    // 1. Role Conversion
    const converted = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user", // system becomes user
      parts: [{ text: m.content }]
    }));

    // 2. Merge consecutive identical roles
    const finalContents = [];
    if (converted.length > 0) {
      let last = converted[0];
      for (let i = 1; i < converted.length; i++) {
        const curr = converted[i];
        if (last.role === curr.role) {
          last.parts[0].text += "\n\n" + curr.parts[0].text;
        } else {
          finalContents.push(last);
          last = curr;
        }
      }
      finalContents.push(last);
    }

    const payload = {
      contents: finalContents,
      generationConfig: { temperature: temp }
    };
    if (maxTokens > 0) payload.generationConfig.maxOutputTokens = maxTokens;

    // LBI matches: Threshold set to "OFF"
    const safetyThreshold = "OFF";
    payload.safetySettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: safetyThreshold },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: safetyThreshold },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: safetyThreshold },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: safetyThreshold },
      { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: safetyThreshold }
    ];

    const host = normUrl(url || "https://generativelanguage.googleapis.com");
    const endpoint = `${host}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    return await postJSONWithFallback(endpoint, {}, payload);
  }

  function pickText(data){
    try {
      // 1. OpenAI / Generic
      if (data?.choices?.length) {
        const c0 = data.choices[0];
        if (c0?.message?.content) return String(c0.message.content).trim();
        if (typeof c0?.text === "string") return c0.text.trim();
      }
      
      // 2. Anthropic
      if (Array.isArray(data?.content)) {
        const t = data.content.filter(p => p?.type === "text").map(p => p.text).join("").trim();
        if (t) return t;
      }

      // 3. Gemini (CamelCase + SnakeCase Support)
      const parts = data?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        const t = parts.map(p => p?.text || "").join("").trim();
        if (t) return t;
      }
      
      // 4. PaLM / Legacy
      if (typeof data?.output_text === "string") return data.output_text.trim();
    } catch {}
    return "";
  }
  function apiConfig() {
    const type = normalizeApiType(getArg("translator_api_type", API_TYPE));
    const url  = getArg("translator_api_url", API_URL);
    const key  = getArg("translator_api_key", API_KEY);
    const model= getArg("translator_model", MODEL);
    
    const temp = getFloat("translator_temp", 0);
    const maxTokens = getInt("translator_max_tokens", 0);

    return { type, url, key, model, temp, maxTokens };
  }

  async function translateWith(systemPrompt, text, fullPromptOverride = null) {
    const { type, url, key, model, temp, maxTokens } = apiConfig();
    if (!key || !url || !model || !type) {
      return { ok:false, status:400, data:{ error:{ message: "설정(API Key/URL/Model)이 누락되었습니다." } } };
    }

    let messages = [];
    if (fullPromptOverride) {
      if (fullPromptOverride.includes("<|im_start|>")) {
        messages = parseChatMLToMessages(fullPromptOverride);
      } else {
        messages = [{ role: "user", content: fullPromptOverride }];
      }
    } else {
      messages = [{ role:"system", content: systemPrompt }, { role:"user", content: text }];
    }

    try {
      if (type === "openai") return await callOpenAI(url, key, model, messages, temp, maxTokens);
      if (type === "anthropic") return await callAnthropic(url, key, model, messages, temp, maxTokens);
      if (type === "gemini") return await callGemini(url, key, model, messages, temp, maxTokens);
      return { ok:false, status:400, data:{ error:{ message:`Unsupported translator type: ${type}` } } };
    } catch (e) {
      return { ok:false, status:0, data:{ error:{ message: e?.message || "Network error" } } };
    }
  }

  async function translate(text) {
    let sys = getArg("system_prompt", "");
    const notes = getArg("translator_notes", "");

    if (!sys) sys = defaultSystemPrompt;

    if (sys.includes("{{solt::content}}")) {
      const noteContent = notes ? `\nTranslator's Notes:\n${notes}` : "";
      let finalPrompt = sys.replace("{{slot::tnote}}", noteContent);
      finalPrompt = finalPrompt.replace("{{solt::content}}", text);
      return await translateWith(null, null, finalPrompt);
    } else {
      const sysPrompt = buildSystemPromptLegacy(sys, notes);
      return await translateWith(sysPrompt, text);
    }
  }

  function estimateTokens(str) {
    if (!str) return 0;
    const s = String(str);
    const koLike = (s.match(/[\u3131-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/g) || []).length;
    const len = s.length;
    const enLike = len - koLike;
    return Math.ceil(koLike/2.2 + enLike/4.0);
  }
  function metricsHtml(text) {
    const chars = (text || "").length;
    const toks  = estimateTokens(text || "");
    let cls = "";
    if (toks > 6000) cls = "danger";
    else if (toks > 3000) cls = "warn";
    return `<div class="rit-metrics"><div>chars: ${chars.toLocaleString()}</div><div class="${cls}">~tokens: ${toks.toLocaleString()}</div></div>`;
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    if (busy) { btn.dataset.orgText = btn.dataset.orgText || btn.textContent; btn.classList.add("busy");
      btn.innerHTML = `<span class="spin" aria-hidden="true"></span><span>번역 중…</span>`; btn.setAttribute("aria-busy","true"); btn.disabled = true;
    } else { btn.classList.remove("busy"); const txt = btn.dataset.orgText || "번역"; btn.textContent = txt; btn.removeAttribute("aria-busy"); btn.disabled = false; }
  }
  function flashDone(btn) { if (!btn) return; const prev = btn.textContent; btn.textContent = "완료"; setTimeout(()=>{ try{ btn.textContent = btn.dataset.orgText || prev || "번역"; }catch{} }, 900); }

  function ensureButtonsAndPanel() {
    const composer = pickMainComposer();
    const allExisting = Array.from(document.querySelectorAll(".rit-translate-btn, .rit-gear-btn, .rit-panel-wrap"));
    allExisting.forEach(n => { if (!composer || !composer.contains(n)) n.remove(); });
    if (!composer) return null;

    const sendBtn = findSendButton(composer);
    if (!sendBtn) return null;

    let t = composer.querySelector(".rit-translate-btn");
    if (!t) {
      t = document.createElement("button");
      t.type = "button"; t.className = "rit-translate-btn"; t.textContent = "번역";
      try { sendBtn.parentElement.insertBefore(t, sendBtn); } catch { composer.appendChild(t); }
      t.addEventListener("click", async (e) => {
        e.preventDefault(); e.stopPropagation();
        const live = getLiveInput(composer) || {}; const inputEl = live.el || null; const kind = live.kind || "unknown";
        if (!inputEl) { nudge(t); showToast(composer, "warn", "입력칸을 찾지 못했습니다."); return; }
        const raw = getText(inputEl, kind);
        if (!raw || !raw.trim()) { nudge(t); showToast(composer, "warn", "번역할 내용이 없습니다."); return; }
        if (ONLY_KO && !hasHangul(raw)) { nudge(t); showToast(composer, "warn", "한글이 없어 번역을 생략했습니다."); return; }
        setBusy(t, true);
        const res = await translate(raw);
        if (!res?.ok) { setBusy(t,false); const status = res?.status ?? 0; const msg = res?.data?.error?.message || res?.data?.error || "요청 실패";
          nudge(t); showToast(composer, "error", `번역 실패 <span class="code">HTTP ${status}</span><br>${String(msg).replace(/[&<>"]/g, s=>({ '&':'&amp;','<':'&gt;','>':'&gt;','"':'&quot;' }[s]))}`); return; }
        let en = pickText(res.data);
        if (!en) { setBusy(t,false); nudge(t); showToast(composer,"error","응답에서 텍스트를 추출하지 못했습니다."); return; }
        if (PRESERVE_QUOTES) {
          const pairs={'"':'"','“':'”','‘':'’','「':'」','『':'』','《':'》','〈':'〉','`':'`','‚':'‚'};
          const s=raw.trim(), o=en.trim(); const f=s[0], l=s[s.length-1];
          if (pairs[f] && l===pairs[f] && !(o.startsWith(f)&&o.endsWith(pairs[f]))) en = `${f}${o}${pairs[f]}`;
        }
        setText(inputEl, kind, en);
        setBusy(t,false); flashDone(t); showToast(composer,"ok","번역 완료");
      }, { capture:true, passive:false });
    }

    let g = composer.querySelector(".rit-gear-btn");
    if (!g) {
      g = document.createElement("button");
      g.type = "button"; g.className = "rit-gear-btn"; g.textContent = "⚙️";
      try { sendBtn.parentElement.insertBefore(g, t); } catch { composer.appendChild(g); }
      g.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggleSettingsPanel(composer); }, { capture:true, passive:false });
    }
    return composer;
  }

  function toggleSettingsPanel(composer) {
    let wrap = composer.querySelector('.rit-panel-wrap[data-kind="settings"]');
    if (wrap) { wrap.remove(); return; }

    wrap = document.createElement("div");
    wrap.className = "rit-panel-wrap";
    wrap.dataset.kind = "settings";
    const panel = document.createElement("div");
    panel.className = "rit-panel";

    const curSys   = getArg("system_prompt", "");
    const curNotes = getArg("translator_notes", "");
    const curType  = getArg("translator_api_type", "openai");
    const curURL   = getArg("translator_api_url", "https://api.openai.com/v1/chat/completions");
    const curKey   = getArg("translator_api_key", "");
    const curModel = getArg("translator_model", "gpt-4o-mini");
    
    // 생성 설정
    const curTemp     = getFloat("translator_temp", 0);
    const curMaxTok   = getInt("translator_max_tokens", 0);
    
    const sysDisplay = curSys || defaultSystemPrompt;

    panel.innerHTML = `
      <h4>설정</h4>
      <div class="rit-tabs-row">
        <div class="rit-tabs">
          <button class="rit-tab active" data-tab="settings">번역 설정</button>
          <button class="rit-tab" data-tab="preview">미리보기</button>
          <button class="rit-tab" data-tab="api">API 설정</button>
          <button class="rit-tab" data-tab="gen">생성 설정</button>
        </div>
      </div>

      <div class="rit-section active" data-sec="settings">
        <div class="rit-field">
          <label>번역 프롬프트 템플릿 (ChatML 지원)</label>
          <div class="rit-inline-caption" style="margin-bottom:4px">
            ChatML 태그(&lt;|im_start|&gt;...) 사용 시 자동으로 파싱하여 전송합니다.<br>
            GEMINI 사용 시 System role 자동으로 user로 치환<br>
            Risu 번역 프롬프트 호환
          </div>
          <textarea class="rit-sys" placeholder="비우면 기본 ChatML 템플릿 사용" style="min-height:110px;font-family:monospace;white-space:pre">${esc(sysDisplay)}</textarea>
          <div class="rit-sys-metrics rit-inline-caption">${metricsHtml(sysDisplay)}</div>
        </div>
        <div class="rit-field">
          <label>번역가의 노트 (Translator Notes)</label>
          <textarea class="rit-notes" placeholder="용어집/스타일/금칙 등">${esc(curNotes)}</textarea>
          <div class="rit-notes-metrics rit-inline-caption">${metricsHtml(curNotes)}</div>
        </div>
        <div class="rit-row">
          <button class="rit-btn" data-act="close">닫기</button>
          <button class="rit-btn primary" data-act="save">저장</button>
        </div>
      </div>

      <div class="rit-section" data-sec="preview">
        <div class="rit-field">
          <label>미리보기 입력 (한글)</label>
          <textarea class="rit-preview-in" placeholder="샘플 한국어 문장"></textarea>
        </div>
        <div class="rit-field">
          <div class="rit-label-row">
            <label>미리보기 결과 (영문)</label>
            <button class="rit-copy-btn" type="button" title="복사" aria-label="미리보기 결과 복사">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
          <div class="rit-preview-out" aria-live="polite"></div>
        </div>
        <div class="rit-row">
          <button class="rit-btn" data-act="close2">닫기</button>
          <button class="rit-btn primary" data-act="preview">미리보기</button>
        </div>
      </div>

      <div class="rit-section" data-sec="api">
        <div class="rit-field">
          <label>API 타입</label>
          <input class="rit-type" placeholder="openai, gemini, anthropic..." value="${esc(curType)}">
        </div>
        <div class="rit-field">
          <label>API URL</label>
          <input class="rit-url" placeholder="https://api.openai.com/v1/chat/completions" value="${esc(curURL)}">
        </div>
        <div class="rit-field">
          <label>API Key</label>
          <div class="rit-passwrap">
            <input class="rit-key" type="password" placeholder="sk-..." value="${esc(curKey)}">
            <button class="rit-key-toggle" type="button">표시</button>
          </div>
        </div>
        <div class="rit-field">
          <label>모델명</label>
          <input class="rit-model" placeholder="gpt-4o-mini" value="${esc(curModel)}">
        </div>
        <div class="rit-row">
          <button class="rit-btn" data-act="close3">닫기</button>
          <button class="rit-btn primary" data-act="saveApi">저장</button>
        </div>
      </div>

      <div class="rit-section" data-sec="gen">
        <div class="rit-field">
          <label>온도 (Temperature) <span id="rit-temp-disp" style="color:#93c5fd;font-weight:bold">${curTemp}</span></label>
          <div class="rit-passwrap">
            <input type="range" class="rit-temp-range" min="0" max="2" step="0.1" value="${curTemp}" style="flex:2">
            <input type="number" class="rit-temp-input" min="0" max="2" step="0.1" value="${curTemp}" style="width:70px;text-align:center">
          </div>
          <div class="rit-inline-caption">0.0(정확) ~ 2.0(창의적). 기본값: 0</div>
        </div>
        <div class="rit-field">
          <label>최대 토큰 (Max Tokens)</label>
          <input type="number" class="rit-max-tokens" placeholder="예: 4096, 0=자동/기본값" value="${curMaxTok > 0 ? curMaxTok : ''}">
          <div class="rit-inline-caption">0 입력 시 API 기본값 사용 (Claude는 자동 4096 적용)</div>
        </div>
        <div class="rit-row">
          <button class="rit-btn" data-act="close4">닫기</button>
          <button class="rit-btn primary" data-act="saveGen">저장</button>
        </div>
      </div>
    `;
    wrap.appendChild(panel);

    const cs = getComputedStyle(composer);
    if (cs.position === "static") composer.style.position = "relative";
    composer.appendChild(wrap);

    const tabs = panel.querySelectorAll(".rit-tab");
    function activate(tabName){
      tabs.forEach(tb => tb.classList.toggle("active", tb.dataset.tab===tabName));
      panel.querySelectorAll(".rit-section").forEach(sec => sec.classList.toggle("active", sec.dataset.sec===tabName));
    }
    tabs.forEach(tb => tb.addEventListener("click", (e)=>{ e.preventDefault(); activate(tb.dataset.tab); }));

    // Ref existing
    const sysEl   = panel.querySelector(".rit-sys");
    const notesEl = panel.querySelector(".rit-notes");
    const sysMet  = panel.querySelector(".rit-sys-metrics");
    const notesMet= panel.querySelector(".rit-notes-metrics");
    const pvIn    = panel.querySelector(".rit-preview-in");
    const pvOut   = panel.querySelector(".rit-preview-out");

    const typeEl  = panel.querySelector(".rit-type");
    const urlEl   = panel.querySelector(".rit-url");
    const keyEl   = panel.querySelector(".rit-key");
    const keyTgl  = panel.querySelector(".rit-key-toggle");
    const modelEl = panel.querySelector(".rit-model");

    // Ref new
    const tempRange = panel.querySelector(".rit-temp-range");
    const tempInput = panel.querySelector(".rit-temp-input");
    const tempDisp  = panel.querySelector("#rit-temp-disp");
    const maxTokIn  = panel.querySelector(".rit-max-tokens");

    // Sync Temp
    const syncTemp = (val) => {
      tempRange.value = val;
      tempInput.value = val;
      tempDisp.textContent = val;
    };
    tempRange.addEventListener("input", (e)=> syncTemp(e.target.value));
    tempInput.addEventListener("input", (e)=> syncTemp(e.target.value));

    const updateMetrics = ()=>{ sysMet.innerHTML = metricsHtml(sysEl.value); notesMet.innerHTML = metricsHtml(notesEl.value); };
    sysEl.addEventListener("input", updateMetrics);
    notesEl.addEventListener("input", updateMetrics);

    keyTgl?.addEventListener("click", (e)=> {
      e.preventDefault();
      const isPw = keyEl.type === "password";
      keyEl.type = isPw ? "text" : "password";
      keyTgl.textContent = isPw ? "숨기기" : "표시";
    });

    const liveInput = (getLiveInput(composer) || {}).el;
    const liveSample = liveInput ? (liveInput.value || liveInput.innerText || liveInput.textContent || "") : "";
    pvIn.value = (liveSample?.trim() ? liveSample : "이 문장은 미리보기 탭에서 테스트하기 위한 샘플입니다.");

    const closePanel = () => { try { wrap.remove(); } catch {} };
    panel.querySelector('[data-act="close"]').addEventListener("click", (e)=> { e.preventDefault(); closePanel(); });
    panel.querySelector('[data-act="close2"]').addEventListener("click", (e)=> { e.preventDefault(); closePanel(); });
    panel.querySelector('[data-act="close3"]').addEventListener("click", (e)=> { e.preventDefault(); closePanel(); });
    panel.querySelector('[data-act="close4"]').addEventListener("click", (e)=> { e.preventDefault(); closePanel(); });

    // Save Handlers
    panel.querySelector('[data-act="save"]').addEventListener("click", (e)=> {
      e.preventDefault();
      setArg("system_prompt",  sysEl.value);
      setArg("translator_notes", notesEl.value);
      showToast(composer, "ok", "설정 저장됨", 2200);
    });
    panel.querySelector('[data-act="saveApi"]').addEventListener("click", (e)=> {
      e.preventDefault();
      setArg("translator_api_type",  typeEl.value);
      setArg("translator_api_url",   urlEl.value);
      setArg("translator_api_key",   keyEl.value);
      setArg("translator_model",     modelEl.value);
      showToast(composer, "ok", "API 설정 저장됨", 2200);
    });
    panel.querySelector('[data-act="saveGen"]').addEventListener("click", (e)=> {
      e.preventDefault();
      setArg("translator_temp",  tempInput.value);
      setArg("translator_max_tokens", maxTokIn.value);
      showToast(composer, "ok", "생성 설정 저장됨", 2200);
    });

    panel.querySelector('[data-act="preview"]').addEventListener("click", async (e)=> {
      e.preventDefault();
      const btn = e.currentTarget;
      const src = String(pvIn.value || "").trim();
      if (!src) { nudge(btn); showToast(composer, "warn", "미리보기 입력이 비어 있습니다."); return; }
      
      btn.disabled = true; const prevTxt = btn.textContent; btn.textContent = "미리보기 중…";
      const res = await translate(src);
      
      if (!res?.ok) {
        btn.disabled=false; btn.textContent = prevTxt;
        const status = res?.status ?? 0;
        const msg = res?.data?.error?.message || res?.data?.error || "요청 실패";
        nudge(btn); showToast(composer, "error", `미리보기 실패 <span class="code">HTTP ${status}</span><br>${String(msg).replace(/[&<>"]/g, s=>({ '&':'&amp;','<':'&gt;','>':'&gt;','"':'&quot;' }[s]))}`);
        return;
      }
      const en = pickText(res.data);
      if (!en) { btn.disabled=false; btn.textContent=prevTxt; nudge(btn); showToast(composer,"error","미리보기 응답에서 텍스트 추출 실패"); return; }
      pvOut.textContent = en;
      btn.disabled=false; btn.textContent = prevTxt;
      showToast(composer, "ok", "미리보기 완료", 1600);
    });

    const copyBtn = panel.querySelector(".rit-copy-btn");
    copyBtn?.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const text = String(pvOut?.textContent || "").trim();
      if (!text) { nudge(copyBtn); showToast(composer, "warn", "복사할 미리보기 결과가 없습니다."); return; }
      const ok = await copyText(text, composer);
      if (ok) showToast(composer, "ok", "복사됨", 1600);
      else { nudge(copyBtn); showToast(composer, "error", "복사 실패", 2600); }
    });
  }

  try {
    function ensure(){ ensureButtonsAndPanel(); }
    ensure();
    const obs = new MutationObserver(ensure);
    obs.observe(document.body, { childList:true, subtree:true });
    apis.onUnload && apis.onUnload(() => obs.disconnect());
    console.info("[RisuInputTranslator] loaded v2.1.1");
  } catch (e) { console.error("[RisuInputTranslator] load error", e); }
})();