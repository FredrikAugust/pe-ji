//! UTF-8 document read/write. Readings strip a leading BOM; writes are atomic
//! and never add a BOM.

use std::fs::{self, File};
use std::io::{ErrorKind, Write};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileError {
    EmptyPath,
    NotFound,
    InvalidUtf8,
    Io(String),
}

impl std::fmt::Display for FileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FileError::EmptyPath => write!(f, "パスが空です"),
            FileError::NotFound => write!(f, "ファイルが見つかりません"),
            FileError::InvalidUtf8 => write!(f, "UTF-8 として読めません"),
            FileError::Io(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for FileError {}

pub fn read_utf8(path: &Path) -> Result<String, FileError> {
    if path.as_os_str().is_empty() {
        return Err(FileError::EmptyPath);
    }
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == ErrorKind::NotFound => return Err(FileError::NotFound),
        Err(e) => return Err(FileError::Io(e.to_string())),
    };
    let slice: &[u8] = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        &bytes
    };
    String::from_utf8(slice.to_vec()).map_err(|_| FileError::InvalidUtf8)
}

pub fn write_utf8_atomic(path: &Path, contents: &str) -> Result<(), FileError> {
    if path.as_os_str().is_empty() || path.file_name().is_none() {
        return Err(FileError::EmptyPath);
    }
    let parent = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => Path::new(".").to_path_buf(),
    };
    if !parent.exists() {
        return Err(FileError::Io(format!(
            "フォルダがありません: {}",
            parent.display()
        )));
    }
    let stem = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("doc");
    let tmp = parent.join(format!(".{stem}.{}.pico-tmp", std::process::id()));
    let write_once = (|| -> Result<(), FileError> {
        let mut file = File::create(&tmp).map_err(|e| FileError::Io(e.to_string()))?;
        file.write_all(contents.as_bytes())
            .map_err(|e| FileError::Io(e.to_string()))?;
        file.sync_all().map_err(|e| FileError::Io(e.to_string()))?;
        fs::rename(&tmp, path).map_err(|e| FileError::Io(e.to_string()))?;
        Ok(())
    })();
    if write_once.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    write_once
}

/// Keep `.txt` / `.md` (any case). Add `.txt` when there is no extension.
pub fn ensure_text_extension(name: &str) -> String {
    let base = name.trim();
    if base.is_empty() {
        return "無題.txt".to_string();
    }
    if let Some(dot) = base.rfind('.') {
        if dot > 0 {
            let ext = base[dot + 1..].to_ascii_lowercase();
            if ext == "txt" || ext == "md" {
                return base.to_string();
            }
        }
    }
    format!("{base}.txt")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(label: &str) -> std::path::PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let t = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("pico-core-{t}-{n}-{label}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn roundtrip_japanese_and_newlines() {
        let dir = scratch("round");
        let path = dir.join("十一月の日記.txt");
        let body = "昨日《きのう》\r\nは晴れ。\n";
        write_utf8_atomic(&path, body).unwrap();
        let got = read_utf8(&path).unwrap();
        assert_eq!(got, body);
        let bytes = fs::read(&path).unwrap();
        assert!(!bytes.starts_with(&[0xEF, 0xBB, 0xBF]));
        assert!(bytes.windows(3).all(|w| w != [0xEF, 0xBB, 0xBF]));
        assert!(!dir.join(format!(".十一月の日記.txt.{}.pico-tmp", std::process::id())).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn strips_bom_on_read() {
        let dir = scratch("bom");
        let path = dir.join("bom.txt");
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend("漢字".as_bytes());
        fs::write(&path, bytes).unwrap();
        assert_eq!(read_utf8(&path).unwrap(), "漢字");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_invalid_utf8() {
        let dir = scratch("bad");
        let path = dir.join("bad.txt");
        fs::write(&path, [0xFF, 0xFE, 0x41, 0x80]).unwrap();
        assert_eq!(read_utf8(&path).unwrap_err(), FileError::InvalidUtf8);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_file_and_empty_path() {
        let dir = scratch("miss");
        assert_eq!(
            read_utf8(&dir.join("nope.txt")).unwrap_err(),
            FileError::NotFound
        );
        assert_eq!(read_utf8(Path::new("")).unwrap_err(), FileError::EmptyPath);
        assert_eq!(
            write_utf8_atomic(Path::new(""), "x").unwrap_err(),
            FileError::EmptyPath
        );
        let missing_parent = dir.join("no-such-dir").join("a.txt");
        assert!(matches!(
            write_utf8_atomic(&missing_parent, "x"),
            Err(FileError::Io(_))
        ));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_file_is_allowed() {
        let dir = scratch("empty");
        let path = dir.join("empty.md");
        write_utf8_atomic(&path, "").unwrap();
        assert_eq!(read_utf8(&path).unwrap(), "");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn overwrite_keeps_unicode_name() {
        let dir = scratch("over");
        let path = dir.join("作文.md");
        write_utf8_atomic(&path, "一").unwrap();
        write_utf8_atomic(&path, "二\n").unwrap();
        assert_eq!(read_utf8(&path).unwrap(), "二\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn extensions() {
        assert_eq!(ensure_text_extension("日記"), "日記.txt");
        assert_eq!(ensure_text_extension("日記.txt"), "日記.txt");
        assert_eq!(ensure_text_extension("日記.TXT"), "日記.TXT");
        assert_eq!(ensure_text_extension("notes.md"), "notes.md");
        assert_eq!(ensure_text_extension("notes.MD"), "notes.MD");
        assert_eq!(ensure_text_extension("  spaced  "), "spaced.txt");
        assert_eq!(ensure_text_extension(""), "無題.txt");
        assert_eq!(ensure_text_extension("foo.markdown"), "foo.markdown.txt");
        assert_eq!(ensure_text_extension(".txt"), ".txt.txt");
    }
}
