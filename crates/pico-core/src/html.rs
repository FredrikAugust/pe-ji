//! Escape parsed segments into HTML `<ruby>` / `<rt>`.

use crate::parser::{parse, Segment};

pub fn render_html(input: &str) -> String {
    let mut out = String::new();
    for seg in parse(input) {
        match seg {
            Segment::Text(t) => push_text_html(&mut out, &t),
            Segment::Ruby { base, reading } => {
                out.push_str("<ruby>");
                push_escaped(&mut out, &base);
                out.push_str("<rt>");
                push_escaped(&mut out, &reading);
                out.push_str("</rt></ruby>");
            }
        }
    }
    out
}

fn push_text_html(out: &mut String, text: &str) {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\r' {
            out.push_str("<br>");
            if i + 1 < chars.len() && chars[i + 1] == '\n' {
                i += 1;
            }
            i += 1;
            continue;
        }
        if chars[i] == '\n' {
            out.push_str("<br>");
            i += 1;
            continue;
        }
        push_esc_char(out, chars[i]);
        i += 1;
    }
}

fn push_escaped(out: &mut String, text: &str) {
    for c in text.chars() {
        push_esc_char(out, c);
    }
}

fn push_esc_char(out: &mut String, c: char) {
    match c {
        '&' => out.push_str("&amp;"),
        '<' => out.push_str("&lt;"),
        '>' => out.push_str("&gt;"),
        '"' => out.push_str("&quot;"),
        '\'' => out.push_str("&#39;"),
        _ => out.push(c),
    }
}
