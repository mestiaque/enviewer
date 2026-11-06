//! Lumen core: everything that does not need a window.
//!
//! | module      | responsibility                                   |
//! |-------------|--------------------------------------------------|
//! | `formats`   | format capability registry                       |
//! | `decode`    | image decoding service (image, libheif, RAW, …)  |
//! | `encode`    | encoders for display and export                  |
//! | `metadata`  | probe + EXIF/ICC information (read-only)         |
//! | `livephoto` | Live Photo detection and pairing                 |
//! | `scan`      | folder scanning                                  |
//! | `thumbs`    | persistent thumbnail cache                       |
//! | `db`        | SQLite store + migrations                        |
//! | `edit`      | non-destructive editing engine                   |
//! | `fileops`   | copy / move / rename / trash                     |
//! | `batch`     | batch rename / convert / export                  |
//! | `organize`  | duplicates, similar images, broken files         |

pub mod batch;
pub mod db;
pub mod decode;
pub mod edit;
pub mod encode;
pub mod error;
pub mod fileops;
pub mod formats;
pub mod livephoto;
pub mod metadata;
pub mod organize;
pub mod scan;
pub mod thumbs;

pub use error::{CoreError, Result};
