// Custom Rust/React implementation, with design/reference adaptations from BrimDeck.
// Modified by Gogowu contributors, 2026. See THIRD_PARTY_NOTICES.md and licenses/BrimDeck-Apache-2.0.txt.
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowUp, Cpu, Gauge, RefreshCw, Settings2 } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLocale } from "./i18n";
import "./Monitoring.css";

export type MonitoringSettings = { codex: boolean; claude: boolean };
const STORAGE_KEY = "fly-island-monitoring-settings";
export function loadMonitoringSettings(): MonitoringSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return { codex: typeof saved?.codex === "boolean" ? saved.codex : true, claude: saved?.claude === true };
  } catch { return { codex: true, claude: false }; }
}
export function saveMonitoringSettings(settings: MonitoringSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* Current session still works. */ }
}

const COPY = {
  "zh-CN": {
    monitor: "性能监测", quota: "AI 额度", memory: "内存", cores: "逻辑处理器", processes: "占用最高的应用",
    cpu: "CPU", network: "网络", allNetworks: "全部网卡（可能包含虚拟网卡）", sampling: "正在采集…", unavailable: "暂无读数",
    gpu: "选择显卡", noGpu: "未检测到可监测显卡", noGpuReading: "暂无读数", localOnly: "仅在此面板展开时采集", settings: "设置", refresh: "刷新额度", loading: "正在查询…",
    quotaSettings: "AI 额度监控", showCodex: "显示 Codex", showClaude: "显示 Claude", disabled: "全部关闭后隐藏额度入口，并停止查询。",
    source: "使用本机登录信息查询账号额度；不会上传对话。Codex 需登录 ChatGPT 账号，Claude 需登录 Claude Code。",
    interval: "展开时每分钟更新；请求失败时保留同账号的上次读数并标为缓存。", used: "已用", cached: "缓存 · 非实时",
    updated: "更新于", retry: "下次重试", reset: "后重置", resetDue: "等待服务更新", noReset: "重置时间未知", noQuota: "未获取到额度",
    browser: "请在桌面应用中查看真实数据", oneMinute: "不足 1 分钟", day: "天", hour: "小时", minute: "分", count: "个进程",
    stale: "读数已过期，请刷新", unknown: "未知", networkGone: "所选网卡已断开", online: "在线",
  },
  en: {
    monitor: "System monitor", quota: "AI quotas", memory: "Memory", cores: "Logical processors", processes: "Busiest apps",
    cpu: "CPU", network: "Network", allNetworks: "All adapters (may include virtual adapters)", sampling: "Sampling…", unavailable: "Unavailable",
    gpu: "Select graphics adapter", noGpu: "No monitorable graphics adapter", noGpuReading: "Unavailable", localOnly: "Samples only while this panel is open", settings: "Settings", refresh: "Refresh quotas", loading: "Checking…",
    quotaSettings: "AI quota monitoring", showCodex: "Show Codex", showClaude: "Show Claude", disabled: "Turning both off hides the quota page and stops queries.",
    source: "Uses local sign-in to read account quotas; never uploads conversations. Codex needs ChatGPT sign-in; Claude needs Claude Code sign-in.",
    interval: "Updates every minute while open; failed requests retain the same account’s last reading as cached data.", used: "used", cached: "Cached · not live",
    updated: "Updated", retry: "Next retry", reset: "until reset", resetDue: "Waiting for update", noReset: "Reset time unknown", noQuota: "No quota available",
    browser: "Open the desktop app to see live data", oneMinute: "Less than 1 minute", day: "d", hour: "h", minute: "m", count: "processes",
    stale: "Reading expired; refresh to update", unknown: "Unknown", networkGone: "Selected adapter disconnected", online: "Live",
  },
};
function useCopy() { return COPY[useLocale().locale]; }
export function useMonitoringLabels() {
  const t = useCopy();
  return { monitor: t.monitor, quota: t.quota };
}

export function MonitoringControls({ settings, onChange }: { settings: MonitoringSettings; onChange: (s: MonitoringSettings) => void }) {
  const t = useCopy();
  return <section className="settings-section monitoring-controls">
    <div className="settings-section__header"><span>{t.quotaSettings}</span></div>
    {(["codex", "claude"] as const).map(provider => <label className="monitoring-toggle" key={provider}>
      <span>{provider === "codex" ? t.showCodex : t.showClaude}</span>
      <input type="checkbox" checked={settings[provider]} onChange={event => onChange({ ...settings, [provider]: event.target.checked })} />
    </label>)}
    <p>{t.disabled}</p><p>{t.source}</p>
  </section>;
}

type ProcessSample = { name: string; count: number; cpu: number; memory: number };
type MonitorSnapshot = {
  cpu: number; cores: number[]; memoryUsed: number; memoryTotal: number;
  networks: { name: string; down: number; up: number }[];
  gpus: { id: string; name: string; usage: number | null }[]; processes: ProcessSample[];
};
export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${Math.max(0, bytes).toFixed(0)} B`;
}

export function SystemMonitorPanel({ active }: { active: boolean }) {
  const t = useCopy();
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<"cpu" | "memory">("memory");
  const [network, setNetwork] = useState("");
  const [gpuId, setGpuId] = useState("");
  const [history, setHistory] = useState<number[]>([]);
  const sortRef = useRef(sort);
  sortRef.current = sort;
  useEffect(() => {
    if (!active || !isTauri()) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (await getCurrentWindow().isVisible()) {
          const next = await invoke<MonitorSnapshot>("get_system_monitor", { sort: sortRef.current });
          if (!disposed) { setSnapshot(next); setError(""); setHistory(current => [...current.slice(-29), next.cpu]); }
        }
      } catch (failure) { if (!disposed) setError(String(failure)); }
      finally { if (!disposed) timer = setTimeout(poll, 1000); }
    };
    setHistory([]);
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [active]);
  const gpu = snapshot?.gpus.find(device => device.id === gpuId) ?? snapshot?.gpus[0];
  const gpuName = (device: { id: string; name: string }) => snapshot?.gpus.filter(other => other.name === device.name).length === 1 ? device.name : `${device.name} (${device.id})`;
  const interfaces = snapshot?.networks.filter(n => !network || n.name === network) ?? [];
  const down = interfaces.reduce((sum, n) => sum + n.down, 0);
  const up = interfaces.reduce((sum, n) => sum + n.up, 0);
  const memoryPercent = snapshot && snapshot.memoryTotal > 0 ? snapshot.memoryUsed / snapshot.memoryTotal * 100 : 0;
  return <section className="monitor-panel" aria-label={t.monitor}>
    <div className="monitor-panel__heading"><span><Activity size={15} />{t.monitor}</span><small>{t.localOnly}</small></div>
    {!snapshot ? <div className="monitor-empty" role="status">{error || (isTauri() ? t.sampling : t.browser)}</div> : <>
      {error && <p className="monitor-error" role="alert">{error}</p>}
      <div className={`monitor-body${error ? " monitor-body--stale" : ""}`}>
        <div className="monitor-metrics">
          <div className="monitor-cpu-heading"><span><Cpu size={15} /> CPU <strong>{snapshot.cpu.toFixed(0)}<small>%</small></strong></span>
            <div className="monitor-spark" title="CPU · 30"><span style={{ clipPath: `polygon(0 100%, ${history.map((n, i) => `${i / Math.max(history.length - 1, 1) * 100}% ${100 - n}%`).join(", ")}, 100% 100%)` }} /></div>
          </div>
          <div className="monitor-cores" aria-label={t.cores}>
            {snapshot.cores.map((value, index) => <div key={index} title={`CPU ${index + 1}: ${value.toFixed(1)}%`}><span style={{ height: `${Math.max(2, value)}%` }} /></div>)}
          </div>
          <div className="monitor-memory"><span>{t.memory}</span><strong>{formatBytes(snapshot.memoryUsed)} <small>/ {formatBytes(snapshot.memoryTotal)}</small></strong><span>{memoryPercent.toFixed(0)}%</span></div>
          <div className="monitor-meter"><span style={{ width: `${memoryPercent}%` }} /></div>
          <div className="monitor-gpu">
            {gpu ? <>
              <label>GPU<select aria-label={t.gpu} title={gpuName(gpu)} value={gpu.id} onChange={event => setGpuId(event.target.value)}>
                {snapshot.gpus.map(device => <option key={device.id} value={device.id}>{gpuName(device)}</option>)}
              </select></label>
              <div className="monitor-gpu__reading"><strong>{gpu.usage === null ? t.noGpuReading : `${gpu.usage.toFixed(0)}%`}</strong>
                {gpu.usage !== null && <div className="monitor-meter"><span style={{ width: `${gpu.usage}%` }} /></div>}
              </div>
            </> : <small>{t.noGpu}</small>}
          </div>

        </div>
        <div className="monitor-processes">
          <div className="monitor-segments" role="group" aria-label={t.processes}>
            {(["cpu", "memory"] as const).map(value => <button key={value} type="button" aria-pressed={sort === value} onClick={() => setSort(value)}>{value === "cpu" ? t.cpu : t.memory}</button>)}
          </div>
          {snapshot.processes.map(process => <div className="monitor-process" key={process.name} title={`${process.name} · ${process.count} ${t.count}`}>
            <span className="monitor-app-mark">{process.name.slice(0, 1).toUpperCase()}</span><span>{process.name}</span>
            <strong>{sort === "cpu" ? `${process.cpu.toFixed(1)}%` : formatBytes(process.memory)}</strong>
          </div>)}
        </div>
      </div>
      <div className="monitor-network"><select aria-label={t.network} value={network} onChange={event => setNetwork(event.target.value)}>
        <option value="">{t.allNetworks}</option>{snapshot.networks.map(n => <option key={n.name} value={n.name}>{n.name}</option>)}
      </select>{interfaces.length ? <><span><ArrowDown size={14} />{formatBytes(down)}/s</span><span><ArrowUp size={14} />{formatBytes(up)}/s</span></> : <small>{network ? t.networkGone : t.unavailable}</small>}</div>
    </>}
  </section>;
}

type QuotaSnapshot = {
  provider: string; plan: string | null; status: "online" | "cached" | "unavailable"; message: string;
  updatedAt: number | null; retryAt: number | null;
  windows: { label: string; usedPercent: number; resetsAt: number | null; minutes: number | null }[];
};

function remaining(seconds: number, t: ReturnType<typeof useCopy>) {
  if (seconds < 60) return t.oneMinute;
  const minutes = Math.ceil(seconds / 60);
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), mins = minutes % 60;
  return `${days ? `${days}${t.day} ` : ""}${hours ? `${hours}${t.hour} ` : ""}${!days || !hours ? `${mins}${t.minute}` : ""}`.trim();
}

export function AiQuotaPanel({ active, settings, onOpenSettings }: { active: boolean; settings: MonitoringSettings; onOpenSettings: () => void }) {
  const t = useCopy();
  const [snapshots, setSnapshots] = useState<Record<string, QuotaSnapshot>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [at, setAt] = useState(Date.now() / 1000);
  const manual = useRef(false);
  useEffect(() => {
    if (!active || !isTauri()) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!await getCurrentWindow().isVisible().catch(() => false)) {
        if (!disposed) timer = setTimeout(poll, 60_000);
        return;
      }
      if (!disposed) setLoading(true);
      const force = manual.current;
      manual.current = false;
      await Promise.all((["codex", "claude"] as const).filter(p => settings[p]).map(async provider => {
        try {
          const snapshot = await invoke<QuotaSnapshot>("get_ai_quota", { provider, force });
          if (!disposed) setSnapshots(current => ({ ...current, [provider]: snapshot }));
        } catch (failure) {
          if (!disposed) setSnapshots(current => ({ ...current, [provider]: { provider, plan: null, windows: [], status: "unavailable", message: String(failure), updatedAt: null, retryAt: null } }));
        }
      }));
      if (!disposed) { setLoading(false); setAt(Date.now() / 1000); timer = setTimeout(poll, 60_000); }
    };
    void poll();
    const clock = setInterval(() => setAt(Date.now() / 1000), 15_000);
    return () => { disposed = true; clearTimeout(timer); clearInterval(clock); };
  }, [active, settings.codex, settings.claude, refreshKey]);
  return <section className="quota-panel" aria-label={t.quota}>
    <div className="monitor-panel__heading"><span><Gauge size={15} />{t.quota}</span><div>
      <button type="button" className="icon-button" title={t.refresh} aria-label={t.refresh} disabled={loading} onClick={() => { manual.current = true; setRefreshKey(key => key + 1); }}><RefreshCw size={16} className={loading ? "quota-spinning" : ""} /></button>
      <button type="button" className="icon-button" title={t.settings} aria-label={t.settings} onClick={onOpenSettings}><Settings2 size={16} /></button>
    </div></div>
    <div className="quota-columns">
      {(["codex", "claude"] as const).filter(provider => settings[provider]).map(provider => {
        const snapshot = snapshots[provider];
        const old = snapshot?.status === "cached" || Boolean(snapshot?.updatedAt && at - snapshot.updatedAt > 180);
        return <article className="quota-card" key={provider}>
          <header><strong>{provider === "codex" ? "Codex" : "Claude"}</strong>{snapshot?.plan && <small>{snapshot.plan}</small>}
            {snapshot?.windows.length ? <span className={old ? "quota-status--cached" : "quota-status"}>{old ? t.cached : t.online}</span> : null}</header>
          {!snapshot ? <p className="monitor-empty">{isTauri() ? t.loading : t.browser}</p> : <>
            {snapshot.windows.length ? snapshot.windows.map((window, index) => <div className={`quota-window${old ? " quota-window--old" : ""}`} key={`${window.label}-${index}`}>
              <div>{window.minutes === 300 ? (t === COPY.en ? "5 hours" : "5 小时") : window.minutes === 10080 && (window.label === "每周") ? (t === COPY.en ? "Weekly" : "每周") : window.label}</div>
              <div className="quota-window__value"><strong>{window.usedPercent.toFixed(0)}% <small>{t.used}</small></strong><span title={window.resetsAt ? new Date(window.resetsAt * 1000).toLocaleString() : undefined}>
                {window.resetsAt ? window.resetsAt > at ? `${remaining(window.resetsAt - at, t)} ${t.reset}` : t.resetDue : t.noReset}
              </span></div>
              <div className={`quota-bar${window.usedPercent >= 90 ? " quota-bar--critical" : window.usedPercent >= 70 ? " quota-bar--warning" : ""}`} role="progressbar" aria-label={window.label} aria-valuenow={window.usedPercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${window.usedPercent}%` }} /></div>
            </div>) : <p className="quota-unavailable">{t.noQuota}</p>}
            <p className={old || !snapshot.windows.length ? "quota-note quota-note--warning" : "quota-note"}>{snapshot.message}</p>
            {snapshot.updatedAt && <p className="quota-time">{t.updated} {new Date(snapshot.updatedAt * 1000).toLocaleTimeString()}{old && snapshot.status !== "cached" ? ` · ${t.stale}` : ""}</p>}
            {snapshot.retryAt && snapshot.retryAt > at && <p className="quota-time">{t.retry} {new Date(snapshot.retryAt * 1000).toLocaleTimeString()}</p>}
          </>}
        </article>;
      })}
    </div>
    <p className="quota-footnote">{t.interval}</p>
  </section>;
}
