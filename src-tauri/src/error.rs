use std::{error::Error, fmt};

pub type CoreResult<T> = Result<T, CoreError>;

#[derive(Debug)]
pub enum CoreError {
    Io(std::io::Error),
    Image(image::ImageError),
    Json(serde_json::Error),
    Sqlite(rusqlite::Error),
    Zip(zip::result::ZipError),
    Invalid(String),
}

impl fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "filesystem error: {error}"),
            Self::Image(error) => write!(formatter, "image error: {error}"),
            Self::Json(error) => write!(formatter, "json error: {error}"),
            Self::Sqlite(error) => write!(formatter, "database error: {error}"),
            Self::Zip(error) => write!(formatter, "archive error: {error}"),
            Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl Error for CoreError {}

impl From<std::io::Error> for CoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<image::ImageError> for CoreError {
    fn from(error: image::ImageError) -> Self {
        Self::Image(error)
    }
}

impl From<serde_json::Error> for CoreError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<rusqlite::Error> for CoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<zip::result::ZipError> for CoreError {
    fn from(error: zip::result::ZipError) -> Self {
        Self::Zip(error)
    }
}

impl From<&str> for CoreError {
    fn from(message: &str) -> Self {
        Self::Invalid(message.to_owned())
    }
}

impl From<String> for CoreError {
    fn from(message: String) -> Self {
        Self::Invalid(message)
    }
}
