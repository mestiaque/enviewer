//! Loopback HTTP server for video playback.
//!
//! WebKitGTK plays media through GStreamer, whose WebKit source element only
//! accepts http(s)/blob URLs, so videos served from the `lumen://` custom scheme
//! fail with `FormatError`. This server streams video files to the webview over
//! `http://127.0.0.1:<port>/<token>/media?p=<path>` with Range support.
//!
//! Safety: bound to loopback only, every request must carry a random per-run
//! token, and only files whose extension the format registry marks as video
//! are served.

use lumen_core::formats::{self, MediaKind};
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static BASE: OnceLock<String> = OnceLock::new();

/// Base URL (`http://127.0.0.1:port/token`), or None if the server could not start.
pub fn base_url() -> Option<String> {
    BASE.get().cloned()
}

fn random_token() -> String {
    let mut out = String::new();
    for i in 0..4u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i ^ std::process::id() as u64);
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

pub fn start() {
    let listener = match TcpListener::bind(("127.0.0.1", 0)) {
        Ok(l) => l,
        Err(e) => {
            log::error!("media server: cannot bind loopback: {e}");
            return;
        }
    };
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    let token = random_token();
    let _ = BASE.set(format!("http://127.0.0.1:{port}/{token}"));
    log::info!("media server listening on 127.0.0.1:{port}");
    std::thread::Builder::new()
        .name("media-server".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let token = token.clone();
                std::thread::spawn(move || {
                    if let Err(e) = handle(stream, &token) {
                        log::debug!("media server connection: {e}");
                    }
                });
            }
        })
        .ok();
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("mov" | "qt") => "video/quicktime",
        Some("mp4" | "m4v") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

fn respond_status(s: &mut TcpStream, code: u16, reason: &str) -> std::io::Result<()> {
    write!(s, "HTTP/1.1 {code} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
}

fn handle(mut stream: TcpStream, token: &str) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let mut range: Option<String> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("range") {
                range = Some(v.trim().to_string());
            }
        }
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    if method != "GET" && method != "HEAD" {
        return respond_status(&mut stream, 405, "Method Not Allowed");
    }
    let Some(path) = parse_target(target, token) else {
        return respond_status(&mut stream, 403, "Forbidden");
    };
    let mut file = match std::fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return respond_status(&mut stream, 404, "Not Found"),
    };
    let len = file.metadata()?.len();
    let (status, start, end) = match range.as_deref().map(|r| crate::protocol::parse_range(r, len)) {
        Some(Some((s, e))) => (206, s, e),
        Some(None) => {
            return write!(stream, "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{len}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        }
        None => (200, 0, len.saturating_sub(1)),
    };
    let body_len = if len == 0 { 0 } else { end - start + 1 };
    let mut head = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: {}\r\nContent-Length: {body_len}\r\nAccept-Ranges: bytes\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n",
        if status == 206 { "Partial Content" } else { "OK" },
        mime_for(&path)
    );
    if status == 206 {
        head.push_str(&format!("Content-Range: bytes {start}-{end}/{len}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    if method == "HEAD" || body_len == 0 {
        return Ok(());
    }
    file.seek(SeekFrom::Start(start))?;
    // The client closing the connection mid-stream (seeking) is normal.
    let _ = std::io::copy(&mut file.take(body_len), &mut stream);
    Ok(())
}

/// `/<token>/media?p=<percent-encoded path>` → the path, if allowed.
fn parse_target(target: &str, token: &str) -> Option<PathBuf> {
    let (route, query) = target.split_once('?')?;
    if route != format!("/{token}/media") {
        return None;
    }
    let p = query.split('&').find_map(|kv| kv.strip_prefix("p="))?;
    let path = PathBuf::from(percent_encoding::percent_decode_str(p).decode_utf8_lossy().into_owned());
    let allowed = path.is_absolute() && formats::from_path(&path).is_some_and(|f| f.kind == MediaKind::Video);
    allowed.then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_tokened_video_paths_are_served() {
        // An absolute path on this platform, percent-encoded the way the frontend sends it.
        let root = if cfg!(windows) { r"C:\u\" } else { "/home/u/" };
        let enc = |name: &str| percent_encoding::utf8_percent_encode(&format!("{root}{name}"), percent_encoding::NON_ALPHANUMERIC).to_string();
        let abs = |name: &str| Some(PathBuf::from(format!("{root}{name}")));
        assert_eq!(parse_target(&format!("/abc/media?p={}", enc("clip.MOV")), "abc"), abs("clip.MOV"));
        assert_eq!(parse_target(&format!("/abc/media?p={}&v=3", enc("clip.mp4")), "abc"), abs("clip.mp4"));
        assert_eq!(parse_target(&format!("/wrong/media?p={}", enc("clip.mp4")), "abc"), None);
        assert_eq!(parse_target(&format!("/abc/media?p={}", enc("passwd")), "abc"), None);
        assert_eq!(parse_target(&format!("/abc/media?p={}", enc("photo.jpg")), "abc"), None);
        assert_eq!(parse_target("/abc/media?p=relative.mp4", "abc"), None);
    }

    #[test]
    fn streams_ranges_over_http() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("v.mp4");
        std::fs::write(&f, (0..=255u8).collect::<Vec<_>>()).unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for s in listener.incoming().flatten().take(2) {
                handle(s, "tok").unwrap();
            }
        });
        let get = |range: &str| {
            let mut c = TcpStream::connect(addr).unwrap();
            let q = percent_encoding::utf8_percent_encode(&f.to_string_lossy(), percent_encoding::NON_ALPHANUMERIC).to_string();
            write!(c, "GET /tok/media?p={q} HTTP/1.1\r\nHost: x\r\n{range}\r\n").unwrap();
            let mut out = Vec::new();
            c.read_to_end(&mut out).unwrap();
            out
        };
        let full = get("");
        assert!(full.starts_with(b"HTTP/1.1 200"));
        assert!(full.ends_with(&[253, 254, 255]));
        let part = get("Range: bytes=10-12\r\n");
        let text = String::from_utf8_lossy(&part);
        assert!(text.starts_with("HTTP/1.1 206"));
        assert!(text.contains("Content-Range: bytes 10-12/256"));
        assert!(part.ends_with(&[10, 11, 12]));
    }
}
