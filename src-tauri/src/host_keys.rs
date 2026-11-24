use std::{collections::HashMap, path::PathBuf, sync::Mutex};

use russh::keys::PublicKey;

use crate::{domain::AppError, store::replace_file};

pub struct HostKeyStore {
    path: PathBuf,
    keys: Mutex<HashMap<String, String>>,
}

impl HostKeyStore {
    pub fn open(directory: PathBuf) -> Result<Self, AppError> {
        std::fs::create_dir_all(&directory).map_err(storage)?;
        let path = directory.join("known_hosts");
        let keys = if path.exists() {
            parse(&std::fs::read_to_string(&path).map_err(storage)?)?
        } else {
            HashMap::new()
        };
        Ok(Self {
            path,
            keys: Mutex::new(keys),
        })
    }

    pub fn get(&self, host: &str, port: u16) -> Option<String> {
        self.keys
            .lock()
            .expect("主机密钥锁不可用")
            .get(&endpoint(host, port))
            .cloned()
    }

    pub fn save(&self, host: &str, port: u16, key: &str) -> Result<(), AppError> {
        let key = PublicKey::from_openssh(key)
            .map_err(|error| AppError::Validation(format!("主机公钥无效：{error}")))?;
        let mut keys = self.keys.lock().expect("主机密钥锁不可用");
        keys.insert(endpoint(host, port), key.to_openssh().map_err(ssh)?);
        let text = keys
            .iter()
            .map(|(endpoint, key)| format!("{endpoint} {key}\n"))
            .collect::<String>();
        let temp = self.path.with_extension("tmp");
        std::fs::write(&temp, text).map_err(storage)?;
        replace_file(&temp, &self.path)
    }
}

fn endpoint(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_owned()
    } else {
        format!("[{host}]:{port}")
    }
}

fn parse(text: &str) -> Result<HashMap<String, String>, AppError> {
    let mut keys = HashMap::new();
    for (index, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut fields = line.split_whitespace();
        let endpoint = fields.next().unwrap_or_default();
        let key = fields.collect::<Vec<_>>().join(" ");
        PublicKey::from_openssh(&key).map_err(|error| {
            AppError::Storage(format!("known_hosts 第 {} 行无效：{error}", index + 1))
        })?;
        keys.insert(endpoint.to_owned(), key);
    }
    Ok(keys)
}

fn storage(error: std::io::Error) -> AppError {
    AppError::Storage(error.to_string())
}

fn ssh(error: russh::keys::ssh_key::Error) -> AppError {
    AppError::Ssh(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_default_port_has_distinct_endpoint() {
        assert_eq!(endpoint("server", 22), "server");
        assert_eq!(endpoint("server", 2222), "[server]:2222");
    }

    #[test]
    fn missing_file_is_empty() {
        let directory = tempfile::tempdir().unwrap();
        let store = HostKeyStore::open(directory.path().join("nested")).unwrap();
        assert_eq!(store.get("server", 22), None);
        assert!(!store.path.exists());
    }

    #[test]
    fn saves_and_replaces_known_host_key() {
        let directory = tempfile::tempdir().unwrap();
        let store = HostKeyStore::open(directory.path().to_owned()).unwrap();
        let first =
            russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519)
                .unwrap();
        let second =
            russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519)
                .unwrap();
        let first = first.public_key().to_openssh().unwrap();
        let second = second.public_key().to_openssh().unwrap();
        store.save("server", 22, &first).unwrap();
        assert_eq!(store.get("server", 22).as_deref(), Some(first.as_str()));
        store.save("server", 22, &second).unwrap();
        assert_eq!(store.get("server", 22).as_deref(), Some(second.as_str()));
        let reopened = HostKeyStore::open(directory.path().to_owned()).unwrap();
        assert_eq!(reopened.get("server", 22).as_deref(), Some(second.as_str()));
    }
}
