//! Aozora-style and brace furigana markup.
//!
//! * `漢字《かんじ》` — implicit base: the kanji run immediately before `《`.
//! * `｜漢字《かんじ》` or `|食べ《た》` — explicit base (pipe may be full-width).
//! * `{漢字|かんじ}` — brace form. The separator is a half-width `|`.
//!
//! A backslash escapes the next character (`\《`, `\{`, `\\`, …). Ruby never
//! crosses a newline. Unmatched brackets stay as literal text. An empty base
//! is not ruby; an empty reading is ruby with an empty `<rt>`.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Segment {
    Text(String),
    Ruby { base: String, reading: String },
}

pub fn parse(input: &str) -> Vec<Segment> {
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    while i < chars.len() {
        let c = chars[i];
        if c == '\\' {
            if let Some(n) = chars.get(i + 1).copied() {
                if !is_nl(n) {
                    push_text(&mut out, n);
                    i += 2;
                    continue;
                }
            }
            push_text(&mut out, '\\');
            i += 1;
            continue;
        }
        if c == '{' {
            if let Some((base, reading, next)) = try_brace(&chars, i) {
                push_ruby(&mut out, base, reading);
                i = next;
                continue;
            }
        }
        if c == '|' || c == '｜' {
            if let Some((base, reading, next)) = try_explicit(&chars, i) {
                push_ruby(&mut out, base, reading);
                i = next;
                continue;
            }
        }
        if is_kanji(c) {
            let start = i;
            let mut j = i;
            while j < chars.len() && is_kanji(chars[j]) {
                j += 1;
            }
            if let Some((reading, next)) = try_reading(&chars, j) {
                let base: String = chars[start..j].iter().collect();
                push_ruby(&mut out, base, reading);
                i = next;
                continue;
            }
            for &ch in &chars[start..j] {
                push_text(&mut out, ch);
            }
            i = j;
            continue;
        }
        push_text(&mut out, c);
        i += 1;
    }
    out
}

pub fn is_kanji(c: char) -> bool {
    matches!(
        c,
        '\u{3005}' | '\u{3006}' | '\u{303B}' | '\u{30F5}' | '\u{30F6}'
    ) || ('\u{3400}'..='\u{4DBF}').contains(&c)
        || ('\u{4E00}'..='\u{9FFF}').contains(&c)
        || ('\u{F900}'..='\u{FAFF}').contains(&c)
        || ('\u{20000}'..='\u{2A6DF}').contains(&c)
        || ('\u{2A700}'..='\u{2B73F}').contains(&c)
        || ('\u{2B740}'..='\u{2B81F}').contains(&c)
        || ('\u{2B820}'..='\u{2CEAF}').contains(&c)
        || ('\u{2CEB0}'..='\u{2EBEF}').contains(&c)
        || ('\u{30000}'..='\u{3134F}').contains(&c)
        || ('\u{2F800}'..='\u{2FA1F}').contains(&c)
}

fn is_nl(c: char) -> bool {
    c == '\n' || c == '\r'
}

fn push_text(out: &mut Vec<Segment>, ch: char) {
    if let Some(Segment::Text(t)) = out.last_mut() {
        t.push(ch);
    } else {
        out.push(Segment::Text(ch.to_string()));
    }
}

fn push_ruby(out: &mut Vec<Segment>, base: String, reading: String) {
    out.push(Segment::Ruby { base, reading });
}

fn try_reading(chars: &[char], i: usize) -> Option<(String, usize)> {
    if i >= chars.len() || chars[i] != '《' {
        return None;
    }
    let mut j = i + 1;
    let mut reading = String::new();
    while j < chars.len() {
        let c = chars[j];
        if is_nl(c) {
            return None;
        }
        if c == '\\' {
            if j + 1 < chars.len() {
                let n = chars[j + 1];
                if !is_nl(n) {
                    reading.push(n);
                    j += 2;
                    continue;
                }
            }
            return None;
        }
        if c == '》' {
            return Some((reading, j + 1));
        }
        reading.push(c);
        j += 1;
    }
    None
}

fn try_explicit(chars: &[char], i: usize) -> Option<(String, String, usize)> {
    let mut j = i + 1;
    let mut base = String::new();
    while j < chars.len() {
        let c = chars[j];
        if is_nl(c) {
            return None;
        }
        if c == '\\' {
            if j + 1 < chars.len() {
                let n = chars[j + 1];
                if !is_nl(n) {
                    base.push(n);
                    j += 2;
                    continue;
                }
            }
            return None;
        }
        if c == '《' {
            if base.is_empty() {
                return None;
            }
            let (reading, next) = try_reading(chars, j)?;
            return Some((base, reading, next));
        }
        base.push(c);
        j += 1;
    }
    None
}

fn try_brace(chars: &[char], i: usize) -> Option<(String, String, usize)> {
    let mut j = i + 1;
    let mut base = String::new();
    let mut reading = String::new();
    let mut saw_pipe = false;
    while j < chars.len() {
        let c = chars[j];
        if is_nl(c) {
            return None;
        }
        if c == '\\' {
            if j + 1 < chars.len() {
                let n = chars[j + 1];
                if !is_nl(n) {
                    if saw_pipe {
                        reading.push(n);
                    } else {
                        base.push(n);
                    }
                    j += 2;
                    continue;
                }
            }
            return None;
        }
        if c == '|' && !saw_pipe {
            saw_pipe = true;
            j += 1;
            continue;
        }
        if c == '}' {
            if !saw_pipe || base.is_empty() {
                return None;
            }
            return Some((base, reading, j + 1));
        }
        if saw_pipe {
            reading.push(c);
        } else {
            base.push(c);
        }
        j += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render_html;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    struct Fixture {
        cases: Vec<Case>,
    }

    #[derive(Debug, Deserialize)]
    struct Case {
        name: String,
        input: String,
        segments: Vec<Expect>,
        html: String,
    }

    #[derive(Debug, Deserialize)]
    struct Expect {
        #[serde(rename = "type")]
        kind: String,
        text: Option<String>,
        base: Option<String>,
        reading: Option<String>,
    }

    #[test]
    fn shared_fixtures() {
        let raw = include_str!("../../../testdata/ruby_cases.json");
        let fixture: Fixture = serde_json::from_str(raw).expect("fixture json");
        assert!(fixture.cases.len() >= 40, "expected a thorough fixture set");
        for case in fixture.cases {
            let got = parse(&case.input);
            assert_eq!(got.len(), case.segments.len(), "segment count: {}", case.name);
            for (seg, exp) in got.iter().zip(case.segments.iter()) {
                match (seg, exp.kind.as_str()) {
                    (Segment::Text(t), "text") => {
                        assert_eq!(t, exp.text.as_deref().unwrap_or(""), "text: {}", case.name);
                    }
                    (Segment::Ruby { base, reading }, "ruby") => {
                        assert_eq!(base, exp.base.as_deref().unwrap_or(""), "base: {}", case.name);
                        assert_eq!(
                            reading,
                            exp.reading.as_deref().unwrap_or(""),
                            "reading: {}",
                            case.name
                        );
                    }
                    (other, kind) => panic!("{}: got {other:?} expected {kind}", case.name),
                }
            }
            assert_eq!(render_html(&case.input), case.html, "html: {}", case.name);
        }
    }

    #[test]
    fn garbage_does_not_panic() {
        for s in [
            "",
            "《",
            "》",
            "{",
            "}",
            "|",
            "｜",
            "\\",
            "{|}",
            "《》",
            "a《b",
            "{a|",
            "|\n《》",
            "漢字《",
            "{{{{",
            "》》》",
            "\\\n",
            "{漢字|かん\nじ}",
        ] {
            let _ = parse(s);
            let _ = render_html(s);
        }
    }

    #[test]
    fn extension_b_kanji_is_a_base() {
        let ch = char::from_u32(0x2000B).unwrap();
        assert!(is_kanji(ch));
        let input = format!("{ch}《あ》");
        match &parse(&input)[..] {
            [Segment::Ruby { base, reading }] => {
                assert_eq!(base, &ch.to_string());
                assert_eq!(reading, "あ");
            }
            other => panic!("unexpected {other:?}"),
        }
    }
}
