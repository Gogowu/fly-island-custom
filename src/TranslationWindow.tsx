import { useTranslation } from "./i18n";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useLocale } from "./i18n";
import { ArrowRight, Check, Clipboard, Copy, Grip, Languages, LoaderCircle, Settings2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./TranslationWindow.css";

type Direction = "auto" | "zh-en" | "en-zh";
type TranslationSettings = { shortcut: string; direction: Direction; providerType: "deepseek" | "custom"; baseUrl: string; model: string; allowLanHttp: boolean };
const STORAGE_KEY = "focusd-island-translation-settings";
const DEFAULT_SETTINGS: TranslationSettings = { shortcut: "Alt+C", direction: "auto", providerType: "deepseek", baseUrl: "https://api.openai.com/v1", model: "", allowLanHttp: false };

function loadSettings(): TranslationSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<TranslationSettings> | null;
    const shortcut = typeof stored?.shortcut === "string" ? stored.shortcut : DEFAULT_SETTINGS.shortcut;
    return {
      shortcut: shortcut === "Alt+Space" ? DEFAULT_SETTINGS.shortcut : shortcut,
      direction: stored?.direction === "zh-en" || stored?.direction === "en-zh" ? stored.direction : "auto",
      providerType: stored?.providerType === "custom" ? "custom" : "deepseek",
      baseUrl: typeof stored?.baseUrl === "string" ? stored.baseUrl : DEFAULT_SETTINGS.baseUrl,
      model: typeof stored?.model === "string" ? stored.model : DEFAULT_SETTINGS.model,
      allowLanHttp: stored?.allowLanHttp === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function normalizeShortcut(event: KeyboardEvent<HTMLInputElement>) {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
  const modifiers = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Win"].filter(Boolean);
  if (!modifiers.length) return null;
  const key = event.key === " " || event.key === "Spacebar" ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...modifiers, key].join("+");
}

export default function TranslationWindow() {
  const t = useTranslation();
  const { locale } = useLocale();
  const zh = locale === "zh-CN";
  const [settings, setSettings] = useState<TranslationSettings>(loadSettings);
  const [input, setInput] = useState("");
  const [clipboardPreview, setClipboardPreview] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [shortcutError, setShortcutError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [secretDraft, setSecretDraft] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [savingSecret, setSavingSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionResult, setConnectionResult] = useState("");
  const [didCopy, setDidCopy] = useState(false);
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const requestId = useRef(0);
  const clipboardRequestId = useRef(0);
  const inputLength = Array.from(input).length;
  const provider = useMemo(() => settings.providerType === "deepseek"
    ? { baseUrl: "https://api.deepseek.com", model: "deepseek-flash", allowLanHttp: false }
    : { baseUrl: settings.baseUrl, model: settings.model, allowLanHttp: settings.allowLanHttp }, [settings.providerType, settings.baseUrl, settings.model, settings.allowLanHttp]);
  const keyOptional = (() => {
    try {
      const host = new URL(provider.baseUrl).hostname;
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
      const ip = host.split(".").map(Number);
      const privateV4 = ip.length === 4 && ip.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
        && (ip[0] === 10 || ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31 || ip[0] === 192 && ip[1] === 168);
      return local || provider.allowLanHttp && (privateV4 || /^\[?f[cd][0-9a-f]{2}:/i.test(host));
    } catch { return false; }
  })();
  const busy = savingSecret || testing || isLoading;
  const targetLanguage = settings.direction === "zh-en"
    ? t.translator.english
    : settings.direction === "en-zh"
      ? t.translator.chinese
      : t.translator.bilingual;

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* Keep session settings. */ } }, [settings]);
  useEffect(() => {
    let disposed = false;
    setHasSecret(false); setSecretDraft(""); setConnectionResult(""); setError("");
    const timer = setTimeout(() => {
      void invoke<boolean>("has_translation_secret", { provider })
        .then(value => { if (!disposed) setHasSecret(value); })
        .catch(() => { if (!disposed) setHasSecret(false); });
    }, 300);
    return () => { disposed = true; clearTimeout(timer); };
  }, [provider.baseUrl, provider.allowLanHttp]);
  useEffect(() => {
    void invoke<string>("set_translation_shortcut", { shortcut: settings.shortcut })
      .then(() => setShortcutError(""))
      .catch((failure) => setShortcutError(String(failure)));
    // Shortcut edits register immediately in the recording handler.
  }, []);

  const refreshClipboard = useCallback(() => {
    const currentId = ++clipboardRequestId.current;
    void invoke<string | null>("read_translation_clipboard")
      .then((text) => { if (currentId === clipboardRequestId.current) setClipboardPreview(text ?? ""); })
      .catch(() => { if (currentId === clipboardRequestId.current) setClipboardPreview(""); });
  }, []);

  const pasteLatestClipboard = useCallback(async () => {
    const currentId = ++clipboardRequestId.current;
    try {
      const text = await invoke<string | null>("read_translation_clipboard");
      if (currentId !== clipboardRequestId.current) return;
      if (!text) { setError(t.translator.emptyClipboard); return; }
      setClipboardPreview(text);
      setInput(text);
      setError("");
      setDidCopy(false);
      inputRef.current?.focus();
    } catch (failure) {
      if (currentId === clipboardRequestId.current) setError(String(failure));
    }
  }, [t]);

  const handleOpened = useCallback(() => {
    requestId.current += 1;
    setInput("");
    setOutput("");
    setError("");
    setDidCopy(false);
    setIsLoading(false);
    setShowConfig(false);
    setClipboardPreview("");
    refreshClipboard();
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [refreshClipboard]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let didCancel = false;
    void listen("translation-window-opened", handleOpened).then((nextUnlisten) => {
      if (didCancel) nextUnlisten();
      else unlisten = nextUnlisten;
    });
    void getCurrentWindow().isVisible().then((visible) => {
      if (!didCancel && visible) handleOpened();
    });
    return () => { didCancel = true; unlisten?.(); };
  }, [handleOpened]);

  useEffect(() => {
    if (showConfig) return;
    const handleTab = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab" || event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      void pasteLatestClipboard();
    };
    window.addEventListener("keydown", handleTab, true);
    return () => window.removeEventListener("keydown", handleTab, true);
  }, [pasteLatestClipboard, showConfig]);

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text) { setError(t.translator.emptySource); return; }
    if (Array.from(text).length > 5000) { setError(t.translator.tooLong); return; }
    const currentId = ++requestId.current;
    setError("");
    setOutput("");
    setIsLoading(true);
    try {
      const translated = await invoke<string>("translate_text", { text, direction: settings.direction, provider });
      if (currentId === requestId.current) setOutput(translated);
    } catch (failure) {
      if (currentId === requestId.current) setError(String(failure));
    } finally {
      if (currentId === requestId.current) setIsLoading(false);
    }
  }, [input, settings.direction, provider, t]);

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const saveSecret = async () => {
    if (!secretDraft.trim()) return;
    setSavingSecret(true);
    try {
      await invoke("save_translation_secret", { secret: secretDraft, provider });
      setSecretDraft("");
      setHasSecret(true);
      setError("");
    } catch (failure) { setError(String(failure)); }
    finally { setSavingSecret(false); }
  };

  const removeSecret = async () => {
    setSavingSecret(true);
    try {
      await invoke("delete_translation_secret", { provider });
      setHasSecret(false);
      setSecretDraft("");
    } catch (failure) { setError(String(failure)); }
    finally { setSavingSecret(false); }
  };

  const copyResult = async () => {
    if (!output) return;
    try {
      await invoke("copy_translation_result", { text: output });
      setDidCopy(true);
    } catch (failure) { setError(String(failure)); }
  };

  const testConnection = async () => {
    setTesting(true); setError(""); setConnectionResult("");
    try {
      await invoke<string>("translate_text", { text: "Hello", direction: "en-zh", provider });
      setConnectionResult(zh ? "连接成功，模型已返回译文。" : "Connected. The model returned a translation.");
    } catch (failure) { setError(String(failure)); }
    finally { setTesting(false); }
  };

  const clearSource = () => {
    requestId.current += 1;
    setInput("");
    setOutput("");
    setError("");
    setDidCopy(false);
    setIsLoading(false);
    inputRef.current?.focus();
  };

  const close = () => { requestId.current += 1; clipboardRequestId.current += 1; void invoke("hide_translation_window"); };
  const startWindowDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    void getCurrentWindow().startDragging().catch((failure) => console.error("Cannot drag translation window", failure));
  };
  const startResize = (event: PointerEvent<HTMLDivElement>, direction: "East" | "South" | "SouthEast") => {
    if (event.button !== 0) return;
    event.stopPropagation();
    void getCurrentWindow().startResizeDragging(direction)
      .catch((failure) => console.error("Cannot resize translation window", failure));
  };

  return (
    <main className="translation-stage">
      <section className="translation-window" aria-label={t.translator.label}>
        <header className="translation-window__header" onPointerDown={startWindowDrag}>
          <span className="translation-window__mark" aria-hidden="true"><Languages size={18} /></span>
          <div className="translation-window__heading"><h1>{t.translator.title}</h1></div>
          <kbd className="translation-window__shortcut">{settings.shortcut}</kbd>
          <div className="translation-window__actions">
            <button type="button" title={t.translator.settings} aria-label={t.translator.settings} aria-pressed={showConfig} onClick={() => setShowConfig((value) => !value)}><Settings2 size={18} /></button>
            <button type="button" title={t.common.close} aria-label={t.translator.closeLabel} onClick={close}><X size={18} /></button>
          </div>
        </header>

        {showConfig ? (
          <section className="translation-window__config">
            <div className="translation-window__section-heading"><h2>{t.translator.settings}</h2><p>{zh ? "支持 OpenAI 兼容的 Chat Completions 接口。密钥按服务地址分别保存在 Windows 凭据管理器，本机服务或已启用局域网选项的自建服务可不填密钥。" : "Supports OpenAI-compatible Chat Completions. Keys are saved separately per endpoint in Windows Credential Manager. Local and enabled LAN services may omit a key."}</p></div>
            <label className="translation-window__field"><span>{zh ? "翻译服务" : "Translation provider"}</span>
              <select value={settings.providerType} disabled={busy} onChange={event => setSettings(current => ({ ...current, providerType: event.target.value as "deepseek" | "custom" }))}>
                <option value="deepseek">DeepSeek</option><option value="custom">{zh ? "自定义兼容服务" : "Custom compatible service"}</option>
              </select>
            </label>
            {settings.providerType === "custom" && <>
              <label className="translation-window__field"><span>{zh ? "服务地址（Base URL）" : "Base URL"}</span>
                <input type="url" autoComplete="off" spellCheck={false} disabled={busy} value={settings.baseUrl} onChange={event => setSettings(current => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.example.com/v1" />
                <small>{zh ? "可填写基础地址或完整 /chat/completions 地址。本机示例：http://localhost:11434/v1" : "Use a base URL or a full /chat/completions endpoint. Local example: http://localhost:11434/v1"}</small>
              </label>
              <label className="translation-window__lan-option">
                <input type="checkbox" checked={settings.allowLanHttp} disabled={busy} onChange={event => setSettings(current => ({ ...current, allowLanHttp: event.target.checked }))} />
                <span>{zh ? "允许局域网 HTTP（自建服务，可不填密钥）" : "Allow LAN HTTP (self-hosted service, key optional)"}</span>
              </label>
              <label className="translation-window__field"><span>{zh ? "模型名称" : "Model"}</span>
                <input value={settings.model} disabled={busy} autoComplete="off" spellCheck={false} onChange={event => { setSettings(current => ({ ...current, model: event.target.value })); setConnectionResult(""); }} placeholder={zh ? "填写服务商提供的模型 ID" : "Enter your provider’s model ID"} />
              </label>
            </>}
            <label className="translation-window__field"><span>{t.translator.secret} {hasSecret && <em>{t.common.saved}</em>}</span>
              <input type="password" autoComplete="off" disabled={busy} value={secretDraft} onChange={(event) => setSecretDraft(event.target.value)} placeholder={hasSecret ? t.translator.replaceSecret : t.translator.enterSecret} />
            </label>
            <div className="translation-window__config-actions">
              <button type="button" className="translation-window__primary" onClick={() => void saveSecret()} disabled={!secretDraft.trim() || busy}>{t.translator.saveSecret}</button>
              {hasSecret && <button type="button" disabled={busy} className="translation-window__secondary" onClick={() => void removeSecret()}>{t.translator.deleteSecret}</button>}
              <button type="button" disabled={busy || (!hasSecret && !keyOptional) || !provider.model.trim() || Boolean(secretDraft.trim())} className="translation-window__secondary" onClick={() => void testConnection()}>{testing ? (zh ? "测试中…" : "Testing…") : (zh ? "测试连接" : "Test connection")}</button>
            </div>
            {connectionResult && <p className="translation-window__success" role="status">{connectionResult}</p>}
            <small className="translation-window__provider-note">{zh ? "测试连接会发送一条极短翻译请求。修改服务地址后，请为新地址重新保存密钥。设置自动保存在本机。" : "Testing sends a short translation request. Save a key again after changing the endpoint. Settings are saved locally."}</small>
            <label className="translation-window__field"><span>{t.translator.shortcut}</span>
              <input readOnly value={recordingShortcut ? t.translator.pressShortcut : settings.shortcut} onFocus={() => setRecordingShortcut(true)} onBlur={() => setRecordingShortcut(false)} onKeyDown={(event) => {
                event.preventDefault();
                if (event.key === "Escape") { setRecordingShortcut(false); event.currentTarget.blur(); return; }
                const shortcut = normalizeShortcut(event);
                if (!shortcut) return;
                const field = event.currentTarget;
                void invoke<string>("set_translation_shortcut", { shortcut })
                  .then((registered) => { setSettings((current) => ({ ...current, shortcut: registered })); setShortcutError(""); setRecordingShortcut(false); field.blur(); })
                  .catch((failure) => setShortcutError(String(failure)));
              }} />
              <small>{t.translator.shortcutHint}</small>
            </label>
            {(shortcutError || error) && <p className="translation-window__error" role="alert">{shortcutError || error}</p>}
          </section>
        ) : (
          <>
            <div className="translation-window__toolbar">
              <div className="translation-window__languages">
                <select id="translation-direction" aria-label={t.translator.direction} value={settings.direction} disabled={isLoading} onChange={(event) => setSettings({ ...settings, direction: event.target.value as Direction })}>
                  <option value="auto">{t.translator.auto}</option><option value="zh-en">{t.translator.chinese}</option><option value="en-zh">{t.translator.english}</option>
                </select>
                <ArrowRight size={15} aria-hidden="true" />
                <span>{targetLanguage}</span>
              </div>
              <span className="translation-window__provider" title={`${provider.baseUrl} · ${provider.model}`}>{settings.providerType === "deepseek" ? "DeepSeek" : provider.model || (zh ? "自定义服务" : "Custom service")}</span>
            </div>
            <div className="translation-window__content">
              <section className="translation-window__panel translation-window__source">
                <div className="translation-window__panel-heading">
                  <h2 id="translation-source-label">{t.translator.source}</h2>
                  <div className="translation-window__source-actions">
                    <span className={inputLength > 5000 ? "translation-window__error" : ""} title={t.translator.limit}>{inputLength.toLocaleString()} / 5,000</span>
                    {input && <button type="button" className="translation-window__icon-button" onClick={clearSource} title={t.translator.clearSource} aria-label={t.translator.clearSource}><X size={14} /></button>}
                  </div>
                </div>
                <textarea id="translation-input" aria-labelledby="translation-source-label" ref={inputRef} value={input} onChange={(event) => { setInput(event.target.value); setError(""); setDidCopy(false); }} onKeyDown={handleInputKeyDown} placeholder={t.translator.placeholder} />
                {!input && clipboardPreview && <button type="button" className="translation-window__clipboard" onClick={() => void pasteLatestClipboard()} title={t.translator.paste}><Clipboard size={14} /><span>{t.translator.clipboard(clipboardPreview.slice(0, 120))}</span><kbd>Tab</kbd></button>}
              </section>
              <section className="translation-window__panel translation-window__target" aria-busy={isLoading} aria-labelledby="translation-result-label">
                <div className="translation-window__panel-heading"><h2 id="translation-result-label">{t.translator.result}</h2><button type="button" className="translation-window__copy" onClick={() => void copyResult()} disabled={!output} title={t.translator.copy} aria-label={t.translator.copy}>{didCopy ? <><Check size={14} /><span>{t.translator.copied}</span></> : <Copy size={15} />}</button></div>
                <div className={`translation-window__result ${output ? "translation-window__result--filled" : ""}`} aria-live="polite">{output || <span className="translation-window__empty-result">{isLoading && <LoaderCircle className="translation-window__spinner" size={16} aria-hidden="true" />}{isLoading ? t.translator.loading : t.translator.emptyResult}</span>}</div>
              </section>
            </div>
            <footer className="translation-window__footer">
              <div className="translation-window__footer-info">{error ? <span className="translation-window__error" role="alert">{error}</span> : !hasSecret && !keyOptional ? <button type="button" className="translation-window__setup" onClick={() => setShowConfig(true)}>{t.translator.configureSecret}</button> : <span>{t.translator.enterHint}</span>}</div>
              <button type="button" className="translation-window__primary translation-window__translate" onClick={() => void submit()} disabled={isLoading}>{isLoading ? t.translator.loading : t.translator.translate} {!isLoading && <ArrowRight size={15} />}</button>
            </footer>
          </>
        )}
        <div className="translation-window__resize translation-window__resize--east" onPointerDown={(event) => startResize(event, "East")} aria-hidden="true" />
        <div className="translation-window__resize translation-window__resize--south" onPointerDown={(event) => startResize(event, "South")} aria-hidden="true" />
        <div className="translation-window__resize translation-window__resize--corner" onPointerDown={(event) => startResize(event, "SouthEast")} aria-hidden="true"><Grip size={12} /></div>
      </section>
    </main>
  );
}
