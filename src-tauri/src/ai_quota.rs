// Custom Rust/React implementation, with design/reference adaptations from BrimDeck.
// Modified by Gogowu contributors, 2026. See THIRD_PARTY_NOTICES.md and licenses/BrimDeck-Apache-2.0.txt.
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    label: String,
    used_percent: f64,
    resets_at: Option<i64>,
    minutes: Option<i64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaSnapshot {
    provider: String,
    plan: Option<String>,
    windows: Vec<QuotaWindow>,
    status: String,
    message: String,
    updated_at: Option<i64>,
    retry_at: Option<i64>,
}

struct Login {
    token: String,
    account: Option<String>,
    plan: Option<String>,
    identity: String,
}
struct Cache {
    identity: String,
    snapshot: QuotaSnapshot,
    next_read: i64,
    failures: u32,
    busy: bool,
}
static CACHE: OnceLock<Mutex<HashMap<String, Cache>>> = OnceLock::new();

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn empty(provider: &str, message: &str) -> QuotaSnapshot {
    QuotaSnapshot {
        provider: provider.into(),
        plan: None,
        windows: vec![],
        status: "unavailable".into(),
        message: message.into(),
        updated_at: None,
        retry_at: None,
    }
}

fn data_home(variable: &str, folder: &str) -> Result<PathBuf, String> {
    if let Some(value) = env::var_os(variable) {
        let path = PathBuf::from(value);
        if path.is_absolute() {
            return Ok(path);
        }
    }
    env::var_os("USERPROFILE")
        .map(|home| PathBuf::from(home).join(folder))
        .ok_or_else(|| "无法找到用户目录".into())
}

fn read_json(path: &Path) -> Result<Value, String> {
    if fs::metadata(path)
        .map_err(|_| "未找到登录信息，请先在对应软件中登录")?
        .len()
        > 1024 * 1024
    {
        return Err("登录信息格式异常".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|_| "无法读取登录信息")?)
        .map_err(|_| "无法识别登录信息，请更新对应软件后重试".into())
}

fn login(provider: &str) -> Result<Login, String> {
    let (token, account, plan) = if provider == "codex" {
        let root = read_json(&data_home("CODEX_HOME", ".codex")?.join("auth.json"))?;
        let tokens = &root["tokens"];
        (
            tokens["access_token"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            tokens["account_id"].as_str().map(str::to_owned),
            None,
        )
    } else {
        let root =
            read_json(&data_home("CLAUDE_CONFIG_DIR", ".claude")?.join(".credentials.json"))?;
        let oauth = &root["claudeAiOauth"];
        if let Some(expiry) = oauth["expiresAt"].as_i64() {
            if expiry / 1000 <= now() {
                return Err("Claude 登录已过期，请打开 Claude Code 更新登录".into());
            }
        }
        (
            oauth["accessToken"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            None,
            oauth["subscriptionType"].as_str().map(str::to_owned),
        )
    };
    if token.is_empty() {
        return Err(if provider == "codex" {
            "需要 Codex 的 ChatGPT 账号登录；API Key 模式没有订阅额度"
        } else {
            "请先在 Claude Code 中登录订阅账号"
        }
        .into());
    }
    // Never retain or expose a raw login token in the cache or the WebView.
    let identity = format!(
        "{:x}",
        Sha256::digest(format!(
            "{}:{}",
            account.as_deref().unwrap_or_default(),
            token
        ))
    );
    Ok(Login {
        token,
        account,
        plan,
        identity,
    })
}

fn parse_time(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| {
        value.as_str().and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(s)
                .ok()
                .map(|date| date.timestamp())
        })
    })
}

fn window(label: String, used: &Value, reset: &Value, minutes: Option<i64>) -> Option<QuotaWindow> {
    let used = used.as_f64()?;
    if !used.is_finite() || used < 0.0 {
        return None;
    }
    Some(QuotaWindow {
        label,
        used_percent: used.clamp(0.0, 100.0),
        resets_at: parse_time(reset),
        minutes,
    })
}

fn parse_codex(root: &Value, at: i64) -> Vec<QuotaWindow> {
    let mut windows = vec![];
    let limits = &root["rate_limit"];
    for (key, fallback) in [
        ("primary_window", "主要额度"),
        ("secondary_window", "次要额度"),
    ] {
        let data = &limits[key];
        let minutes = data["limit_window_seconds"]
            .as_i64()
            .map(|seconds| seconds / 60);
        let label = match minutes {
            Some(300) => "5 小时".into(),
            Some(10080) => "每周".into(),
            Some(n) if n > 0 => format!("{n} 分钟"),
            _ => fallback.into(),
        };
        if let Some(mut item) = window(label, &data["used_percent"], &data["reset_at"], minutes) {
            if item.resets_at.is_none() {
                item.resets_at = data["reset_after_seconds"]
                    .as_i64()
                    .filter(|s| (0..31_536_000).contains(s))
                    .map(|s| at + s);
            }
            windows.push(item);
        }
    }
    windows
}

fn parse_claude(root: &Value) -> Vec<QuotaWindow> {
    let mut windows = vec![];
    for (key, label, minutes) in [
        ("five_hour", "5 小时", 300),
        ("seven_day", "每周", 10080),
        ("seven_day_opus", "Opus 每周", 10080),
        ("seven_day_sonnet", "Sonnet 每周", 10080),
    ] {
        if let Some(item) = window(
            label.into(),
            &root[key]["utilization"],
            &root[key]["resets_at"],
            Some(minutes),
        ) {
            windows.push(item);
        }
    }
    if let Some(limits) = root["limits"].as_array() {
        for data in limits {
            let (label, minutes) = match data["kind"].as_str().unwrap_or_default() {
                "session" => ("5 小时".to_string(), Some(300)),
                "weekly_all" => ("每周".to_string(), Some(10080)),
                _ => {
                    let name = data
                        .pointer("/scope/model/display_name")
                        .and_then(Value::as_str)
                        .or_else(|| {
                            data.pointer("/scope/surface/display_name")
                                .and_then(Value::as_str)
                        });
                    let Some(name) = name else {
                        continue;
                    };
                    let weekly = data["group"] == "weekly" || data["kind"] == "weekly_scoped";
                    (
                        format!("{name}{}", if weekly { " 每周" } else { "" }),
                        if weekly { Some(10080) } else { None },
                    )
                }
            };
            if windows.iter().any(|w| w.label == label) {
                continue;
            }
            if let Some(item) = window(label, &data["percent"], &data["resets_at"], minutes) {
                windows.push(item);
            }
        }
    }
    windows
}

fn retry_after(headers: &reqwest::header::HeaderMap, at: i64) -> Option<i64> {
    let value = headers.get("retry-after")?.to_str().ok()?;
    value
        .parse::<i64>()
        .ok()
        .filter(|s| (1..=604800).contains(s))
        .map(|s| at + s)
        .or_else(|| {
            chrono::DateTime::parse_from_rfc2822(value)
                .ok()
                .map(|date| date.timestamp())
                .filter(|time| *time > at && *time <= at + 604800)
        })
}

#[tauri::command]
pub async fn get_ai_quota(provider: String, force: bool) -> Result<QuotaSnapshot, String> {
    if provider != "codex" && provider != "claude" {
        return Err("不支持的额度来源".into());
    }
    let id = provider.clone();
    let auth = tauri::async_runtime::spawn_blocking(move || login(&id))
        .await
        .map_err(|_| "无法读取登录信息".to_string())?;
    let auth = match auth {
        Ok(auth) => auth,
        Err(message) => {
            // A logout or unreadable identity must not expose another account's old quota.
            if let Ok(mut cache) = CACHE.get_or_init(Default::default).lock() {
                cache.remove(&provider);
            }
            return Ok(empty(&provider, &message));
        }
    };
    let at = now();
    {
        let mut cache = CACHE
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "额度缓存暂不可用")?;
        let item = cache.entry(provider.clone()).or_insert_with(|| Cache {
            identity: auth.identity.clone(),
            snapshot: empty(&provider, "正在读取额度"),
            next_read: 0,
            failures: 0,
            busy: false,
        });
        if item.identity != auth.identity {
            *item = Cache {
                identity: auth.identity.clone(),
                snapshot: empty(&provider, "正在读取额度"),
                next_read: 0,
                failures: 0,
                busy: false,
            };
        }
        if item.busy || (at < item.next_read && (!force || item.failures > 0)) {
            return Ok(item.snapshot.clone());
        }
        item.busy = true;
    }
    let result = fetch(&provider, &auth, at).await;
    let mut cache = CACHE
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "额度缓存暂不可用")?;
    let Some(item) = cache
        .get_mut(&provider)
        .filter(|item| item.identity == auth.identity)
    else {
        return Ok(empty(&provider, "账号已变更，请刷新"));
    };
    item.busy = false;
    match result {
        Ok(snapshot) => {
            item.snapshot = snapshot;
            item.failures = 0;
            item.next_read = now() + 60;
        }
        Err((message, retry)) => {
            item.failures = item.failures.saturating_add(1);
            item.next_read =
                retry.unwrap_or_else(|| now() + (60 * 2i64.pow(item.failures.min(5))).min(1800));
            item.snapshot.status = if item.snapshot.windows.is_empty() {
                "unavailable"
            } else {
                "cached"
            }
            .into();
            item.snapshot.message = message;
            item.snapshot.retry_at = Some(item.next_read);
        }
    }
    Ok(item.snapshot.clone())
}

async fn fetch(
    provider: &str,
    auth: &Login,
    at: i64,
) -> Result<QuotaSnapshot, (String, Option<i64>)> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| ("无法创建额度请求".into(), None))?;
    let url = if provider == "codex" {
        "https://chatgpt.com/backend-api/wham/usage"
    } else {
        "https://api.anthropic.com/api/oauth/usage"
    };
    let mut request = client.get(url).bearer_auth(&auth.token);
    if provider == "codex" {
        if let Some(account) = &auth.account {
            request = request.header("ChatGPT-Account-Id", account);
        }
    } else {
        request = request.header("anthropic-beta", "oauth-2025-04-20");
    }
    let response = request
        .send()
        .await
        .map_err(|_| ("无法连接额度服务，请检查网络或代理".into(), None))?;
    let code = response.status().as_u16();
    if code != 200 {
        let retry = retry_after(response.headers(), now());
        let message = match code {
            401 | 403 => "登录已失效或账号无访问权限，请在对应软件中重新登录".into(),
            429 => "额度服务请求过于频繁，已暂停请求，稍后自动重试".into(),
            _ => format!("额度服务返回 HTTP {code}，稍后重试"),
        };
        return Err((message, retry));
    }
    let root: Value = response
        .json()
        .await
        .map_err(|_| ("无法识别额度服务的响应".into(), None))?;
    let windows = if provider == "codex" {
        parse_codex(&root, at)
    } else {
        parse_claude(&root)
    };
    if windows.is_empty() {
        return Err((
            "服务未返回可用额度，可能是账号不支持或接口已变化".into(),
            None,
        ));
    }
    Ok(QuotaSnapshot {
        provider: provider.into(),
        plan: root["plan_type"]
            .as_str()
            .map(str::to_owned)
            .or(auth.plan.clone()),
        windows,
        status: "online".into(),
        message: "账号额度 · 在线读取".into(),
        updated_at: Some(now()),
        retry_at: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn codex_handles_missing_windows_and_relative_resets() {
        let quotas = parse_codex(
            &json!({"rate_limit": {"primary_window": {
            "used_percent": 29, "limit_window_seconds": 18000, "reset_after_seconds": 600
        }, "secondary_window": null}}),
            1000,
        );
        assert_eq!(quotas.len(), 1);
        assert_eq!(quotas[0].used_percent, 29.0);
        assert_eq!(quotas[0].resets_at, Some(1600));
        assert!(parse_codex(
            &json!({"rate_limit": {"primary_window": {"used_percent": -1}}}),
            0
        )
        .is_empty());
    }
    #[test]
    fn claude_supports_server_driven_windows_and_iso_reset() {
        let quotas = parse_claude(
            &json!({"five_hour": {"utilization": 12.5, "resets_at": "2026-10-31T06:00:00Z"},
            "limits": [{"kind": "session", "percent": 12.5}, {"kind": "weekly_all", "percent": 42}]}),
        );
        assert_eq!(quotas.len(), 2);
        assert!(quotas[0].resets_at.is_some());
        assert_eq!(quotas[1].used_percent, 42.0);
    }
    #[test]
    fn retry_after_is_bounded_and_preserved() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("retry-after", "300".parse().unwrap());
        assert_eq!(retry_after(&headers, 1000), Some(1300));
        headers.insert("retry-after", "999999999".parse().unwrap());
        assert_eq!(retry_after(&headers, 1000), None);
    }

    #[test]
    #[ignore = "Reads the current Codex sign-in and performs one live quota request"]
    fn live_codex_quota_smoke() {
        let snapshot = tauri::async_runtime::block_on(get_ai_quota("codex".into(), true)).unwrap();
        // Only quota metadata is returned; tokens and conversations never leave this module.
        assert_eq!(snapshot.status, "online", "{}", snapshot.message);
        assert!(!snapshot.windows.is_empty());
    }
}
