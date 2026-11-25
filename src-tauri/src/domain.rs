use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("本地存储错误：{0}")]
    Storage(String),
    #[error("凭据错误：{0}")]
    Credential(String),
    #[error("此连接尚未保存登录密码，请输入密码后继续")]
    PasswordRequired,
    #[error("用户名或密码不正确，请重新输入")]
    AuthenticationFailed,
    #[error("SSH 错误：{0}")]
    Ssh(String),
    #[error("SFTP 错误：{0}")]
    Sftp(String),
    #[error("会话不存在或已关闭")]
    SessionNotFound,
    #[error("服务器主机密钥需要确认")]
    HostKeyConfirmation(HostKeyInfo),
    #[error("本地文件错误：{0}")]
    Io(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::HostKeyConfirmation(info) => info.serialize(serializer),
            _ => serializer.serialize_str(&self.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct HostKeyInfo {
    pub code: &'static str,
    pub algorithm: String,
    pub fingerprint: String,
    pub host_key: String,
    pub changed: bool,
    pub previous_fingerprint: Option<String>,
}

impl From<russh::Error> for AppError {
    fn from(value: russh::Error) -> Self {
        match value {
            russh::Error::SendError => Self::Ssh("连接已断开，请重新连接".into()),
            error => Self::Ssh(error.to_string()),
        }
    }
}

impl From<russh_sftp::client::error::Error> for AppError {
    fn from(value: russh_sftp::client::error::Error) -> Self {
        Self::Sftp(value.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthKind {
    Password,
    PrivateKey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthKind,
    pub private_key_path: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionDraft {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthKind,
    pub private_key_path: Option<String>,
}

impl ConnectionProfile {
    pub fn from_draft(draft: ConnectionDraft) -> Result<Self, AppError> {
        Self::with_id(Uuid::new_v4().to_string(), draft)
    }

    pub fn with_id(id: String, draft: ConnectionDraft) -> Result<Self, AppError> {
        let name = draft.name.trim();
        let host = Self::normalize_host(&draft.host);
        let username = draft.username.trim();
        if name.is_empty() || host.is_empty() || username.is_empty() {
            return Err(AppError::Validation("名称、主机和用户名不能为空".into()));
        }
        if host.chars().any(char::is_whitespace) {
            return Err(AppError::Validation("主机名不能包含空格".into()));
        }
        if draft.port == 0 {
            return Err(AppError::Validation("端口必须在 1–65535 之间".into()));
        }
        if draft.auth == AuthKind::PrivateKey
            && draft
                .private_key_path
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
        {
            return Err(AppError::Validation("请选择私钥文件".into()));
        }
        Ok(Self {
            id,
            name: name.to_owned(),
            host,
            port: draft.port,
            username: username.to_owned(),
            auth: draft.auth,
            private_key_path: draft.private_key_path,
            updated_at: chrono::Utc::now().timestamp(),
        })
    }

    pub(crate) fn normalize_host(host: &str) -> String {
        host.trim()
            .trim_start_matches("http://")
            .trim_start_matches("https://")
            .trim_end_matches('/')
            .to_owned()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ConnectionMeta {
    pub group: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub sort_order: i64,
    pub connect_timeout_secs: Option<u64>,
    pub auto_reconnect: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub command: String,
    pub timestamp: i64,
    pub server_id: String,
    pub server_name: String,
    pub host: String,
    pub outcome: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandSnippet {
    pub id: String,
    pub name: String,
    pub command: String,
    pub group: String,
    pub shortcut: Option<String>,
    pub description: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct MetricsVisibility {
    pub cpu: bool,
    pub memory: bool,
    pub swap: bool,
    pub network: bool,
    pub disk: bool,
    pub processes: bool,
    pub mounts: bool,
}

impl Default for MetricsVisibility {
    fn default() -> Self {
        Self {
            cpu: true,
            memory: true,
            swap: true,
            network: true,
            disk: true,
            processes: true,
            mounts: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AlertRule {
    pub id: String,
    pub metric: String,
    pub threshold: f32,
    pub cooldown_secs: u64,
    pub enabled: bool,
}

impl Default for AlertRule {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            metric: "cpu".into(),
            threshold: 85.0,
            cooldown_secs: 60,
            enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TerminalSettings {
    pub language: String,
    pub close_action: String,
    pub local_shell_privilege: String,
    pub auto_check_updates: bool,
    pub font_family: String,
    pub font_size: u16,
    pub theme: String,
    pub copy_on_select: bool,
    pub right_click_paste: bool,
    pub auto_reconnect: bool,
    pub reconnect_max_attempts: u8,
    pub connect_timeout_secs: u64,
    pub metrics_interval_secs: u64,
    pub metrics_process_limit: usize,
    pub metrics_warn_percent: f32,
    pub metrics_danger_percent: f32,
    pub metrics_visible: MetricsVisibility,
    pub metrics_collapsed: Vec<String>,
    pub create_backup_on_edit: bool,
    pub verify_transfer_checksum: bool,
    pub alert_rules: Vec<AlertRule>,
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            language: "zh-CN".into(),
            close_action: "ask".into(),
            local_shell_privilege: "ask".into(),
            auto_check_updates: true,
            font_family: "\"Cascadia Mono\", Consolas, monospace".into(),
            font_size: 14,
            theme: "obsidian-emerald".into(),
            copy_on_select: false,
            right_click_paste: true,
            auto_reconnect: true,
            reconnect_max_attempts: 3,
            connect_timeout_secs: 15,
            metrics_interval_secs: 2,
            metrics_process_limit: 6,
            metrics_warn_percent: 75.0,
            metrics_danger_percent: 90.0,
            metrics_visible: MetricsVisibility::default(),
            metrics_collapsed: Vec::new(),
            create_backup_on_edit: true,
            verify_transfer_checksum: true,
            alert_rules: vec![
                AlertRule {
                    id: "alert-cpu".into(),
                    metric: "cpu".into(),
                    threshold: 85.0,
                    cooldown_secs: 60,
                    enabled: true,
                },
                AlertRule {
                    id: "alert-mem".into(),
                    metric: "memory".into(),
                    threshold: 90.0,
                    cooldown_secs: 60,
                    enabled: true,
                },
                AlertRule {
                    id: "alert-disk".into(),
                    metric: "disk".into(),
                    threshold: 90.0,
                    cooldown_secs: 120,
                    enabled: true,
                },
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalShellKind {
    PowerShell,
    Cmd,
    Wsl,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransferStatus {
    Queued,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictPolicy {
    Ask,
    Overwrite,
    Skip,
    Rename,
    Resume,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferTask {
    pub id: String,
    pub session_id: String,
    pub direction: TransferDirection,
    pub local_path: String,
    pub remote_path: String,
    pub file_name: String,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub speed_bps: u64,
    pub eta_seconds: Option<u64>,
    pub status: TransferStatus,
    pub error: Option<String>,
    pub checksum_verified: Option<bool>,
    pub checksum_detail: Option<String>,
    pub conflict_policy: ConflictPolicy,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransferConflict {
    pub local_path: String,
    pub remote_path: String,
    pub file_name: String,
    pub source_size: u64,
    pub target_size: u64,
    pub source_modified_at: Option<i64>,
    pub target_modified_at: Option<i64>,
    pub part_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffStatus {
    Same,
    NewerLocal,
    NewerRemote,
    SizeDiff,
    OnlyLocal,
    OnlyRemote,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileDiffEntry {
    pub name: String,
    pub is_dir: bool,
    pub local_path: Option<String>,
    pub remote_path: Option<String>,
    pub local_size: Option<u64>,
    pub remote_size: Option<u64>,
    pub local_modified_at: Option<i64>,
    pub remote_modified_at: Option<i64>,
    pub status: DiffStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForwardKind {
    Local,
    Remote,
    Dynamic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForwardRuleDraft {
    pub kind: ForwardKind,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
}

#[derive(Debug, Clone, Serialize)]
pub struct ForwardRuleInfo {
    pub id: String,
    pub session_id: String,
    pub kind: ForwardKind,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub active: bool,
    pub active_connections: u64,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessDetail {
    pub pid: u32,
    pub user: String,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub stat: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemdUnit {
    pub unit: String,
    pub load: String,
    pub active: String,
    pub sub: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub cpu_percent: String,
    pub memory_usage: String,
    pub ports: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct WorkbenchState {
    pub schema_version: u32,
    pub connection_meta: std::collections::HashMap<String, ConnectionMeta>,
    pub history: Vec<HistoryEntry>,
    pub snippets: Vec<CommandSnippet>,
    pub settings: TerminalSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedConnection {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthKind,
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub meta: ConnectionMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionBundle {
    pub schema_version: u32,
    pub exported_at: i64,
    pub connections: Vec<ExportedConnection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Connecting,
    Authenticating,
    Connected,
    Closed,
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: Option<i64>,
    pub permissions: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemMetrics {
    pub hostname: String,
    pub system: String,
    pub cpu_percent: Option<f32>,
    pub memory_percent: f32,
    pub memory_used: u64,
    pub memory_total: u64,
    pub load_average: [f32; 3],
    pub disk_percent: f32,
    pub disk_used: u64,
    pub disk_total: u64,
    pub uptime_seconds: u64,
    pub swap_percent: f32,
    pub swap_used: u64,
    pub swap_total: u64,
    pub network_receive_bytes: u64,
    pub network_transmit_bytes: u64,
    pub processes: Vec<ProcessMetric>,
    pub mounts: Vec<MountMetric>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessMetric {
    pub name: String,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MountMetric {
    pub path: String,
    pub available: u64,
    pub total: u64,
    pub percent: f32,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft() -> ConnectionDraft {
        ConnectionDraft {
            name: "测试机".into(),
            host: "127.0.0.1".into(),
            port: 22,
            username: "dev".into(),
            auth: AuthKind::Password,
            private_key_path: None,
        }
    }

    #[test]
    fn profile_does_not_contain_password() {
        let json = serde_json::to_value(ConnectionProfile::from_draft(draft()).unwrap()).unwrap();
        let object = json.as_object().unwrap();
        assert!(!object.contains_key("password"));
        assert!(!object.contains_key("credential"));
        assert!(!object.contains_key("secret"));
    }

    #[test]
    fn rejects_invalid_host() {
        let mut input = draft();
        input.host = "example .com".into();
        assert!(ConnectionProfile::from_draft(input).is_err());
    }

    #[test]
    fn strips_accidental_web_scheme() {
        let mut input = draft();
        input.host = "http://example.com/".into();
        assert_eq!(
            ConnectionProfile::from_draft(input).unwrap().host,
            "example.com"
        );
    }

    #[test]
    fn password_errors_have_actionable_chinese_messages() {
        assert!(AppError::PasswordRequired.to_string().contains("输入密码"));
        assert!(AppError::AuthenticationFailed
            .to_string()
            .contains("重新输入"));
    }

    #[test]
    fn settings_deserialize_defaults_for_new_fields() {
        let legacy = r#"{"language":"en","font_size":15}"#;
        let parsed: TerminalSettings = serde_json::from_str(legacy).unwrap();
        assert_eq!(parsed.language, "en");
        assert_eq!(parsed.font_size, 15);
        assert_eq!(parsed.close_action, "ask");
        assert_eq!(parsed.local_shell_privilege, "ask");
        assert!(parsed.auto_check_updates);
    }
}
