// Modified by Gogowu contributors, 2026. BrimDeck design references adapted for Rust/DXGI.
// Apache-2.0; see THIRD_PARTY_NOTICES.md and licenses/BrimDeck-Apache-2.0.txt.
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
};

#[derive(Clone, Serialize)]
pub struct GpuSample {
    pub id: String,
    pub name: String,
    pub usage: Option<f64>,
}

// Device identity comes from DXGI, never from the number or order of PDH
// instances. One adapter can expose many processes, engines and physical nodes.
fn adapters() -> Vec<GpuSample> {
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return vec![];
    };
    let mut result = Vec::new();
    for index in 0..64 {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(index) }) else {
            break;
        };
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else {
            continue;
        };
        if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
            continue;
        }
        let luid =
            ((desc.AdapterLuid.HighPart as u32 as u64) << 32) | desc.AdapterLuid.LowPart as u64;
        let id = format!("{luid:016x}");
        if result.iter().any(|gpu: &GpuSample| gpu.id == id) {
            continue;
        }
        let length = desc
            .Description
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(desc.Description.len());
        let name = String::from_utf16_lossy(&desc.Description[..length]);
        result.push(GpuSample {
            id,
            name: if name.trim().is_empty() {
                "Display adapter".into()
            } else {
                name
            },
            usage: None,
        });
    }
    result
}

// PDH names have independent pid/luid/phys/eng segments. In particular, phys
// must not become part of adapter identity, and LUID hex padding can vary.
fn engine_identity(name: &str) -> Option<(u64, u32, u32)> {
    let parts: Vec<_> = name.split('_').collect();
    let field = |key: &str| parts.iter().position(|part| *part == key);
    let i = field("luid")?;
    let hex = |s: &str| {
        u32::from_str_radix(s.strip_prefix("0x").or_else(|| s.strip_prefix("0X"))?, 16).ok()
    };
    let high = hex(parts.get(i + 1)?)?;
    let low = hex(parts.get(i + 2)?)?;
    let phys = parts.get(field("phys")? + 1)?.parse().ok()?;
    let engine = parts.get(field("eng")? + 1)?.parse().ok()?;
    Some((((high as u64) << 32) | low as u64, phys, engine))
}

fn aggregate(readings: impl IntoIterator<Item = (String, f64)>) -> HashMap<u64, f64> {
    let mut engines: HashMap<(u64, u32, u32), f64> = HashMap::new();
    for (name, value) in readings {
        if value.is_finite() && value >= 0.0 {
            if let Some(key) = engine_identity(&name) {
                *engines.entry(key).or_default() += value;
            }
        }
    }
    let mut usage: HashMap<u64, f64> = HashMap::new();
    for ((luid, _, _), value) in engines {
        let entry = usage.entry(luid).or_default();
        *entry = entry.max(value.clamp(0.0, 100.0));
    }
    usage
}

pub struct GpuMonitor {
    query: isize,
    counter: isize,
    devices: Vec<GpuSample>,
    monitorable: HashSet<String>,
    enumerated_at: Instant,
}

#[repr(C)]
struct CounterValue {
    status: u32,
    value: f64,
}
#[repr(C)]
struct CounterItem {
    name: *const u16,
    value: CounterValue,
}

#[link(name = "pdh")]
unsafe extern "system" {
    fn PdhOpenQueryW(source: *const u16, data: usize, query: *mut isize) -> u32;
    fn PdhAddEnglishCounterW(
        query: isize,
        path: *const u16,
        data: usize,
        counter: *mut isize,
    ) -> u32;
    fn PdhCollectQueryData(query: isize) -> u32;
    fn PdhGetFormattedCounterArrayW(
        counter: isize,
        format: u32,
        size: *mut u32,
        count: *mut u32,
        items: *mut CounterItem,
    ) -> u32;
    fn PdhCloseQuery(query: isize) -> u32;
}

impl GpuMonitor {
    pub fn new() -> Self {
        let mut monitor = Self {
            query: 0,
            counter: 0,
            devices: adapters(),
            monitorable: HashSet::new(),
            enumerated_at: Instant::now(),
        };
        let path: Vec<u16> = "\\GPU Engine(*)\\Utilization Percentage\0"
            .encode_utf16()
            .collect();
        unsafe {
            if PdhOpenQueryW(std::ptr::null(), 0, &mut monitor.query) == 0
                && PdhAddEnglishCounterW(monitor.query, path.as_ptr(), 0, &mut monitor.counter) != 0
            {
                monitor.counter = 0;
            }
        }
        monitor.prime();
        monitor
    }

    pub fn prime(&self) {
        if self.query != 0 {
            unsafe {
                PdhCollectQueryData(self.query);
            }
        }
    }

    pub fn read(&mut self) -> Vec<GpuSample> {
        if self.enumerated_at.elapsed() >= Duration::from_secs(30) {
            self.devices = adapters();
            self.enumerated_at = Instant::now();
        }
        self.prime();
        let usage = aggregate(self.read_counters());
        self.devices
            .iter()
            .filter_map(|gpu| {
                let mut sample = gpu.clone();
                sample.usage = u64::from_str_radix(&gpu.id, 16)
                    .ok()
                    .and_then(|luid| usage.get(&luid).copied());
                if sample.usage.is_some() {
                    self.monitorable.insert(gpu.id.clone());
                }
                // DXGI can also enumerate indirect/virtual adapters without GPU
                // engine counters. Do not present these as additional GPUs.
                self.monitorable.contains(&gpu.id).then_some(sample)
            })
            .collect()
    }

    fn read_counters(&self) -> Vec<(String, f64)> {
        if self.counter == 0 {
            return vec![];
        }
        let mut size = 0;
        let mut count = 0;
        let format = 0x200 | 0x8000; // PDH_FMT_DOUBLE | PDH_FMT_NOCAP100
        unsafe {
            PdhGetFormattedCounterArrayW(
                self.counter,
                format,
                &mut size,
                &mut count,
                std::ptr::null_mut(),
            );
        }
        if size == 0 || size > 16 * 1024 * 1024 {
            return vec![];
        }
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        let items = buffer.as_mut_ptr().cast::<CounterItem>();
        let status = unsafe {
            PdhGetFormattedCounterArrayW(self.counter, format, &mut size, &mut count, items)
        };
        if status != 0 || count as usize * std::mem::size_of::<CounterItem>() > buffer.len() * 8 {
            return vec![];
        }
        let start = buffer.as_ptr() as usize;
        let end = start + buffer.len() * 8;
        let mut readings = Vec::new();
        for item in unsafe { std::slice::from_raw_parts(items, count as usize) } {
            let address = item.name as usize;
            if item.value.status > 1 || address < start || address >= end || address % 2 != 0 {
                continue;
            }
            let capacity = ((end - address) / 2).min(4096);
            let name = unsafe { std::slice::from_raw_parts(item.name, capacity) };
            let Some(length) = name.iter().position(|c| *c == 0) else {
                continue;
            };
            readings.push((String::from_utf16_lossy(&name[..length]), item.value.value));
        }
        readings
    }
}

impl Drop for GpuMonitor {
    fn drop(&mut self) {
        if self.query != 0 {
            unsafe {
                PdhCloseQuery(self.query);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nodes_engines_and_processes_do_not_create_extra_adapters() {
        let readings = [
            (
                "pid_1_luid_0x00000000_0x0000abcd_phys_0_eng_0_engtype_3D",
                20.0,
            ),
            ("pid_2_luid_0x0_0xabcd_phys_0_eng_0_engtype_3D", 10.0),
            ("pid_1_luid_0x0_0xabcd_phys_1_eng_0_engtype_3D", 15.0),
            ("pid_1_luid_0x0_0xabcd_phys_0_eng_1_engtype_Copy", 8.0),
            (
                "pid_1_luid_0xffffffff_0x00001234_phys_0_eng_0_engtype_3D",
                42.0,
            ),
            ("invalid", 90.0),
        ];
        let result = aggregate(readings.into_iter().map(|(n, v)| (n.into(), v)));
        assert_eq!(result.len(), 2);
        assert_eq!(result[&0xabcd], 30.0);
        assert_eq!(result[&0xffffffff00001234], 42.0);
        assert!(aggregate([(readings[0].0.into(), f64::NAN)]).is_empty());
    }

    #[test]
    fn live_samples_only_contain_named_dxgi_adapters() {
        let inventory = adapters();
        let mut monitor = GpuMonitor::new();
        std::thread::sleep(Duration::from_millis(350));
        let samples = monitor.read();
        assert!(samples.len() <= inventory.len());
        for gpu in &samples {
            assert!(inventory
                .iter()
                .any(|known| known.id == gpu.id && known.name == gpu.name));
            assert!(!gpu.name.is_empty());
            assert!(gpu.usage.is_none_or(|value| (0.0..=100.0).contains(&value)));
        }
        println!(
            "Named GPU samples: {}",
            serde_json::to_string(&samples).unwrap()
        );
    }
}
