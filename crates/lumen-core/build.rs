fn main() {
    println!("cargo:rerun-if-env-changed=LIBHEIF_DIR");
    if std::env::var("CARGO_FEATURE_HEIF").is_err() {
        return;
    }
    // Explicit location (Windows/vcpkg or custom builds): LIBHEIF_DIR/{lib,include}.
    if let Ok(dir) = std::env::var("LIBHEIF_DIR") {
        println!("cargo:rustc-link-search=native={dir}/lib");
        println!("cargo:rustc-link-lib=dylib=heif");
        return;
    }
    #[cfg(feature = "heif")]
    match pkg_config::Config::new().atleast_version("1.12").probe("libheif") {
        Ok(_) => {}
        Err(e) => panic!(
            "libheif was not found ({e}).\n\
             Install it (Ubuntu: `sudo apt install libheif-dev`, Windows: `vcpkg install libheif:x64-windows` \
             and set LIBHEIF_DIR), or build without HEIC support using `--no-default-features`."
        ),
    }
}
