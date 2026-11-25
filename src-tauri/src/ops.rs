use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use crate::{
    domain::{
        AppError, DiffStatus, DockerContainer, FileDiffEntry, LocalEntry, ProcessDetail,
        SystemdUnit,
    },
    sessions::SessionManager,
};

pub fn local_quick_paths() -> Vec<(String, String)> {
    let mut items = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let home_path = PathBuf::from(&home);
        items.push(("主目录".into(), home_path.to_string_lossy().into_owned()));
        let desktop = home_path.join("Desktop");
        if desktop.is_dir() {
            items.push(("桌面".into(), desktop.to_string_lossy().into_owned()));
        }
        let downloads = home_path.join("Downloads");
        if downloads.is_dir() {
            items.push(("下载".into(), downloads.to_string_lossy().into_owned()));
        }
    }
    #[cfg(windows)]
    {
        for letter in b'C'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            if Path::new(&root).exists() {
                items.push((format!("{} 盘", letter as char), root));
            }
        }
    }
    items
}

pub fn list_local_directory(path: &str) -> Result<(String, Vec<LocalEntry>), AppError> {
    let resolved = if path.trim().is_empty() {
        std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    } else {
        PathBuf::from(path)
    };
    if !resolved.is_dir() {
        return Err(AppError::Validation("本地目录不存在".into()));
    }

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&resolved)? {
        let Ok(entry) = entry else { continue };
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        entries.push(LocalEntry {
            name,
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            modified_at,
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok((resolved.to_string_lossy().into_owned(), entries))
}

pub async fn compare_local_remote(
    sessions: &SessionManager,
    session_id: &str,
    local_dir: &str,
    remote_dir: &str,
) -> Result<Vec<FileDiffEntry>, AppError> {
    let (_, local_entries) = list_local_directory(local_dir)?;
    let remote_entries = sessions.list_directory(session_id, remote_dir).await?;

    let mut local_map: HashMap<String, LocalEntry> = HashMap::new();
    for item in local_entries {
        local_map.insert(item.name.clone(), item);
    }

    let mut remote_map = HashMap::new();
    for item in remote_entries {
        if item.name == "." || item.name == ".." {
            continue;
        }
        remote_map.insert(item.name.clone(), item);
    }

    let mut names = local_map
        .keys()
        .chain(remote_map.keys())
        .cloned()
        .collect::<Vec<_>>();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();

    let mut diffs = Vec::with_capacity(names.len());
    for name in names {
        let local = local_map.remove(&name);
        let remote = remote_map.remove(&name);
        let is_dir = local.as_ref().is_some_and(|l| l.is_dir)
            || remote.as_ref().is_some_and(|r| r.is_dir);

        let status = match (&local, &remote) {
            (Some(_), None) => DiffStatus::OnlyLocal,
            (None, Some(_)) => DiffStatus::OnlyRemote,
            (Some(l), Some(r)) => {
                if (l.is_dir && r.is_dir) || (!l.is_dir && !r.is_dir && l.size == r.size) {
                    DiffStatus::Same
                } else if l.is_dir != r.is_dir {
                    DiffStatus::SizeDiff
                } else if let (Some(lm), Some(rm)) = (l.modified_at, r.modified_at) {
                    if lm > rm + 2 {
                        DiffStatus::NewerLocal
                    } else if rm > lm + 2 {
                        DiffStatus::NewerRemote
                    } else {
                        DiffStatus::SizeDiff
                    }
                } else {
                    DiffStatus::SizeDiff
                }
            }
            (None, None) => continue,
        };

        diffs.push(FileDiffEntry {
            name,
            is_dir,
            local_path: local.as_ref().map(|l| l.path.clone()),
            remote_path: remote.as_ref().map(|r| r.path.clone()),
            local_size: local.as_ref().map(|l| l.size),
            remote_size: remote.as_ref().map(|r| r.size),
            local_modified_at: local.and_then(|l| l.modified_at),
            remote_modified_at: remote.and_then(|r| r.modified_at),
            status,
        });
    }

    diffs.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(diffs)
}

pub async fn list_processes_detailed(
    sessions: &SessionManager,
    session_id: &str,
) -> Result<Vec<ProcessDetail>, AppError> {
    let raw = sessions
        .exec_command(
            session_id,
            "ps -eo pid=,user=,pcpu=,rss=,stat=,args= --sort=-pcpu | head -n 120",
        )
        .await?;
    let mut list = Vec::new();
    for line in raw.lines() {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 6 {
            continue;
        }
        let Ok(pid) = parts[0].parse::<u32>() else {
            continue;
        };
        let user = parts[1].to_owned();
        let cpu_percent = parts[2].parse::<f32>().unwrap_or(0.0);
        let memory_bytes = parts[3].parse::<u64>().unwrap_or(0) * 1024;
        let stat = parts[4].to_owned();
        let command = parts[5..].join(" ");
        list.push(ProcessDetail {
            pid,
            user,
            cpu_percent,
            memory_bytes,
            stat,
            command,
        });
    }
    Ok(list)
}

pub async fn kill_process(
    sessions: &SessionManager,
    session_id: &str,
    pid: u32,
    force: bool,
) -> Result<(), AppError> {
    if pid <= 1 {
        return Err(AppError::Validation("禁止结束 PID <= 1 的关键系统进程".into()));
    }
    let signal = if force { "-9" } else { "-15" };
    sessions
        .exec_command(session_id, &format!("kill {signal} {pid}"))
        .await?;
    Ok(())
}

fn validate_unit_name(unit: &str) -> Result<(), AppError> {
    if unit.is_empty()
        || !unit
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '@' | '.' | '_' | ':' | '-'))
    {
        return Err(AppError::Validation("服务名称格式无效".into()));
    }
    Ok(())
}

pub async fn list_systemd_services(
    sessions: &SessionManager,
    session_id: &str,
) -> Result<Vec<SystemdUnit>, AppError> {
    let raw = sessions
        .exec_command(
            session_id,
            "systemctl list-units --type=service --all --no-pager --plain --no-legend 2>/dev/null | head -n 180",
        )
        .await?;
    let mut units = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut fields = line.split_whitespace();
        let Some(unit) = fields.next() else { continue };
        let Some(load) = fields.next() else { continue };
        let Some(active) = fields.next() else { continue };
        let Some(sub) = fields.next() else { continue };
        let description = fields.collect::<Vec<_>>().join(" ");
        units.push(SystemdUnit {
            unit: unit.to_owned(),
            load: load.to_owned(),
            active: active.to_owned(),
            sub: sub.to_owned(),
            description,
        });
    }
    Ok(units)
}

pub async fn control_systemd_service(
    sessions: &SessionManager,
    session_id: &str,
    unit: &str,
    action: &str,
) -> Result<(), AppError> {
    validate_unit_name(unit)?;
    if !matches!(action, "start" | "stop" | "restart" | "reload") {
        return Err(AppError::Validation("不支持的服务操作".into()));
    }
    sessions
        .exec_command(session_id, &format!("systemctl {action} {unit}"))
        .await?;
    Ok(())
}

pub async fn read_systemd_logs(
    sessions: &SessionManager,
    session_id: &str,
    unit: &str,
    lines: u16,
) -> Result<String, AppError> {
    validate_unit_name(unit)?;
    let count = lines.clamp(20, 500);
    sessions
        .exec_command(
            session_id,
            &format!("journalctl -u {unit} -n {count} --no-pager 2>&1"),
        )
        .await
}

fn validate_container_id(id: &str) -> Result<(), AppError> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
    {
        return Err(AppError::Validation("容器 ID 或名称格式无效".into()));
    }
    Ok(())
}

pub async fn list_docker_containers(
    sessions: &SessionManager,
    session_id: &str,
) -> Result<Vec<DockerContainer>, AppError> {
    let raw = sessions
        .exec_command(
            session_id,
            "docker ps -a --format '{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.State}}\\t{{.Ports}}' 2>/dev/null",
        )
        .await?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }

    let stats_raw = sessions
        .exec_command(
            session_id,
            "docker stats --no-stream --format '{{.ID}}\\t{{.CPUPerc}}\\t{{.MemUsage}}' 2>/dev/null",
        )
        .await
        .unwrap_or_default();

    let mut stats_map: HashMap<String, (String, String)> = HashMap::new();
    for line in stats_raw.lines() {
        let cols = line.split('\t').collect::<Vec<_>>();
        if cols.len() >= 3 {
            stats_map.insert(
                cols[0].trim().to_owned(),
                (cols[1].trim().to_owned(), cols[2].trim().to_owned()),
            );
        }
    }

    let mut containers = Vec::new();
    for line in raw.lines() {
        let cols = line.split('\t').collect::<Vec<_>>();
        if cols.len() < 5 {
            continue;
        }
        let id = cols[0].trim().to_owned();
        let (cpu_percent, memory_usage) = stats_map
            .get(&id)
            .cloned()
            .unwrap_or_else(|| ("—".into(), "—".into()));
        containers.push(DockerContainer {
            id,
            name: cols[1].trim().to_owned(),
            image: cols[2].trim().to_owned(),
            status: cols[3].trim().to_owned(),
            state: cols[4].trim().to_owned(),
            cpu_percent,
            memory_usage,
            ports: cols.get(5).copied().unwrap_or("").trim().to_owned(),
        });
    }
    Ok(containers)
}

pub async fn control_docker_container(
    sessions: &SessionManager,
    session_id: &str,
    container_id: &str,
    action: &str,
) -> Result<(), AppError> {
    validate_container_id(container_id)?;
    if !matches!(action, "start" | "stop" | "restart") {
        return Err(AppError::Validation("不支持的容器操作".into()));
    }
    sessions
        .exec_command(session_id, &format!("docker {action} {container_id}"))
        .await?;
    Ok(())
}

pub async fn read_docker_logs(
    sessions: &SessionManager,
    session_id: &str,
    container_id: &str,
    tail: u16,
) -> Result<String, AppError> {
    validate_container_id(container_id)?;
    let count = tail.clamp(20, 500);
    sessions
        .exec_command(
            session_id,
            &format!("docker logs --tail {count} {container_id} 2>&1"),
        )
        .await
}
