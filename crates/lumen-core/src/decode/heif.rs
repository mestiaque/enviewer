//! Minimal safe wrapper around the libheif C API (HEIC / HEIF / AVIF).
//!
//! Only functions present since libheif 1.12 are used so the system library on
//! Ubuntu 22.04 works, as do current vcpkg builds on Windows. libheif applies the
//! `irot`/`imir` transformations itself, so the returned image is display-ready.

use crate::error::{CoreError, Result};
use image::{DynamicImage, RgbImage, RgbaImage};
use std::ffi::{c_char, c_int, c_void, CStr};
use std::path::Path;
use std::ptr;

#[repr(C)]
struct HeifError {
    code: c_int,
    subcode: c_int,
    message: *const c_char,
}

const COLORSPACE_RGB: c_int = 1;
const CHROMA_INTERLEAVED_RGB: c_int = 10;
const CHROMA_INTERLEAVED_RGBA: c_int = 11;
const CHANNEL_INTERLEAVED: c_int = 10;

#[allow(non_snake_case)]
extern "C" {
    fn heif_get_version() -> *const c_char;
    fn heif_context_alloc() -> *mut c_void;
    fn heif_context_free(ctx: *mut c_void);
    fn heif_context_read_from_memory_without_copy(
        ctx: *mut c_void,
        mem: *const c_void,
        size: usize,
        opts: *const c_void,
    ) -> HeifError;
    fn heif_context_get_primary_image_handle(ctx: *mut c_void, out: *mut *mut c_void) -> HeifError;
    fn heif_image_handle_release(h: *const c_void);
    fn heif_image_handle_get_width(h: *const c_void) -> c_int;
    fn heif_image_handle_get_height(h: *const c_void) -> c_int;
    fn heif_image_handle_has_alpha_channel(h: *const c_void) -> c_int;
    fn heif_image_handle_get_luma_bits_per_pixel(h: *const c_void) -> c_int;
    fn heif_image_handle_get_number_of_thumbnails(h: *const c_void) -> c_int;
    fn heif_image_handle_get_list_of_thumbnail_IDs(h: *const c_void, ids: *mut u32, count: c_int) -> c_int;
    fn heif_image_handle_get_thumbnail(h: *const c_void, id: u32, out: *mut *mut c_void) -> HeifError;
    fn heif_image_handle_get_number_of_depth_images(h: *const c_void) -> c_int;
    fn heif_image_handle_get_raw_color_profile_size(h: *const c_void) -> usize;
    fn heif_image_handle_get_raw_color_profile(h: *const c_void, out: *mut c_void) -> HeifError;
    fn heif_decode_image(
        h: *const c_void,
        out: *mut *mut c_void,
        colorspace: c_int,
        chroma: c_int,
        opts: *const c_void,
    ) -> HeifError;
    fn heif_image_get_width(img: *const c_void, channel: c_int) -> c_int;
    fn heif_image_get_height(img: *const c_void, channel: c_int) -> c_int;
    fn heif_image_get_plane_readonly(img: *const c_void, channel: c_int, stride: *mut c_int) -> *const u8;
    fn heif_image_release(img: *const c_void);
}

fn check(e: HeifError) -> Result<()> {
    if e.code == 0 {
        return Ok(());
    }
    let msg = if e.message.is_null() {
        format!("libheif error {}", e.code)
    } else {
        unsafe { CStr::from_ptr(e.message) }.to_string_lossy().into_owned()
    };
    Err(CoreError::Decode(msg))
}

pub fn version() -> String {
    unsafe { CStr::from_ptr(heif_get_version()) }.to_string_lossy().into_owned()
}

struct Context {
    ptr: *mut c_void,
    // libheif keeps a pointer into this buffer; it must outlive the context.
    _data: Vec<u8>,
}
impl Drop for Context {
    fn drop(&mut self) {
        unsafe { heif_context_free(self.ptr) }
    }
}

struct Handle(*mut c_void);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe { heif_image_handle_release(self.0) }
    }
}

struct Image(*mut c_void);
impl Drop for Image {
    fn drop(&mut self) {
        unsafe { heif_image_release(self.0) }
    }
}

fn open(path: &Path) -> Result<(Context, Handle)> {
    // Reading into memory (instead of heif_context_read_from_file) keeps
    // non-ASCII paths working on Windows.
    let data = std::fs::read(path)?;
    unsafe {
        let ctx = Context { ptr: heif_context_alloc(), _data: data };
        if ctx.ptr.is_null() {
            return Err(CoreError::Decode("libheif: out of memory".into()));
        }
        check(heif_context_read_from_memory_without_copy(
            ctx.ptr,
            ctx._data.as_ptr() as *const c_void,
            ctx._data.len(),
            ptr::null(),
        ))?;
        let mut h = ptr::null_mut();
        check(heif_context_get_primary_image_handle(ctx.ptr, &mut h))?;
        Ok((ctx, Handle(h)))
    }
}

fn decode_handle(h: *const c_void) -> Result<DynamicImage> {
    unsafe {
        let alpha = heif_image_handle_has_alpha_channel(h) != 0;
        let chroma = if alpha { CHROMA_INTERLEAVED_RGBA } else { CHROMA_INTERLEAVED_RGB };
        let mut img = ptr::null_mut();
        check(heif_decode_image(h, &mut img, COLORSPACE_RGB, chroma, ptr::null()))?;
        let img = Image(img);
        let w = heif_image_get_width(img.0, CHANNEL_INTERLEAVED);
        let hgt = heif_image_get_height(img.0, CHANNEL_INTERLEAVED);
        let mut stride: c_int = 0;
        let plane = heif_image_get_plane_readonly(img.0, CHANNEL_INTERLEAVED, &mut stride);
        if plane.is_null() || w <= 0 || hgt <= 0 {
            return Err(CoreError::Decode("libheif returned an empty image".into()));
        }
        let (w, hgt, stride) = (w as usize, hgt as usize, stride as usize);
        let bpp = if alpha { 4 } else { 3 };
        let mut buf = Vec::with_capacity(w * hgt * bpp);
        for y in 0..hgt {
            let row = std::slice::from_raw_parts(plane.add(y * stride), w * bpp);
            buf.extend_from_slice(row);
        }
        Ok(if alpha {
            DynamicImage::ImageRgba8(RgbaImage::from_raw(w as u32, hgt as u32, buf).unwrap())
        } else {
            DynamicImage::ImageRgb8(RgbImage::from_raw(w as u32, hgt as u32, buf).unwrap())
        })
    }
}

fn icc_of(h: *const c_void) -> Option<Vec<u8>> {
    unsafe {
        let n = heif_image_handle_get_raw_color_profile_size(h);
        if n == 0 {
            return None;
        }
        let mut buf = vec![0u8; n];
        check(heif_image_handle_get_raw_color_profile(h, buf.as_mut_ptr() as *mut c_void)).ok()?;
        Some(buf)
    }
}

/// Decode the primary image. When `min_size` is given, an embedded thumbnail
/// whose longer side is at least that large is used instead (much faster).
pub fn decode(path: &Path, min_size: Option<u32>) -> Result<(DynamicImage, Option<Vec<u8>>)> {
    let (_ctx, handle) = open(path)?;
    let icc = icc_of(handle.0);
    if let Some(min) = min_size {
        unsafe {
            let n = heif_image_handle_get_number_of_thumbnails(handle.0);
            if n > 0 {
                let mut ids = vec![0u32; n as usize];
                heif_image_handle_get_list_of_thumbnail_IDs(handle.0, ids.as_mut_ptr(), n);
                for id in ids {
                    let mut th = ptr::null_mut();
                    if check(heif_image_handle_get_thumbnail(handle.0, id, &mut th)).is_ok() {
                        let th = Handle(th);
                        let long = heif_image_handle_get_width(th.0).max(heif_image_handle_get_height(th.0));
                        if long as u32 >= min {
                            if let Ok(img) = decode_handle(th.0) {
                                return Ok((img, icc));
                            }
                        }
                    }
                }
            }
        }
    }
    Ok((decode_handle(handle.0)?, icc))
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeifDetails {
    pub width: u32,
    pub height: u32,
    pub bit_depth: u32,
    pub has_alpha: bool,
    pub depth_images: u32,
    pub thumbnails: u32,
    pub icc_size: usize,
}

pub fn details(path: &Path) -> Result<HeifDetails> {
    let (_ctx, h) = open(path)?;
    unsafe {
        Ok(HeifDetails {
            width: heif_image_handle_get_width(h.0).max(0) as u32,
            height: heif_image_handle_get_height(h.0).max(0) as u32,
            bit_depth: heif_image_handle_get_luma_bits_per_pixel(h.0).max(0) as u32,
            has_alpha: heif_image_handle_has_alpha_channel(h.0) != 0,
            depth_images: heif_image_handle_get_number_of_depth_images(h.0).max(0) as u32,
            thumbnails: heif_image_handle_get_number_of_thumbnails(h.0).max(0) as u32,
            icc_size: heif_image_handle_get_raw_color_profile_size(h.0),
        })
    }
}
