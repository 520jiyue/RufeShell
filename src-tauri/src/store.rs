use crate::domain::{AppError, ConnectionProfile};
use std::{
    fs,
    path::{Path, PathBuf},
};

const SCHEMA_VERSION: u32 = 1;

#[derive(serde::Serialize, serde::Deserialize)]
struct Database {
    schema_version: u32,
    connections: Vec<ConnectionProfile>,
}

pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn open(directory: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&directory).map_err(storage)?;
        let path = directory.join("connections.json");
        let store = Self { path };
        if store.path.exists() {
            store.read()?;
        }
        Ok(store)
    }

    fn read(&self) -> Result<Database, AppError> {
        let bytes = fs::read(&self.path).map_err(storage)?;
        let mut database: Database = serde_json::from_slice(&bytes)
            .map_err(|error| AppError::Storage(format!("配置格式无效：{error}")))?;
        if database.schema_version > SCHEMA_VERSION {
            return Err(AppError::Storage("配置来自更新版本，请先升级应用".into()));
        }
        for profile in &mut database.connections {
            profile.host = ConnectionProfile::normalize_host(&profile.host);
        }
        Ok(database)
    }

    fn write(&self, database: &Database) -> Result<(), AppError> {
        let json = serde_json::to_vec_pretty(database)
            .map_err(|error| AppError::Storage(error.to_string()))?;
        let temp = self.path.with_extension("json.tmp");
        fs::write(&temp, json).map_err(storage)?;
        if self.path.exists() {
            fs::copy(&self.path, self.path.with_extension("json.backup")).map_err(storage)?;
        }
        replace_file(&temp, &self.path)
    }

    pub fn list(&self) -> Result<Vec<ConnectionProfile>, AppError> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let mut profiles = self.read()?.connections;
        profiles.sort_by_key(|profile| profile.name.to_lowercase());
        Ok(profiles)
    }

    pub fn get(&self, id: &str) -> Result<ConnectionProfile, AppError> {
        self.list()?
            .into_iter()
            .find(|profile| profile.id == id)
            .ok_or_else(|| AppError::Validation("连接配置不存在".into()))
    }

    pub fn upsert(&self, profile: ConnectionProfile) -> Result<(), AppError> {
        let mut connections = self.list()?;
        connections.retain(|existing| existing.id != profile.id);
        connections.push(profile);
        self.write(&Database {
            schema_version: SCHEMA_VERSION,
            connections,
        })
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let mut connections = self.list()?;
        connections.retain(|profile| profile.id != id);
        self.write(&Database {
            schema_version: SCHEMA_VERSION,
            connections,
        })
    }
}

fn storage(error: std::io::Error) -> AppError {
    AppError::Storage(error.to_string())
}

#[cfg(windows)]
pub(crate) fn replace_file(temp: &Path, path: &Path) -> Result<(), AppError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source = temp
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(storage(std::io::Error::last_os_error()))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
pub(crate) fn replace_file(temp: &Path, path: &Path) -> Result<(), AppError> {
    fs::rename(temp, path).map_err(storage)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{AuthKind, ConnectionDraft};

    #[test]
    fn persists_connection_without_secret() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path().to_owned()).unwrap();
        let profile = ConnectionProfile::from_draft(ConnectionDraft {
            name: "本地服务器".into(),
            host: "localhost".into(),
            port: 22,
            username: "tester".into(),
            auth: AuthKind::Password,
            private_key_path: None,
        })
        .unwrap();
        let id = profile.id.clone();
        store.upsert(profile).unwrap();
        assert_eq!(store.get(&id).unwrap().name, "本地服务器");
        assert_eq!(store.list().unwrap().len(), 1);
        store.delete(&id).unwrap();
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn normalizes_legacy_web_addresses_when_loading() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("connections.json");
        fs::write(
            &path,
            r#"{"schema_version":1,"connections":[{"id":"legacy","name":"旧连接","host":"http://example.com/","port":22,"username":"tester","auth":"password","private_key_path":null,"updated_at":0}]}"#,
        )
        .unwrap();
        let store = Store::open(directory.path().to_owned()).unwrap();
        assert_eq!(store.get("legacy").unwrap().host, "example.com");
    }
}
