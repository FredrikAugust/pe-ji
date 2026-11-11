//! Shared core for ぴこぴこ作文帳: furigana markup and UTF-8 files.
//!
//! The same grammar is implemented in `src/lib/parser.ts`. Both sides are
//! locked to `testdata/ruby_cases.json`.

mod files;
mod html;
mod parser;

pub use files::{ensure_text_extension, read_utf8, write_utf8_atomic, FileError};
pub use html::render_html;
pub use parser::{is_kanji, parse, Segment};
