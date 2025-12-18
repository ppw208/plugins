// ===== inputrans - 인풋 번역기 =====
//@name inputrans
//@display-name 📝 입력 번역기
//@version 3.0.0
//@description 입력창의 텍스트를 번역합니다. (RisuInputTranslator 기반 개조)

// ---- 토글/옵션 ----
//@arg enable_plugin int 1 "플러그인 활성화 (1=ON)"
//@arg only_if_korean int 0 "한글 포함시에만 번역"
//@arg preserve_quotes int 1 "따옴표/백틱 감싸임 보존"
//@arg debug int 0 "디버그 로그"
//@arg show_errors int 1 "오류/안내 토스트"

// ---- API 기본 설정 ----
//@arg translator_api_type string openai "API 타입 (openai/anthropic/gemini)"
//@arg translator_api_url string https://api.openai.com/v1/chat/completions "API URL"
//@arg translator_api_key string "" "API Key"
//@arg translator_model string gpt-4.1-2025-04-14 "모델명"

// ---- 생성 설정 ----
//@arg translator_temp string 0.7 "온도 (Temperature, 0~2)"
//@arg translator_max_tokens int 4096 "최대 토큰"
//@arg translator_top_p string 1.0 "Top P (0~1)"
//@arg translator_freq_penalty string 0.0 "빈도 패널티 (0~2)"
//@arg translator_pres_penalty string 0.0 "존재 패널티 (0~2)"

// ---- 번역 프롬프트 ----
//@arg system_prompt string "" "번역 프롬프트 (ChatML 형식, {{slot::content}} 사용)"
//@arg translator_notes string "" "번역가의 노트 ({{slot::tnote}}로 삽입)"

console.info("[InputTrans] boot start (v3.0.0)");

; (() => {
    "use strict";

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
    } catch (e) { console.error("[InputTrans] polyfill error", e); }

    const PLUGIN_NAME = "inputrans";
    const DISPLAY_NAME = "📝 입력 번역기";
    const apis = globalThis.__pluginApis__ || {};
    const risuFetch = apis.risuFetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);

    // ----- 모델 정의 (LBI 기반) -----
    const MODEL_PRESETS = {
        openai: [
            { id: 'gpt-4.1-2025-04-14', name: 'GPT-4.1' },
            { id: 'gpt-5-2025-08-07', name: 'GPT-5' },
            { id: 'gpt-5-mini-2025-08-07', name: 'GPT-5 Mini' },
            { id: 'gpt-5-nano-2025-08-07', name: 'GPT-5 Nano' },
            { id: 'gpt-5.1-2025-11-13', name: 'GPT-5.1' },
            { id: 'chatgpt-4o-latest', name: 'ChatGPT-4o Latest' },
        ],
        anthropic: [
            { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet' },
            { id: 'claude-sonnet-4-20250514', name: 'Claude 4 Sonnet' },
            { id: 'claude-sonnet-4-5-20250929', name: 'Claude 4.5 Sonnet' },
            { id: 'claude-haiku-4-5-20251001', name: 'Claude 4.5 Haiku' },
            { id: 'claude-opus-4-20250514', name: 'Claude 4 Opus' },
            { id: 'claude-opus-4-1-20250805', name: 'Claude 4.1 Opus' },
        ],
        gemini: [
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
            { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash Exp (Free)' },
        ],
    };

    // ----- robust getters -----
    function _readFromParams(key) {
        try {
            const p = globalThis.__pluginParams__ || {};
            const args = p.args || p || {};
            return args[key];
        } catch { return undefined; }
    }
    function _lsKey(k) { return `inputrans_${k}`; }

    function getArgRaw(key) {
        try {
            const fn = apis.getArg;
            if (fn) {
                let v = fn(key); if (v !== undefined) return v;
                v = fn(`${PLUGIN_NAME}::${key}`); if (v !== undefined) return v;
                v = fn(`${DISPLAY_NAME}::${key}`); if (v !== undefined) return v;
            }
        } catch { }
        const pv = _readFromParams(key);
        if (pv !== undefined && pv !== null) return pv;
        try {
            const lv = localStorage.getItem(_lsKey(key));
            if (lv !== null) return lv;
        } catch { }
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
        } catch { }
        try { localStorage.setItem(_lsKey(key), String(val ?? "")); } catch { }
    }

    function getInt(key, defVal = 0) {
        const n = Number(getArg(key, String(defVal)));
        return Number.isFinite(n) ? Math.floor(n) : defVal;
    }

    function getFloat(key, defVal = 0.0) {
        const n = Number(getArg(key, String(defVal)));
        return Number.isFinite(n) ? n : defVal;
    }

    // ----- 설정값 읽기 -----
    const ENABLED = getInt("enable_plugin", 1) === 1;
    const ONLY_KO = getInt("only_if_korean", 0) === 1;
    const PRESERVE_QUOTES = getInt("preserve_quotes", 1) === 1;
    const DEBUG = getInt("debug", 0) === 1;
    const SHOW_ERR = getInt("show_errors", 1) === 1;

    if (!ENABLED) { console.info("[InputTrans] disabled by setting"); return; }
    if (!risuFetch) { console.error("[InputTrans] risuFetch/fetch not available"); return; }

    function normalizeApiType(s) {
        const v = String(s || "").trim().toLowerCase();
        const map = {
            "openai": "openai", "openai-compatible": "openai", "openrouter": "openai", "deepseek": "openai", "groq": "openai",
            "anthropic": "anthropic", "claude": "anthropic",
            "gemini": "gemini", "google": "gemini", "google-ai": "gemini", "googleai": "gemini"
        };
        return map[v] || (v.includes("open") ? "openai" : v.includes("claude") ? "anthropic" : (v.includes("gemini") || v.includes("google")) ? "gemini" : "openai");
    }

    // ===== 스타일 =====
    const style = document.createElement("style");
    style.textContent = `
    .it-translate-btn{padding:5px 9px;border:1px solid #3b82f6;border-radius:8px;background:#1e293b;color:#e5e7eb;font-size:12px;line-height:1;margin-right:6px;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
    .it-translate-btn.busy{opacity:.65;cursor:wait;pointer-events:none}
    .it-translate-btn .spin{width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:it-spin .8s linear infinite}
    @keyframes it-spin{to{transform:rotate(360deg)}}
    .it-gear-btn{padding:5px 7px;border:1px solid #475569;border-radius:8px;background:#0f172a;color:#cbd5e1;display:inline-flex;align-items:center;line-height:1;font-size:14px;cursor:pointer}
    .it-gear-btn:hover{background:#111827}
    .it-shake{animation:it-shake .24s linear 1}
    @keyframes it-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-2px)}75%{transform:translateX(2px)}}
    .it-toast-wrap{position:absolute;right:6px;bottom:6px;display:flex;flex-direction:column;gap:6px;z-index:2147483647}
    .it-toast{padding:7px 9px;border-radius:8px;font-size:12px;color:#e5e7eb;box-shadow:0 4px 12px rgba(0,0,0,.25);max-width:340px;line-height:1.35}
    .it-toast.error{background:#7f1d1d;border:1px solid #ef4444}
    .it-toast.warn{background:#5b470a;border:1px solid #eab308}
    .it-toast.ok{background:#0b3d2e;border:1px solid #22c55e}
    .it-toast .code{font-family:ui-monospace,Menlo,Consolas,monospace;background:rgba(0,0,0,.2);padding:1px 4px;border-radius:4px}

    .it-panel-wrap{position:absolute;right:6px;bottom:48px;z-index:2147483647;max-height:80vh;overflow-y:auto}
    .it-panel{position:relative;width:min(520px,92vw);background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.35);padding:12px}
    .it-panel h4{margin:0 0 8px 0;font-size:14px;color:#cbd5e1;border-bottom:1px solid #334155;padding-bottom:8px}
    .it-tabs-row{display:flex;align-items:center;gap:6px;margin-bottom:8px}
    .it-tabs{display:flex;gap:6px;flex-wrap:wrap}
    .it-tab{padding:5px 10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#cbd5e1;font-size:12px;cursor:pointer}
    .it-tab.active{border-color:#3b82f6;background:#1e293b;color:#e5e7eb}

    .it-section{display:none}
    .it-section.active{display:block}
    .it-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
    .it-field label{font-size:11.5px;color:#94a3b8}
    .it-field input,.it-field textarea,.it-field select{width:100%;min-height:34px;background:#0a0f1a;color:#e5e7eb;border:1px solid #334155;border-radius:8px;padding:6px 8px;font-size:12px;box-sizing:border-box}
    .it-field textarea{min-height:100px;resize:vertical;font-family:ui-monospace,Menlo,Consolas,monospace;white-space:pre}
    .it-field select{cursor:pointer}
    .it-row{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px}
    .it-btn{padding:6px 12px;border-radius:8px;font-size:12px;border:1px solid #475569;background:#111827;color:#e5e7eb;cursor:pointer}
    .it-btn.primary{border-color:#3b82f6;background:#1e293b}
    .it-btn.secondary{border-color:#6b7280;background:#374151}
    .it-inline-caption{font-size:10.5px;color:#9ca3af;margin-top:2px}
    .it-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .it-passwrap{display:flex;gap:6px}
    .it-passwrap input{flex:1}
    .it-passwrap button{padding:5px 8px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#cbd5e1;cursor:pointer}
    .it-preview-out{min-height:80px;white-space:pre-wrap;background:#0a0f1a;border:1px solid #334155;border-radius:8px;padding:8px;font-size:12px}
    .it-copy-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;border:1px solid #334155;background:#0f172a;color:#cbd5e1;cursor:pointer}
    .it-copy-btn:hover{background:#111827}
    .it-copy-btn svg{width:14px;height:14px;display:block}
    .it-label-row{display:flex;align-items:center;justify-content:space-between;gap:6px}
  `;
    document.head.appendChild(style);

    // ---- 유틸리티 ----
    const qa = (sel, root = document) => { try { return sel ? Array.from(root.querySelectorAll(sel)) : []; } catch { return []; } };
    const q1 = (sel, root = document) => { try { return sel ? root.querySelector(sel) : null; } catch { return null; } };
    const vis = el => !!(el && el.offsetParent !== null);
    const hasHangul = (s) => /[ㄱ-ㅎ가-힣]/.test(s || "");
    const isEditable = el => !!el && (el.tagName?.toLowerCase() === "textarea" || el.isContentEditable || el.getAttribute?.("contenteditable") === "true");
    const kindOf = el => el?.tagName?.toLowerCase() === "textarea" ? "textarea" : (el?.isContentEditable ? "editable" : "unknown");
    const getText = (el, k) => k === "textarea" ? String(el.value ?? "") : k === "editable" ? String(el.innerText ?? el.textContent ?? "") : "";
    const setText = (el, k, val) => {
        if (!el) return;
        if (k === "textarea") el.value = val;
        else if (k === "editable") el.innerText = val;
        else { try { el.value = val; } catch { } try { el.innerText = val; } catch { } }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    function nudge(el) { try { el.classList.remove("it-shake"); void el.offsetWidth; el.classList.add("it-shake"); setTimeout(() => el.classList.remove("it-shake"), 240); } catch { } }
    const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function ensureToastWrap(scope) {
        const host = scope || document.body;
        let wrap = host.querySelector(".it-toast-wrap");
        if (!wrap) {
            wrap = document.createElement("div");
            wrap.className = "it-toast-wrap";
            const cs = getComputedStyle(host);
            if (cs.position === "static") host.style.position = "relative";
            host.appendChild(wrap);
        }
        return wrap;
    }

    function showToast(scope, type, msg, timeoutMs = 3800) {
        if (!SHOW_ERR) return;
        const wrap = ensureToastWrap(scope);
        const t = document.createElement("div");
        t.className = `it-toast ${type}`;
        t.innerHTML = msg;
        wrap.appendChild(t);
        setTimeout(() => { try { t.remove(); } catch { } }, timeoutMs);
        return t;
    }

    async function copyText(text, scope) {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch { }
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed"; ta.style.left = "-9999px";
            (scope || document.body).appendChild(ta);
            ta.focus(); ta.select();
            const ok = document.execCommand("copy");
            ta.remove();
            return !!ok;
        } catch { return false; }
    }

    // ===== Composer 탐색 =====
    function composerCandidates() {
        const sendBtns = qa('button[type="submit"], button.button-icon-send').filter(vis);
        const compos = new Set();
        for (const b of sendBtns) {
            let cur = b;
            for (let i = 0; cur && i < 6; i++, cur = cur.parentElement) {
                const hasSend = cur.querySelector?.('button[type="submit"], button.button-icon-send');
                const hasChatTa = cur.querySelector?.('textarea.text-input-area, textarea.input-text, textarea');
                if (hasSend && hasChatTa) { compos.add(cur); break; }
            }
        }
        return Array.from(compos);
    }

    function pickMainComposer() {
        const cands = composerCandidates();
        if (cands.length === 0) return null;
        const scored = cands.map(c => ({ c, rect: c.getBoundingClientRect() })).filter(o => o.rect && isFinite(o.rect.top));
        if (scored.length === 0) return cands[0];
        scored.sort((a, b) => a.rect.top - b.rect.top);
        return scored[scored.length - 1].c;
    }

    function inputsIn(comp) { return qa('textarea.text-input-area, textarea.input-text, textarea, [contenteditable="true"]', comp); }

    function getLiveInput(comp) {
        const ae = document.activeElement;
        if (isEditable(ae) && comp?.contains?.(ae)) return { el: ae, kind: kindOf(ae) };
        const list = inputsIn(comp).filter(vis);
        const last = list[list.length - 1];
        return last ? { el: last, kind: kindOf(last) } : null;
    }

    function findSendButton(comp) {
        if (!comp) return null;
        let btn = q1('button[type="submit"]', comp); if (btn) return btn;
        btn = q1('button.button-icon-send', comp); if (btn) return btn;
        return null;
    }

    // ===== ChatML 파싱 =====
    const defaultSystemPrompt = `<|im_start|>system
You are a professional translator. Translate the user's Korean input into natural, context-appropriate ENGLISH.
Preserve ALL punctuation exactly, including any leading/trailing quotation marks and backticks.
Return ONLY the translated text; no commentary, labels, or extra quotes.
{{slot::tnote}}<|im_end|>
<|im_start|>user
{{slot::content}}<|im_end|>`;

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

    // ===== HTTP 헬퍼 =====
    function normUrl(u) { return String(u || "").replace(/\/+$/, ""); }

    async function postJSONWithFallback(endpoint, headersBase, payload) {
        const variants = [
            { key: "json-key", init: { method: "POST", headers: { ...headersBase, "Accept": "application/json" }, json: payload } },
            { key: "stringified-body", init: { method: "POST", headers: { ...headersBase, "Content-Type": "application/json" }, body: JSON.stringify(payload) } },
        ];
        let last = null;
        for (const v of variants) {
            const res = await risuFetch(endpoint, v.init);
            last = res;
            if (res?.ok) { if (DEBUG) console.log("[InputTrans] http ok via", v.key); return res; }
        }
        return last;
    }

    // ===== API 호출 =====
    async function callOpenAI(url, key, model, messages, temp, maxTokens, topP, freqPen, presPen) {
        const base = normUrl(url);
        const endpoint = /chat\/completions$/.test(base) ? base
            : /\/v1$/.test(base) ? base + "/chat/completions"
                : base.includes("/v1/chat/completions") ? base
                    : base + "/v1/chat/completions";

        const payload = { model, messages, temperature: temp, stop: ["<|im_end|>"] };
        if (maxTokens > 0) payload.max_tokens = maxTokens;
        if (topP < 1.0) payload.top_p = topP;
        if (freqPen > 0) payload.frequency_penalty = freqPen;
        if (presPen > 0) payload.presence_penalty = presPen;

        const headers = { "Authorization": `Bearer ${key}` };
        return await postJSONWithFallback(endpoint, headers, payload);
    }

    async function callAnthropic(url, key, model, messages, temp, maxTokens, topP) {
        const base = normUrl(url);
        const endpoint = /\/v1\/messages$/.test(base) ? base : base.endsWith("/v1") ? base + "/messages" : base + "/v1/messages";

        const sysMsg = messages.find(m => m.role === "system")?.content || "";
        const msg = messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: [{ type: "text", text: m.content }] }));

        const tokens = maxTokens > 0 ? maxTokens : 4096;
        const payload = { model, system: sysMsg || undefined, messages: msg, max_tokens: tokens, temperature: temp };
        if (topP < 1.0) payload.top_p = topP;

        return await postJSONWithFallback(endpoint, { "x-api-key": key, "anthropic-version": "2023-06-01" }, payload);
    }

    async function callGemini(url, key, model, messages, temp, maxTokens, topP) {
        // Role 변환: system/user -> user, assistant -> model
        const converted = messages.map(m => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
        }));

        // 연속 동일 role 병합
        const finalContents = [];
        if (converted.length > 0) {
            let last = { ...converted[0], parts: [{ text: converted[0].parts[0].text }] };
            for (let i = 1; i < converted.length; i++) {
                const curr = converted[i];
                if (last.role === curr.role) {
                    last.parts[0].text += "\n\n" + curr.parts[0].text;
                } else {
                    finalContents.push(last);
                    last = { ...curr, parts: [{ text: curr.parts[0].text }] };
                }
            }
            finalContents.push(last);
        }

        const payload = {
            contents: finalContents,
            generationConfig: { temperature: temp }
        };
        if (maxTokens > 0) payload.generationConfig.maxOutputTokens = maxTokens;
        if (topP < 1.0) payload.generationConfig.topP = topP;

        payload.safetySettings = [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
            { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "OFF" }
        ];

        const host = normUrl(url || "https://generativelanguage.googleapis.com");
        const endpoint = `${host}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
        return await postJSONWithFallback(endpoint, {}, payload);
    }

    function pickText(data) {
        try {
            // OpenAI
            if (data?.choices?.length) {
                const c0 = data.choices[0];
                if (c0?.message?.content) return String(c0.message.content).trim();
                if (typeof c0?.text === "string") return c0.text.trim();
            }
            // Anthropic
            if (Array.isArray(data?.content)) {
                const t = data.content.filter(p => p?.type === "text").map(p => p.text).join("").trim();
                if (t) return t;
            }
            // Gemini
            const parts = data?.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
                const t = parts.map(p => p?.text || "").join("").trim();
                if (t) return t;
            }
        } catch { }
        return "";
    }

    function apiConfig() {
        return {
            type: normalizeApiType(getArg("translator_api_type", "openai")),
            url: getArg("translator_api_url", "https://api.openai.com/v1/chat/completions"),
            key: getArg("translator_api_key", ""),
            model: getArg("translator_model", "gpt-4.1-2025-04-14"),
            temp: getFloat("translator_temp", 0.7),
            maxTokens: getInt("translator_max_tokens", 4096),
            topP: getFloat("translator_top_p", 1.0),
            freqPen: getFloat("translator_freq_penalty", 0.0),
            presPen: getFloat("translator_pres_penalty", 0.0),
        };
    }

    async function translateWith(systemPrompt, text, fullPromptOverride = null) {
        const { type, url, key, model, temp, maxTokens, topP, freqPen, presPen } = apiConfig();
        if (!key || !url || !model || !type) {
            return { ok: false, status: 400, data: { error: { message: "설정(API Key/URL/Model)이 누락되었습니다." } } };
        }

        let messages = [];
        if (fullPromptOverride) {
            if (fullPromptOverride.includes("<|im_start|>")) {
                messages = parseChatMLToMessages(fullPromptOverride);
            } else {
                messages = [{ role: "user", content: fullPromptOverride }];
            }
        } else {
            messages = [{ role: "system", content: systemPrompt }, { role: "user", content: text }];
        }

        try {
            if (type === "openai") return await callOpenAI(url, key, model, messages, temp, maxTokens, topP, freqPen, presPen);
            if (type === "anthropic") return await callAnthropic(url, key, model, messages, temp, maxTokens, topP);
            if (type === "gemini") return await callGemini(url, key, model, messages, temp, maxTokens, topP);
            return { ok: false, status: 400, data: { error: { message: `Unsupported API type: ${type}` } } };
        } catch (e) {
            return { ok: false, status: 0, data: { error: { message: e?.message || "Network error" } } };
        }
    }

    async function translate(text) {
        let sys = getArg("system_prompt", "");
        const notes = getArg("translator_notes", "");

        if (!sys) sys = defaultSystemPrompt;

        if (sys.includes("{{slot::content}}")) {
            const noteContent = notes ? `\nTranslator's Notes:\n${notes}` : "";
            let finalPrompt = sys.replace("{{slot::tnote}}", noteContent);
            finalPrompt = finalPrompt.replace("{{slot::content}}", text);
            return await translateWith(null, null, finalPrompt);
        } else {
            const sysPrompt = buildSystemPromptLegacy(sys, notes);
            return await translateWith(sysPrompt, text);
        }
    }

    // ===== UI 버튼 =====
    function setBusy(btn, busy) {
        if (!btn) return;
        if (busy) {
            btn.dataset.orgText = btn.dataset.orgText || btn.textContent;
            btn.classList.add("busy");
            btn.innerHTML = `<span class="spin" aria-hidden="true"></span><span>번역 중…</span>`;
            btn.disabled = true;
        } else {
            btn.classList.remove("busy");
            btn.textContent = btn.dataset.orgText || "번역";
            btn.disabled = false;
        }
    }

    function flashDone(btn) {
        if (!btn) return;
        const prev = btn.textContent;
        btn.textContent = "완료!";
        setTimeout(() => { try { btn.textContent = btn.dataset.orgText || prev || "번역"; } catch { } }, 900);
    }

    function ensureButtonsAndPanel() {
        const composer = pickMainComposer();
        const allExisting = Array.from(document.querySelectorAll(".it-translate-btn, .it-gear-btn, .it-panel-wrap"));
        allExisting.forEach(n => { if (!composer || !composer.contains(n)) n.remove(); });
        if (!composer) return null;

        const sendBtn = findSendButton(composer);
        if (!sendBtn) return null;

        // 번역 버튼
        let t = composer.querySelector(".it-translate-btn");
        if (!t) {
            t = document.createElement("button");
            t.type = "button"; t.className = "it-translate-btn"; t.textContent = "번역";
            try { sendBtn.parentElement.insertBefore(t, sendBtn); } catch { composer.appendChild(t); }

            t.addEventListener("click", async (e) => {
                e.preventDefault(); e.stopPropagation();
                const live = getLiveInput(composer) || {};
                const inputEl = live.el || null;
                const kind = live.kind || "unknown";

                if (!inputEl) { nudge(t); showToast(composer, "warn", "입력칸을 찾지 못했습니다."); return; }
                const raw = getText(inputEl, kind);
                if (!raw || !raw.trim()) { nudge(t); showToast(composer, "warn", "번역할 내용이 없습니다."); return; }
                if (ONLY_KO && !hasHangul(raw)) { nudge(t); showToast(composer, "warn", "한글이 없어 번역을 생략했습니다."); return; }

                setBusy(t, true);
                const res = await translate(raw);

                if (!res?.ok) {
                    setBusy(t, false);
                    const status = res?.status ?? 0;
                    const msg = res?.data?.error?.message || res?.data?.error || "요청 실패";
                    nudge(t);
                    showToast(composer, "error", `번역 실패 <span class="code">HTTP ${status}</span><br>${esc(String(msg))}`);
                    return;
                }

                let en = pickText(res.data);
                if (!en) { setBusy(t, false); nudge(t); showToast(composer, "error", "응답에서 텍스트를 추출하지 못했습니다."); return; }

                if (PRESERVE_QUOTES) {
                    const pairs = { '"': '"', '"': '"', ''': ''', '「': '」', '『': '』', '《': '》', '〈': '〉', '`': '`' };
                    const s = raw.trim(), o = en.trim();
                    const f = s[0], l = s[s.length - 1];
                    if (pairs[f] && l === pairs[f] && !(o.startsWith(f) && o.endsWith(pairs[f]))) en = `${f}${o}${pairs[f]}`;
                }

                setText(inputEl, kind, en);
                setBusy(t, false);
                flashDone(t);
                showToast(composer, "ok", "번역 완료");
            }, { capture: true, passive: false });
        }

        // 설정 버튼
        let g = composer.querySelector(".it-gear-btn");
        if (!g) {
            g = document.createElement("button");
            g.type = "button"; g.className = "it-gear-btn"; g.textContent = "⚙️";
            try { sendBtn.parentElement.insertBefore(g, t); } catch { composer.appendChild(g); }
            g.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggleSettingsPanel(composer); }, { capture: true, passive: false });
        }

        return composer;
    }

    // ===== 설정 패널 =====
    function toggleSettingsPanel(composer) {
        let wrap = composer.querySelector('.it-panel-wrap[data-kind="settings"]');
        if (wrap) { wrap.remove(); return; }

        wrap = document.createElement("div");
        wrap.className = "it-panel-wrap";
        wrap.dataset.kind = "settings";
        const panel = document.createElement("div");
        panel.className = "it-panel";

        const curType = getArg("translator_api_type", "openai");
        const curURL = getArg("translator_api_url", "https://api.openai.com/v1/chat/completions");
        const curKey = getArg("translator_api_key", "");
        const curModel = getArg("translator_model", "gpt-4.1-2025-04-14");
        const curTemp = getFloat("translator_temp", 0.7);
        const curMaxTok = getInt("translator_max_tokens", 4096);
        const curTopP = getFloat("translator_top_p", 1.0);
        const curFreqPen = getFloat("translator_freq_penalty", 0.0);
        const curPresPen = getFloat("translator_pres_penalty", 0.0);
        const curSys = getArg("system_prompt", "");
        const curNotes = getArg("translator_notes", "");
        const sysDisplay = curSys || defaultSystemPrompt;

        // 모델 옵션 생성
        const apiType = normalizeApiType(curType);
        const models = MODEL_PRESETS[apiType] || MODEL_PRESETS.openai;
        const modelOptions = models.map(m => `<option value="${esc(m.id)}" ${m.id === curModel ? 'selected' : ''}>${esc(m.name)}</option>`).join('');

        panel.innerHTML = `
      <h4>⚙️ 입력 번역기 설정</h4>
      <div class="it-tabs-row">
        <div class="it-tabs">
          <button class="it-tab active" data-tab="api">API 설정</button>
          <button class="it-tab" data-tab="sampling">생성 설정</button>
          <button class="it-tab" data-tab="prompt">프롬프트</button>
          <button class="it-tab" data-tab="preview">미리보기</button>
        </div>
      </div>

      <!-- API 설정 탭 -->
      <div class="it-section active" data-sec="api">
        <div class="it-field">
          <label>API 타입</label>
          <select class="it-type">
            <option value="openai" ${curType === 'openai' ? 'selected' : ''}>OpenAI (호환)</option>
            <option value="anthropic" ${curType === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option>
            <option value="gemini" ${curType === 'gemini' ? 'selected' : ''}>Google (Gemini)</option>
          </select>
        </div>
        <div class="it-field">
          <label>API URL</label>
          <input class="it-url" placeholder="https://api.openai.com/v1/chat/completions" value="${esc(curURL)}">
        </div>
        <div class="it-field">
          <label>API Key</label>
          <div class="it-passwrap">
            <input class="it-key" type="password" placeholder="sk-..." value="${esc(curKey)}">
            <button class="it-key-toggle" type="button">표시</button>
          </div>
        </div>
        <div class="it-field">
          <label>모델</label>
          <select class="it-model">${modelOptions}</select>
          <div class="it-inline-caption">또는 직접 입력:</div>
          <input class="it-model-custom" placeholder="직접 모델명 입력" value="">
        </div>
        <div class="it-row">
          <button class="it-btn" data-act="close">닫기</button>
          <button class="it-btn primary" data-act="saveApi">저장</button>
        </div>
      </div>

      <!-- 생성 설정 탭 -->
      <div class="it-section" data-sec="sampling">
        <div class="it-grid">
          <div class="it-field">
            <label>온도 (Temperature): <span class="it-temp-disp">${curTemp}</span></label>
            <input type="range" class="it-temp-range" min="0" max="2" step="0.1" value="${curTemp}">
          </div>
          <div class="it-field">
            <label>최대 토큰 (Max Tokens)</label>
            <input type="number" class="it-max-tokens" min="1" max="32000" value="${curMaxTok}">
          </div>
          <div class="it-field">
            <label>Top P: <span class="it-topp-disp">${curTopP}</span></label>
            <input type="range" class="it-topp-range" min="0" max="1" step="0.05" value="${curTopP}">
          </div>
          <div class="it-field">
            <label>빈도 패널티 (Frequency Penalty)</label>
            <input type="number" class="it-freq-pen" min="0" max="2" step="0.1" value="${curFreqPen}">
          </div>
          <div class="it-field">
            <label>존재 패널티 (Presence Penalty)</label>
            <input type="number" class="it-pres-pen" min="0" max="2" step="0.1" value="${curPresPen}">
          </div>
        </div>
        <div class="it-inline-caption" style="margin-top:8px">
          • 온도: 높을수록 창의적, 낮을수록 일관적<br>
          • Top P: 확률 기반 샘플링 (1.0 = 비활성화)<br>
          • 패널티: 반복 방지 (0 = 비활성화)
        </div>
        <div class="it-row">
          <button class="it-btn" data-act="close">닫기</button>
          <button class="it-btn primary" data-act="saveSampling">저장</button>
        </div>
      </div>

      <!-- 프롬프트 탭 -->
      <div class="it-section" data-sec="prompt">
        <div class="it-field">
          <label>번역 프롬프트 (ChatML 형식)</label>
          <textarea class="it-sys" placeholder="비우면 기본 프롬프트 사용">${esc(sysDisplay)}</textarea>
          <div class="it-inline-caption">
            <b>사용 가능한 변수:</b><br>
            • <code>{{slot::content}}</code> - 번역할 텍스트<br>
            • <code>{{slot::tnote}}</code> - 번역가의 노트
          </div>
        </div>
        <div class="it-field">
          <label>번역가의 노트 (Translator Notes)</label>
          <textarea class="it-notes" placeholder="용어집, 스타일, 금칙어 등">${esc(curNotes)}</textarea>
        </div>
        <div class="it-row">
          <button class="it-btn secondary" data-act="resetPrompt">기본값으로 초기화</button>
          <button class="it-btn" data-act="close">닫기</button>
          <button class="it-btn primary" data-act="savePrompt">저장</button>
        </div>
      </div>

      <!-- 미리보기 탭 -->
      <div class="it-section" data-sec="preview">
        <div class="it-field">
          <label>미리보기 입력 (한글)</label>
          <textarea class="it-preview-in" placeholder="테스트할 문장을 입력하세요"></textarea>
        </div>
        <div class="it-field">
          <div class="it-label-row">
            <label>미리보기 결과</label>
            <button class="it-copy-btn" type="button" title="복사">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
          <div class="it-preview-out"></div>
        </div>
        <div class="it-row">
          <button class="it-btn" data-act="close">닫기</button>
          <button class="it-btn primary" data-act="preview">미리보기 실행</button>
        </div>
      </div>
    `;

        wrap.appendChild(panel);
        const cs = getComputedStyle(composer);
        if (cs.position === "static") composer.style.position = "relative";
        composer.appendChild(wrap);

        // 탭 전환
        const tabs = panel.querySelectorAll(".it-tab");
        function activate(tabName) {
            tabs.forEach(tb => tb.classList.toggle("active", tb.dataset.tab === tabName));
            panel.querySelectorAll(".it-section").forEach(sec => sec.classList.toggle("active", sec.dataset.sec === tabName));
        }
        tabs.forEach(tb => tb.addEventListener("click", (e) => { e.preventDefault(); activate(tb.dataset.tab); }));

        // 요소 참조
        const typeEl = panel.querySelector(".it-type");
        const urlEl = panel.querySelector(".it-url");
        const keyEl = panel.querySelector(".it-key");
        const keyTgl = panel.querySelector(".it-key-toggle");
        const modelEl = panel.querySelector(".it-model");
        const modelCustomEl = panel.querySelector(".it-model-custom");
        const tempRange = panel.querySelector(".it-temp-range");
        const tempDisp = panel.querySelector(".it-temp-disp");
        const maxTokEl = panel.querySelector(".it-max-tokens");
        const topPRange = panel.querySelector(".it-topp-range");
        const topPDisp = panel.querySelector(".it-topp-disp");
        const freqPenEl = panel.querySelector(".it-freq-pen");
        const presPenEl = panel.querySelector(".it-pres-pen");
        const sysEl = panel.querySelector(".it-sys");
        const notesEl = panel.querySelector(".it-notes");
        const pvIn = panel.querySelector(".it-preview-in");
        const pvOut = panel.querySelector(".it-preview-out");

        // API 타입 변경시 모델 목록 업데이트
        typeEl.addEventListener("change", () => {
            const newType = normalizeApiType(typeEl.value);
            const newModels = MODEL_PRESETS[newType] || MODEL_PRESETS.openai;
            modelEl.innerHTML = newModels.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');

            // URL 자동 변경
            if (newType === 'openai') urlEl.value = 'https://api.openai.com/v1/chat/completions';
            else if (newType === 'anthropic') urlEl.value = 'https://api.anthropic.com/v1/messages';
            else if (newType === 'gemini') urlEl.value = 'https://generativelanguage.googleapis.com';
        });

        // 슬라이더 동기화
        tempRange.addEventListener("input", () => { tempDisp.textContent = tempRange.value; });
        topPRange.addEventListener("input", () => { topPDisp.textContent = topPRange.value; });

        // 키 표시/숨김
        keyTgl?.addEventListener("click", (e) => {
            e.preventDefault();
            const isPw = keyEl.type === "password";
            keyEl.type = isPw ? "text" : "password";
            keyTgl.textContent = isPw ? "숨기기" : "표시";
        });

        // 닫기
        const closePanel = () => { try { wrap.remove(); } catch { } };
        panel.querySelectorAll('[data-act="close"]').forEach(btn => btn.addEventListener("click", (e) => { e.preventDefault(); closePanel(); }));

        // 저장 핸들러들
        panel.querySelector('[data-act="saveApi"]').addEventListener("click", (e) => {
            e.preventDefault();
            setArg("translator_api_type", typeEl.value);
            setArg("translator_api_url", urlEl.value);
            setArg("translator_api_key", keyEl.value);
            const finalModel = modelCustomEl.value.trim() || modelEl.value;
            setArg("translator_model", finalModel);
            showToast(composer, "ok", "API 설정 저장됨", 2200);
        });

        panel.querySelector('[data-act="saveSampling"]').addEventListener("click", (e) => {
            e.preventDefault();
            setArg("translator_temp", tempRange.value);
            setArg("translator_max_tokens", maxTokEl.value);
            setArg("translator_top_p", topPRange.value);
            setArg("translator_freq_penalty", freqPenEl.value);
            setArg("translator_pres_penalty", presPenEl.value);
            showToast(composer, "ok", "생성 설정 저장됨", 2200);
        });

        panel.querySelector('[data-act="savePrompt"]').addEventListener("click", (e) => {
            e.preventDefault();
            setArg("system_prompt", sysEl.value);
            setArg("translator_notes", notesEl.value);
            showToast(composer, "ok", "프롬프트 저장됨", 2200);
        });

        panel.querySelector('[data-act="resetPrompt"]').addEventListener("click", (e) => {
            e.preventDefault();
            sysEl.value = defaultSystemPrompt;
            notesEl.value = "";
            showToast(composer, "ok", "기본값으로 초기화됨", 1600);
        });

        // 미리보기
        panel.querySelector('[data-act="preview"]').addEventListener("click", async (e) => {
            e.preventDefault();
            const btn = e.currentTarget;
            const src = String(pvIn.value || "").trim();
            if (!src) { nudge(btn); showToast(composer, "warn", "미리보기 입력이 비어 있습니다."); return; }

            btn.disabled = true;
            const prevTxt = btn.textContent;
            btn.textContent = "미리보기 중…";

            const res = await translate(src);

            if (!res?.ok) {
                btn.disabled = false; btn.textContent = prevTxt;
                const status = res?.status ?? 0;
                const msg = res?.data?.error?.message || res?.data?.error || "요청 실패";
                nudge(btn);
                showToast(composer, "error", `미리보기 실패 <span class="code">HTTP ${status}</span><br>${esc(String(msg))}`);
                return;
            }

            const en = pickText(res.data);
            if (!en) { btn.disabled = false; btn.textContent = prevTxt; nudge(btn); showToast(composer, "error", "응답에서 텍스트 추출 실패"); return; }

            pvOut.textContent = en;
            btn.disabled = false; btn.textContent = prevTxt;
            showToast(composer, "ok", "미리보기 완료", 1600);
        });

        // 복사 버튼
        const copyBtn = panel.querySelector(".it-copy-btn");
        copyBtn?.addEventListener("click", async (e) => {
            e.preventDefault(); e.stopPropagation();
            const text = String(pvOut?.textContent || "").trim();
            if (!text) { nudge(copyBtn); showToast(composer, "warn", "복사할 결과가 없습니다."); return; }
            const ok = await copyText(text, composer);
            if (ok) showToast(composer, "ok", "복사됨", 1600);
            else { nudge(copyBtn); showToast(composer, "error", "복사 실패", 2600); }
        });

        // 현재 입력 내용으로 미리보기 초기화
        const liveInput = (getLiveInput(composer) || {}).el;
        const liveSample = liveInput ? (liveInput.value || liveInput.innerText || "") : "";
        pvIn.value = liveSample?.trim() || "이 문장은 미리보기 탭에서 테스트하기 위한 샘플입니다.";
    }

    // ===== 초기화 =====
    try {
        function ensure() { ensureButtonsAndPanel(); }
        ensure();
        const obs = new MutationObserver(ensure);
        obs.observe(document.body, { childList: true, subtree: true });
        apis.onUnload && apis.onUnload(() => obs.disconnect());
        console.info("[InputTrans] loaded v3.0.0");
    } catch (e) {
        console.error("[InputTrans] load error", e);
    }
})();
