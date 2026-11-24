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
            id: Uuid::new_v4().to_string(),
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
}
