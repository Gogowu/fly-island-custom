// Interactive regression fixture: /tests/monitoring.html, or ?translation=1.
// Tests the real app with official Tauri mocks, without reading sign-ins or sending requests.
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import App from "../src/App";
import TranslationWindow from "../src/TranslationWindow";
import { I18nProvider } from "../src/i18n";

const query = new URLSearchParams(location.search);
const translation = query.has("translation");
const prefix = (key: string) => key.startsWith("focusd-island-") || key.startsWith("fly-island-");
const original = new Map(Object.entries(localStorage).filter(([key]) => prefix(key)));
window.addEventListener("beforeunload", () => {
  for (const key of Object.keys(localStorage).filter(prefix)) if (!original.has(key)) localStorage.removeItem(key);
  for (const [key, value] of original) localStorage.setItem(key, value);
});
localStorage.setItem("focusd-island-locale", query.has("en") ? "en" : "zh-CN");
localStorage.setItem("fly-island-monitoring-settings", JSON.stringify({ codex: true, claude: false }));
const calls: { command: string; args: Record<string, unknown> }[] = [];
const secrets = new Set<string>();
Object.assign(globalThis, { isTauri: true, featureTestCalls: calls });
let revision = 0;
mockIPC((command, payload) => {
  const args = (payload ?? {}) as Record<string, unknown>;
  calls.push({ command, args: { ...args, secret: args.secret ? "[redacted test key]" : undefined } });
  const provider = args.provider as { baseUrl?: string } | undefined;
  switch (command) {
    case "get_launch_at_startup": return false;
    case "get_default_todo_save_directory": return "";
    case "get_clipboard_history": return { settings: { enabled: true, captureImages: true, maxItems: 100, shortcut: "Ctrl+X" }, items: [] };
    case "get_agent_status": return { codex: { phase: "idle", updatedAt: 0 }, claudeCode: { phase: "idle", updatedAt: 0 }, updatedAt: 0, statusPath: "" };
    case "get_media_state": return { available: false, audioActive: false, audioPeak: 0, playbackStatus: "unavailable", title: null, artist: null, album: null, thumbnail: null, positionMs: 0, durationMs: 0, canSeek: false, canNext: false, canPrevious: false, shuffleActive: null, canShuffle: false, repeatMode: "unknown", canRepeat: false, volume: 1, sourceApp: null, activeSessionId: null, sessions: [], updatedAt: 0 };
    case "get_audio_level": return { active: false, peak: 0, updatedAt: 0 };
    case "set_island_interaction": return "disabled";
    case "set_qq_notifications_enabled": return { revision: ++revision, enabled: args.enabled, status: "disabled", items: [], error: null };
    case "set_wechat_reminders_enabled": return { revision: ++revision, enabled: args.enabled, status: "disabled", pending: false, lastAttentionAt: null, error: null };
    case "get_qq_mail_state": return { revision: ++revision, configured: false, enabled: false, syncing: false, status: "disconnected", items: [], unreadCount: 0, error: null };
    case "plugin:window|is_visible": return true;
    case "set_translation_shortcut": return args.shortcut;
    case "read_translation_clipboard": return "Hello world";
    case "has_translation_secret": return secrets.has(provider?.baseUrl ?? "https://api.deepseek.com");
    case "save_translation_secret": secrets.add(provider?.baseUrl ?? "https://api.deepseek.com"); return;
    case "delete_translation_secret": secrets.delete(provider?.baseUrl ?? "https://api.deepseek.com"); return;
    case "translate_text": return "你好，世界";
    case "get_system_monitor": return {
      cpu: 18, cores: Array.from({ length: 24 }, (_, i) => i % 5 === 0 ? 45 : 3 + i % 11),
      memoryUsed: 15.6 * 1024 ** 3, memoryTotal: 31.4 * 1024 ** 3,
      networks: [{ name: "Wi-Fi", down: 16 * 1024, up: 2 * 1024 }], gpus: [{ id: "test-adapter", name: "Example Graphics Adapter", usage: 12 }],
      processes: (args.sort === "cpu" ? ["Codex", "Edge", "Windows", "WebView2", "Security", "Explorer"] : ["Codex", "Edge", "WebView2", "Windows", "Security", "Explorer"])
        .map((name, i) => ({ name, count: 3, cpu: 5 - i * .5, memory: (1800 - i * 210) * 1024 ** 2 })),
    };
    case "get_ai_quota": return {
      provider: args.provider, plan: args.provider === "codex" ? "Plus" : "Pro",
      status: query.get("quota") === "cached" ? "cached" : "online", message: "测试账号额度 · 模拟数据",
      updatedAt: Date.now() / 1000 - (query.get("quota") === "cached" ? 600 : 0), retryAt: null,
      windows: [{ label: "5 小时", usedPercent: 12, minutes: 300, resetsAt: Date.now() / 1000 + 17760 }, { label: "每周", usedPercent: 29, minutes: 10080, resetsAt: Date.now() / 1000 + 360000 }],
    };
    default: return null;
  }
}, { shouldMockEvents: true });
mockWindows(translation ? "translation" : "main");
createRoot(document.getElementById("root")!).render(<I18nProvider>{translation ? <TranslationWindow /> : <App />}</I18nProvider>);
