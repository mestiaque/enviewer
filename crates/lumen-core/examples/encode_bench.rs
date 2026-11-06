//! Times decode + display encodings for one file: cargo run --release --example encode_bench -- <file>
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::ImageEncoder;
use std::time::Instant;
fn main() {
    let p = std::env::args().nth(1).unwrap();
    let t = Instant::now();
    let d = lumen_core::decode::decode(p.as_ref(), &Default::default(), lumen_core::decode::Purpose::Full).unwrap();
    println!("decode {} ms ({}x{})", t.elapsed().as_millis(), d.image.width(), d.image.height());
    let rgb = d.image.to_rgb8();
    for (name, f) in [("adaptive", FilterType::Adaptive), ("sub", FilterType::Sub), ("none", FilterType::NoFilter)] {
        let t = Instant::now();
        let mut out = Vec::new();
        PngEncoder::new_with_quality(&mut out, CompressionType::Fast, f).write_image(&rgb, rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8).unwrap();
        println!("png fast/{name}: {} ms, {} MB", t.elapsed().as_millis(), out.len() / 1_000_000);
    }
    let t = Instant::now();
    let mut out = std::io::Cursor::new(Vec::new());
    rgb.write_to(&mut out, image::ImageFormat::Bmp).unwrap();
    println!("bmp: {} ms, {} MB", t.elapsed().as_millis(), out.get_ref().len() / 1_000_000);
}
