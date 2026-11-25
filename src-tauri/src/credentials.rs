use crate::domain::AppError;

const SERVICE: &str = "RufeShell/connection";
const LEGACY_SERVICE: &str = "FinalPowerShell/connection";

fn entry(id: &str) -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(SERVICE, id).map_err(|error| AppError::Credential(error.to_string()))
}

fn legacy_entry(id: &str) -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(LEGACY_SERVICE, id)
        .map_err(|error| AppError::Credential(error.to_string()))
}

pub fn save(id: &str, password: &str) -> Result<(), AppError> {
    entry(id)?
        .set_password(password)
        .map_err(|error| AppError::Credential(error.to_string()))
}

pub fn get(id: &str) -> Result<String, AppError> {
    match entry(id)?.get_password() {
        Ok(password) => Ok(password),
        Err(keyring::Error::NoEntry) => match legacy_entry(id)?.get_password() {
            Ok(password) => Ok(password),
            Err(keyring::Error::NoEntry) => Err(AppError::PasswordRequired),
            Err(error) => Err(AppError::Credential(error.to_string())),
        },
        Err(error) => Err(AppError::Credential(error.to_string())),
    }
}

pub fn delete(id: &str) -> Result<(), AppError> {
    let _ = legacy_entry(id)?.delete_credential();
    match entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(AppError::Credential(error.to_string())),
    }
}

pub fn copy(from_id: &str, to_id: &str) -> Result<(), AppError> {
    match get(from_id) {
        Ok(password) => save(to_id, &password),
        Err(AppError::PasswordRequired) => Ok(()),
        Err(error) => Err(error),
    }
}
