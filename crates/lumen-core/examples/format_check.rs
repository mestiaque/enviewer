//! Format compatibility checker.
//!
//!     cargo run --release --example format_check -- <files or folders>...
//!     cargo run --release --example format_check -- --generate <dir>   # write synthetic samples
//!
//! For each file: full decode (size + time), thumbnail decode, probe and the
//! information panel summary. Used to fill docs/FORMATS.md with tested results.

use lumen_core::decode::{decode, DecodeOptions, Purpose, RawMode};
use lumen_core::{formats, metadata};
use std::path::{Path, PathBuf};
use std::time::Instant;

fn generate(dir: &Path) {
    use image::{codecs, DynamicImage, ImageFormat, Rgb, RgbImage, Rgba, RgbaImage};
    std::fs::create_dir_all(dir).unwrap();
    let rgb = RgbImage::from_fn(640, 427, |x, y| Rgb([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8]));
    let rgba = RgbaImage::from_fn(300, 200, |x, y| Rgba([200, (x % 256) as u8, (y % 256) as u8, if x < 150 { 255 } else { 90 }]));
    let save = |name: &str, img: &DynamicImage, fmt: ImageFormat| img.save_with_format(dir.join(name), fmt).unwrap();
    let d = DynamicImage::ImageRgb8(rgb.clone());
    let a = DynamicImage::ImageRgba8(rgba);
    save("sample.jpg", &d, ImageFormat::Jpeg);
    save("sample.png", &a, ImageFormat::Png);
    save("sample.bmp", &d, ImageFormat::Bmp);
    save("sample.tif", &d, ImageFormat::Tiff);
    save("sample.webp", &a, ImageFormat::WebP);
    save("sample.tga", &d, ImageFormat::Tga);
    save("sample.qoi", &a, ImageFormat::Qoi);
    save("sample.ppm", &d, ImageFormat::Pnm);
    save("sample.ico", &DynamicImage::ImageRgba8(a.resize(128, 128, image::imageops::FilterType::Triangle).to_rgba8()), ImageFormat::Ico);
    save("sample.hdr", &DynamicImage::ImageRgb32F(d.to_rgb32f()), ImageFormat::Hdr);
    save("sample.exr", &DynamicImage::ImageRgba32F(a.to_rgba32f()), ImageFormat::OpenExr);
    // Animated GIF (3 frames)
    {
        let f = std::fs::File::create(dir.join("anim.gif")).unwrap();
        let mut enc = codecs::gif::GifEncoder::new(f);
        enc.set_repeat(codecs::gif::Repeat::Infinite).unwrap();
        for i in 0..3u8 {
            let fr = RgbaImage::from_pixel(120, 80, Rgba([i * 80, 100, 255 - i * 80, 255]));
            enc.encode_frame(image::Frame::from_parts(fr, 0, 0, image::Delay::from_numer_denom_ms(300, 1))).unwrap();
        }
    }
    // JPEG with EXIF orientation 6 (rotate 90° CW): stored landscape, displayed portrait.
    {
        let mut jpg = Vec::new();
        codecs::jpeg::JpegEncoder::new_with_quality(&mut jpg, 90).encode_image(&rgb).unwrap();
        // Minimal APP1 Exif with IFD0 Orientation=6 (big-endian TIFF).
        let mut tiff = b"MM\0\x2a\0\0\0\x08".to_vec();
        tiff.extend([0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
        let mut app1 = b"Exif\0\0".to_vec();
        app1.extend(&tiff);
        let mut out = vec![0xFF, 0xD8, 0xFF, 0xE1];
        out.extend(((app1.len() + 2) as u16).to_be_bytes());
        out.extend(&app1);
        out.extend(&jpg[2..]);
        std::fs::write(dir.join("orientation6.jpg"), out).unwrap();
    }
    std::fs::write(
        dir.join("vector.svg"),
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#1e293b"/><circle cx="150" cy="100" r="70" fill="#3b82f6"/></svg>"##,
    )
    .unwrap();
    println!("wrote samples to {}", dir.display());
}

fn collect(p: &Path, out: &mut Vec<PathBuf>) {
    if p.is_dir() {
        let mut v: Vec<_> = std::fs::read_dir(p).unwrap().filter_map(|e| e.ok()).map(|e| e.path()).collect();
        v.sort();
        for c in v {
            collect(&c, out);
        }
    } else {
        out.push(p.to_path_buf());
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--generate") {
        generate(Path::new(args.get(1).expect("dir")));
        return;
    }
    let mut files = Vec::new();
    for a in &args {
        collect(Path::new(a), &mut files);
    }
    println!("{:<34} {:<20} {:>11} {:>8} {:>11} {:>8}  {}", "file", "format", "full", "ms", "thumb", "ms", "probe / metadata");
    let mut failures = 0;
    for f in files {
        let Some(fmt) = formats::from_path(&f) else { continue };
        if fmt.kind == formats::MediaKind::Video {
            let mi = lumen_core::livephoto::read_mov_info(&f).unwrap_or_default();
            println!("{:<34} {:<20} {:>11} {:>8} {:>11} {:>8}  duration={:?} content_id={:?}", name(&f), fmt.name, "-", "-", "-", "-", mi.duration_secs, mi.content_id);
            continue;
        }
        let opts = DecodeOptions { raw_mode: RawMode::Embedded };
        let t = Instant::now();
        let full = decode(&f, &opts, Purpose::Full);
        let t_full = t.elapsed().as_millis();
        let t = Instant::now();
        let thumb = decode(&f, &opts, Purpose::Thumbnail(256));
        let t_thumb = t.elapsed().as_millis();
        let probe = metadata::probe(&f);
        let info = metadata::image_info(&f);
        let dims = |r: &lumen_core::Result<lumen_core::decode::Decoded>| match r {
            Ok(d) => format!("{}x{}", d.image.width(), d.image.height()),
            Err(_) => "ERROR".into(),
        };
        let mut meta = format!("probe={}x{} anim={} captured={}", probe.width.unwrap_or(0), probe.height.unwrap_or(0), probe.animated, probe.captured.is_some());
        if let Ok(i) = &info {
            let c = &i.camera;
            meta += &format!(
                " cam={:?} lens={:?} f={:?} iso={:?} gps={} icc={:?} depth={:?} live_id={}",
                c.model,
                c.lens.as_deref().map(|l| l.chars().take(24).collect::<String>()),
                c.aperture,
                c.iso,
                c.gps.is_some(),
                i.icc_profile.as_ref().and_then(|p| p.description.clone()),
                i.bit_depth,
                i.live_photo_id.is_some()
            );
        }
        println!("{:<34} {:<20} {:>11} {:>8} {:>11} {:>8}  {}", name(&f), fmt.name, dims(&full), t_full, dims(&thumb), t_thumb, meta);
        if let Err(e) = &full {
            failures += 1;
            println!("    full decode error: {e}");
        }
        if let Err(e) = &info {
            println!("    info error: {e}");
        }
    }
    if failures > 0 {
        std::process::exit(1);
    }
}

fn name(p: &Path) -> String {
    let n = p.file_name().unwrap().to_string_lossy().to_string();
    if n.len() > 33 { format!("…{}", &n[n.len() - 32..]) } else { n }
}
