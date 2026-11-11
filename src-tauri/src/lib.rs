//! Tauri shell: file bytes in, UTF-8 text out, furigana readings, and a
//! cached Jisho fetch. Decoding (UTF-8 / Shift_JIS) and line endings are
//! handled in the web view.

use std::borrow::Cow;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use lindera::dictionary::load_dictionary;
use lindera::mode::Mode;
use lindera::segmenter::Segmenter;

use tauri::{Emitter, Manager};

/// Set just before a confirmed destroy so `CloseRequested` does not loop.
static ALLOW_CLOSE: AtomicBool = AtomicBool::new(false);

/// Longest Jisho keyword we cache; keeps the hex file name under 255 bytes.
const MAX_KEYWORD: usize = 30;

#[tauri::command]
fn read_document(path: String) -> Result<tauri::ipc::Response, String> {
    fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_document(path: String, contents: String) -> Result<(), String> {
    write_atomic(Path::new(&path), contents.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn force_close(window: tauri::Window) {
    ALLOW_CLOSE.store(true, Ordering::SeqCst);
    let _ = window.destroy();
}

fn segmenter() -> &'static Segmenter {
    static SEGMENTER: OnceLock<Segmenter> = OnceLock::new();
    SEGMENTER.get_or_init(|| {
        let dictionary = load_dictionary("embedded://ipadic").expect("embedded IPADIC");
        Segmenter::new(Mode::Normal, dictionary, None)
    })
}

fn has_kanji(s: &str) -> bool {
    s.chars().any(|c| {
        matches!(c, '々' | '〆' | 'ヵ' | 'ヶ' | '\u{3400}'..='\u{9fff}' | '\u{f900}'..='\u{faff}' | '\u{20000}'..='\u{3134f}')
    })
}

/// Tokens that contain kanji: `(start, end, katakana reading)`, offsets in UTF-16 units.
fn line_readings(text: &str) -> Vec<(usize, usize, String)> {
    let mut out = Vec::new();
    if !has_kanji(text) {
        return out;
    }
    let Ok(mut tokens) = segmenter().segment(Cow::Borrowed(text)) else {
        return out;
    };
    let (mut byte, mut unit) = (0, 0);
    for token in tokens.iter_mut() {
        unit += text[byte..token.byte_start].encode_utf16().count();
        let surface = &text[token.byte_start..token.byte_end];
        let len = surface.encode_utf16().count();
        byte = token.byte_end;
        if has_kanji(surface) {
            if let Some(reading) = token.details().get(7).filter(|r| **r != "*") {
                out.push((unit, unit + len, reading.to_string()));
            }
        }
        unit += len;
    }
    out
}

/// Readings for many lines in one call; the web view caches them per line.
#[tauri::command]
async fn readings(lines: Vec<String>) -> Vec<Vec<(usize, usize, String)>> {
    lines.iter().map(|l| line_readings(l)).collect()
}

/// Raw Jisho JSON for `keyword`. Every 200 response is cached on disk, misses included.
#[tauri::command]
async fn jisho(app: tauri::AppHandle, keyword: String) -> Result<String, String> {
    let keyword = keyword.trim().to_string();
    if keyword.is_empty() || keyword.chars().count() > MAX_KEYWORD {
        return Err("keyword must be 1-30 characters".into());
    }
    let file = cache_file(&app, &keyword)?;
    if let Ok(hit) = fs::read_to_string(&file) {
        return Ok(hit);
    }
    let url = reqwest::Url::parse_with_params(
        "https://jisho.org/api/v1/search/words",
        &[("keyword", &keyword)],
    )
    .map_err(|e| e.to_string())?;
    let body = reqwest::get(url)
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    // A failed cache write only costs a refetch next time.
    let _ = fs::create_dir_all(file.parent().unwrap()).and_then(|_| write_atomic(&file, body.as_bytes()));
    Ok(body)
}

fn deepl_key_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("deepl.key"))
}

/// Store the DeepL API key in the app config folder, readable by this user only.
#[tauri::command]
fn set_deepl_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let file = deepl_key_file(&app)?;
    fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    write_atomic(&file, key.trim().as_bytes()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn has_deepl_key(app: tauri::AppHandle) -> bool {
    deepl_key_file(&app).map(|f| f.exists()).unwrap_or(false)
}

/// Raw DeepL JSON for one text. Free keys (ending in `:fx`) use the free endpoint.
#[tauri::command]
async fn translate(app: tauri::AppHandle, text: String, target: String) -> Result<String, String> {
    let key = fs::read_to_string(deepl_key_file(&app)?).map_err(|_| "NO_KEY".to_string())?;
    let key = key.trim();
    let host = if key.ends_with(":fx") { "api-free.deepl.com" } else { "api.deepl.com" };
    let body = serde_json::json!({ "text": [text], "target_lang": target });
    let res = reqwest::Client::new()
        .post(format!("https://{host}/v2/translate"))
        .header("Authorization", format!("DeepL-Auth-Key {key}"))
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    match res.status().as_u16() {
        200 => res.text().await.map_err(|e| e.to_string()),
        403 => Err("BAD_KEY".into()),
        456 => Err("QUOTA".into()),
        code => Err(format!("DeepL {code}")),
    }
}

/// Open a Jisho page in the default browser. Only jisho.org URLs are accepted.
#[tauri::command]
fn open_jisho(url: String) -> Result<(), String> {
    if !url.starts_with("https://jisho.org/") || url.chars().any(|c| c.is_whitespace() || c == '"') {
        return Err("not a Jisho URL".into());
    }
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn cache_file(app: &tauri::AppHandle, keyword: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let name: String = keyword.bytes().map(|b| format!("{b:02x}")).collect();
    Ok(dir.join("jisho").join(format!("{name}.json")))
}

/// Write to a sibling temp file, fsync, rename over the target, fsync the folder.
fn write_atomic(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let name = path
        .file_name()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "パスが空です"))?;
    let parent = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    let tmp = parent.join(format!(".{}.{}.pico-tmp", name.to_string_lossy(), std::process::id()));
    let result = (|| {
        let mut file = File::create(&tmp)?;
        file.write_all(contents)?;
        file.sync_all()?;
        fs::rename(&tmp, path)?;
        #[cfg(unix)]
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_document,
            write_document,
            force_close,
            jisho,
            open_jisho,
            set_deepl_key,
            has_deepl_key,
            translate,
            readings
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_kanji_tokens_with_utf16_offsets() {
        let got = line_readings("𠀋と昨日は日本語を食べた");
        let words: Vec<_> = got.iter().map(|(_, _, r)| r.as_str()).collect();
        assert!(words.contains(&"キノウ"), "{got:?}");
        assert!(words.contains(&"タベ"), "{got:?}");
        let (s, e, _) = got.iter().find(|(_, _, r)| r == "キノウ").unwrap();
        assert_eq!((*s, *e), (3, 5));
        assert!(line_readings("ひらがなだけ").is_empty());
    }

    #[test]
    fn atomic_write_replaces_and_cleans_up() {
        let dir = std::env::temp_dir().join(format!("pico-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("作文.txt");
        write_atomic(&path, "一".as_bytes()).unwrap();
        write_atomic(&path, "昨日《きのう》\r\n".as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "昨日《きのう》\r\n");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        assert!(write_atomic(&dir.join("missing").join("a.txt"), b"x").is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
