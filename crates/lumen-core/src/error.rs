use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("Unsupported format: {0}")]
    Unsupported(String),
    #[error("Could not decode image: {0}")]
    Decode(String),
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("A file named \"{0}\" already exists")]
    Exists(String),
    #[error("Operation cancelled")]
    Cancelled,
    #[error("{0}")]
    Other(String),
}

impl From<image::ImageError> for CoreError {
    fn from(e: image::ImageError) -> Self {
        match e {
            image::ImageError::Unsupported(u) => CoreError::Unsupported(u.to_string()),
            image::ImageError::IoError(io) => CoreError::Io(io),
            other => CoreError::Decode(other.to_string()),
        }
    }
}

impl From<serde_json::Error> for CoreError {
    fn from(e: serde_json::Error) -> Self {
        CoreError::Other(format!("JSON: {e}"))
    }
}

/// Errors cross the IPC boundary as human-readable strings.
impl Serialize for CoreError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, CoreError>;
