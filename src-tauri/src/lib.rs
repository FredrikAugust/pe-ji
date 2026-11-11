//! Tauri shell. Parsing and UTF-8 file IO live in `pico-core`.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::Emitter;

/// Set just before a confirmed destroy so `CloseRequested` does not loop.
static ALLOW_CLOSE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn read_document(path: String) -> Result<String, String> {
    pico_core::read_utf8(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_document(path: String, contents: String) -> Result<(), String> {
    pico_core::write_utf8_atomic(Path::new(&path), &contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn force_close(window: tauri::Window) {
    ALLOW_CLOSE.store(true, Ordering::SeqCst);
    let _ = window.destroy();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_document,
            write_document,
            force_close
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if ALLOW_CLOSE.load(Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                let _ = window.emit("pico-close-requested", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running ぴこぴこ作文帳");
}
