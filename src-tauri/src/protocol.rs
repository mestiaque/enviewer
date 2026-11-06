//! `lumen://` custom protocol — how pixels reach the webview without base64/IPC.
//!
//! Routes (path + `?p=<percent-encoded absolute path>`):
//! * `/thumb/<px>/<generation>` – cached thumbnail (JPEG/PNG)
//! * `/full`                    – backend-decoded image as lossless PNG (HEIC, RAW, TIFF, JXL, PSD…)
//! * `/file`                    – original bytes with HTTP Range support (native images, video)
//!
//! Thumbnails go through a LIFO worker queue: the most recently requested
//! tiles (the ones the user is looking at now) are generated first, and jobs
//! from a previous folder generation are dropped (generation 0 = never stale).

use crate::state::AppState;
use lumen_core::decode::{self, Purpose};
use lumen_core::{encode, formats, CoreError};
use parking_lot::{Condvar, Mutex};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, OnceLock};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, UriSchemeResponder};

struct Job {
    path: PathBuf,
    px: u32,
    generation: u64,
    responder: UriSchemeResponder,
}

struct Queue {
    jobs: Mutex<Vec<Job>>,
    cv: Condvar,
}

static QUEUE: OnceLock<Arc<Queue>> = OnceLock::new();
const MAX_QUEUED: usize = 3000;

pub fn start_workers(app: AppHandle) {
    let q = QUEUE.get_or_init(|| Arc::new(Queue { jobs: Mutex::new(Vec::new()), cv: Condvar::new() })).clone();
    let n = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).saturating_sub(1).clamp(2, 8);
    for i in 0..n {
        let q = q.clone();
        let app = app.clone();
        std::thread::Builder::new()
            .name(format!("thumb-{i}"))
            .spawn(move || loop {
                let job = {
                    let mut jobs = q.jobs.lock();
                    while jobs.is_empty() {
                        q.cv.wait(&mut jobs);
                    }
                    jobs.pop().unwrap() // LIFO
                };
                let state = app.state::<AppState>();
                let current = state.thumb_generation.load(Ordering::Relaxed);
                if job.generation != 0 && job.generation < current {
                    job.responder.respond(text(StatusCode::GONE, "stale"));
                    continue;
                }
                let opts = *state.decode_opts.read();
                let resp = match state.thumbs.get(&job.path, job.px, &opts) {
                    Ok(t) => Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, t.mime)
                        .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
                        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .body(t.bytes)
                        .unwrap(),
                    Err(e) => error_response(&e),
                };
                job.responder.respond(resp);
            })
            .expect("spawn thumbnail worker");
    }
}

fn text(status: StatusCode, msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

fn error_response(e: &CoreError) -> Response<Vec<u8>> {
    let status = match e {
        CoreError::Unsupported(_) => StatusCode::UNSUPPORTED_MEDIA_TYPE,
        CoreError::Io(io) if io.kind() == std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        CoreError::Io(io) if io.kind() == std::io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
        _ => StatusCode::UNPROCESSABLE_ENTITY,
    };
    text(status, &e.to_string())
}

fn query_path(req: &Request<Vec<u8>>) -> Option<PathBuf> {
    let q = req.uri().query()?;
    q.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == "p").then(|| PathBuf::from(percent_encoding::percent_decode_str(v).decode_utf8_lossy().into_owned()))
    })
}

pub fn handle(app: &AppHandle, req: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let Some(path) = query_path(&req) else {
        responder.respond(text(StatusCode::BAD_REQUEST, "missing path"));
        return;
    };
    // Only media files known to the format registry are ever served.
    if !path.is_absolute() || formats::from_path(&path).is_none() {
        responder.respond(text(StatusCode::FORBIDDEN, "not a media file"));
        return;
    }
    let route: Vec<String> = req.uri().path().trim_matches('/').split('/').map(String::from).collect();
    match route.first().map(String::as_str) {
        Some("thumb") => {
            let px = route.get(1).and_then(|s| s.parse().ok()).unwrap_or(256u32).clamp(32, 1024);
            let generation = route.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            let q = QUEUE.get().expect("workers started");
            let mut jobs = q.jobs.lock();
            if jobs.len() >= MAX_QUEUED {
                // Drop the oldest request (least likely to still be visible).
                let old = jobs.remove(0);
                old.responder.respond(text(StatusCode::SERVICE_UNAVAILABLE, "busy"));
            }
            jobs.push(Job { path, px, generation, responder });
            q.cv.notify_one();
        }
        Some("full") => {
            let app = app.clone();
            std::thread::spawn(move || {
                let state = app.state::<AppState>();
                let key = format!("{}|{}", path.display(), req.uri().query().unwrap_or(""));
                if let Some(bytes) = state.full_cache.lock().get(&key) {
                    responder.respond(png_response(bytes.as_ref().clone()));
                    return;
                }
                let opts = *state.decode_opts.read();
                let res = decode::decode(&path, &opts, Purpose::Full).and_then(|d| encode::display_png(&d.image, d.icc.as_deref()));
                match res {
                    Ok(bytes) => {
                        let bytes = Arc::new(bytes);
                        state.full_cache.lock().put(key, bytes.clone());
                        responder.respond(png_response(bytes.as_ref().clone()));
                    }
                    Err(e) => {
                        log::warn!("decode failed for {}: {e}", path.display());
                        responder.respond(error_response(&e));
                    }
                }
            });
        }
        Some("file") => {
            std::thread::spawn(move || {
                let range = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).map(String::from);
                responder.respond(serve_file(&path, range.as_deref()).unwrap_or_else(|e| error_response(&CoreError::Io(e))));
            });
        }
        _ => responder.respond(text(StatusCode::NOT_FOUND, "unknown route")),
    }
}

fn png_response(bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/png")
        .header(header::CACHE_CONTROL, "max-age=3600")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(bytes)
        .unwrap()
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("jpg" | "jpeg" | "jpe" | "jfif") => "image/jpeg",
        Some("png" | "apng") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp" | "dib") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("svg") => "image/svg+xml",
        Some("avif") => "image/avif",
        Some("mov" | "qt") => "video/quicktime",
        Some("mp4" | "m4v") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

/// Largest chunk returned for an open-ended range request; media elements
/// simply ask for the next range.
const MAX_CHUNK: u64 = 4 * 1024 * 1024;

fn serve_file(path: &Path, range: Option<&str>) -> std::io::Result<Response<Vec<u8>>> {
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    let mime = mime_for(path);
    let base = || {
        Response::builder()
            .header(header::CONTENT_TYPE, mime)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CACHE_CONTROL, "no-cache")
    };
    if let Some((start, end)) = range.and_then(|r| parse_range(r, len)) {
        let end = end.min(start + MAX_CHUNK - 1);
        let mut buf = vec![0u8; (end - start + 1) as usize];
        f.seek(SeekFrom::Start(start))?;
        f.read_exact(&mut buf)?;
        return Ok(base()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
            .body(buf)
            .unwrap());
    }
    let mut buf = Vec::with_capacity(len as usize);
    f.read_to_end(&mut buf)?;
    Ok(base().status(StatusCode::OK).body(buf).unwrap())
}

/// Parses a single `bytes=a-b`, `bytes=a-` or `bytes=-n` range.
pub(crate) fn parse_range(h: &str, len: u64) -> Option<(u64, u64)> {
    let spec = h.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    if len == 0 {
        return None;
    }
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        (len.saturating_sub(n), len - 1)
    } else {
        let s: u64 = a.parse().ok()?;
        let e = if b.is_empty() { len - 1 } else { b.parse::<u64>().ok()?.min(len - 1) };
        (s, e)
    };
    (start <= end && start < len).then_some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(parse_range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=90-500", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=200-", 100), None);
        assert_eq!(parse_range("items=0-1", 100), None);
    }
}
