// Custom Rust/React implementation, with design/reference adaptations from BrimDeck.
// Modified by Gogowu contributors, 2026. See THIRD_PARTY_NOTICES.md and licenses/BrimDeck-Apache-2.0.txt.
use crate::gpu_monitor::{GpuMonitor, GpuSample};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use sysinfo::{Networks, ProcessRefreshKind, ProcessesToUpdate, System};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSample {
    name: String,
    count: usize,
    cpu: f32,
    memory: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSample {
    name: String,
    down: f64,
    up: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSnapshot {
    cpu: f32,
    cores: Vec<f32>,
    memory_used: u64,
    memory_total: u64,
    networks: Vec<NetworkSample>,
    gpus: Vec<GpuSample>,
    processes: Vec<ProcessSample>,
}

struct Sampler {
    system: System,
    networks: Networks,
    gpu: GpuMonitor,
    last_read: Instant,
}

impl Sampler {
    fn new() -> Self {
        let mut system = System::new();
        system.refresh_cpu_usage();
        system.refresh_processes_specifics(ProcessesToUpdate::All, true, process_refresh());
        Self {
            system,
            networks: Networks::new_with_refreshed_list(),
            gpu: GpuMonitor::new(),
            last_read: Instant::now(),
        }
    }

    fn read(&mut self, sort: &str) -> MonitorSnapshot {
        // Usage counters need two samples. Also re-prime after the panel was closed.
        if self.last_read.elapsed() > Duration::from_secs(5) {
            self.system.refresh_cpu_usage();
            self.system.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                process_refresh(),
            );
            self.networks.refresh(true);
            self.gpu.prime();
            self.last_read = Instant::now();
        }
        let elapsed = self.last_read.elapsed();
        if elapsed < Duration::from_millis(300) {
            std::thread::sleep(Duration::from_millis(300) - elapsed);
        }
        let seconds = self.last_read.elapsed().as_secs_f64().max(0.001);
        self.last_read = Instant::now();
        self.system.refresh_cpu_usage();
        self.system.refresh_memory();
        self.system
            .refresh_processes_specifics(ProcessesToUpdate::All, true, process_refresh());
        self.networks.refresh(true);
        let logical_count = self.system.cpus().len().max(1) as f32;
        let mut grouped: HashMap<String, ProcessSample> = HashMap::new();
        for process in self.system.processes().values() {
            if process.pid().as_u32() == 0 {
                continue;
            }
            let name = process.name().to_string_lossy().to_string();
            let entry = grouped
                .entry(name.to_lowercase())
                .or_insert_with(|| ProcessSample {
                    name: name.trim_end_matches(".exe").to_string(),
                    count: 0,
                    cpu: 0.0,
                    memory: 0,
                });
            entry.count += 1;
            entry.cpu += process.cpu_usage() / logical_count;
            entry.memory = entry.memory.saturating_add(process.memory());
        }
        let mut processes: Vec<_> = grouped.into_values().collect();
        if sort == "cpu" {
            processes.sort_by(|a, b| b.cpu.total_cmp(&a.cpu));
        } else {
            processes.sort_by(|a, b| b.memory.cmp(&a.memory));
        }
        processes.truncate(6);
        let mut networks: Vec<_> = self
            .networks
            .iter()
            .filter(|(name, _)| !name.to_lowercase().contains("loopback"))
            .map(|(name, data)| NetworkSample {
                name: name.clone(),
                down: data.received() as f64 / seconds,
                up: data.transmitted() as f64 / seconds,
            })
            .collect();
        networks.sort_by(|a, b| a.name.cmp(&b.name));
        MonitorSnapshot {
            cpu: self.system.global_cpu_usage(),
            cores: self
                .system
                .cpus()
                .iter()
                .map(|cpu| cpu.cpu_usage())
                .collect(),
            memory_used: self.system.used_memory(),
            memory_total: self.system.total_memory(),
            networks,
            gpus: self.gpu.read(),
            processes,
        }
    }
}

fn process_refresh() -> ProcessRefreshKind {
    ProcessRefreshKind::nothing().with_cpu().with_memory()
}

static SAMPLER: OnceLock<Mutex<Sampler>> = OnceLock::new();

#[tauri::command]
pub async fn get_system_monitor(sort: String) -> Result<MonitorSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut sampler = SAMPLER
            .get_or_init(|| Mutex::new(Sampler::new()))
            .lock()
            .map_err(|_| "性能采集暂不可用".to_string())?;
        Ok(sampler.read(&sort))
    })
    .await
    .map_err(|_| "性能采集任务失败".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn live_monitor_has_real_memory_and_bounded_cpu() {
        let mut sampler = Sampler::new();
        let sample = sampler.read("memory");
        assert!(sample.memory_total > 0);
        assert!(sample.memory_used <= sample.memory_total);
        assert!(!sample.cores.is_empty());
        assert!((0.0..=100.0).contains(&sample.cpu));
        assert!(sample
            .processes
            .windows(2)
            .all(|pair| pair[0].memory >= pair[1].memory));
        assert!(sample
            .networks
            .iter()
            .all(|n| n.down.is_finite() && n.up.is_finite()));
    }
}
