//! A small MCP server (streamable HTTP, JSON responses only) so an AI can read
//! the open document and leave notes and corrections on it.
//!
//! The web view pushes a snapshot of the document here (`mcp_sync`); reads are
//! served from it. Writes are checked against it and then sent to the web view
//! as `mcp-*` events, which applies them as normal edits.

use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::{Emitter, Manager};

pub const PORT: u16 = 4417;
const MAX_BODY: u64 = 4 << 20;
const VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

#[derive(Default)]
pub struct Doc {
    pub name: String,
    pub text: String,
    pub selection: String,
    pub notes: Value,
}

#[derive(Default)]
pub struct Mcp {
    pub doc: Mutex<Doc>,
    started: Mutex<Option<String>>,
    next_note: AtomicU64,
}

#[tauri::command]
pub fn mcp_sync(state: tauri::State<Mcp>, name: String, text: String, selection: String, notes: Value) {
    *state.doc.lock().unwrap() = Doc { name, text, selection, notes };
}

/// One MCP message that arrived through the cloud relay (the page holds that socket).
#[tauri::command]
pub fn mcp_handle(app: tauri::AppHandle, state: tauri::State<Mcp>, msg: Value) -> Option<Value> {
    handle(&msg, &state, &|event, payload| {
        let _ = app.emit(event, payload);
    })
}

/// Start the server once per run. Returns `{ url, token }`.
#[tauri::command]
pub fn mcp_start(app: tauri::AppHandle) -> Result<Value, String> {
    let state = app.state::<Mcp>();
    let mut started = state.started.lock().unwrap();
    if started.is_none() {
        let token = load_token(&app)?;
        let server = tiny_http::Server::http(("127.0.0.1", PORT)).map_err(|e| format!("port {PORT}: {e}"))?;
        let handle = app.clone();
        let t = token.clone();
        std::thread::spawn(move || {
            let state = handle.state::<Mcp>();
            serve(server, &t, &state, &|event, payload| {
                let _ = handle.emit(event, payload);
            })
        });
        *started = Some(token);
    }
    Ok(json!({ "url": format!("http://127.0.0.1:{PORT}/mcp"), "token": started.clone() }))
}

fn load_token(app: &tauri::AppHandle) -> Result<String, String> {
    let file = app.path().app_config_dir().map_err(|e| e.to_string())?.join("mcp.token");
    if let Ok(t) = std::fs::read_to_string(&file) {
        if t.trim().len() >= 32 {
            return Ok(t.trim().to_string());
        }
    }
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    crate::write_atomic(&file, token.as_bytes()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
    }
    Ok(token)
}

fn serve(server: tiny_http::Server, token: &str, state: &Mcp, emit: &dyn Fn(&str, Value)) {
    for mut req in server.incoming_requests() {
        let (status, body) = respond(&mut req, token, state, emit);
        let mut res = tiny_http::Response::from_string(body).with_status_code(status);
        if status == 200 {
            res.add_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap());
        }
        let _ = req.respond(res);
    }
}

fn respond(req: &mut tiny_http::Request, token: &str, state: &Mcp, emit: &dyn Fn(&str, Value)) -> (u16, String) {
    if req.url().split('?').next() != Some("/mcp") {
        return (404, String::new());
    }
    let auth = req.headers().iter().find(|h| h.field.equiv("Authorization")).map(|h| h.value.as_str().to_string());
    if !auth.is_some_and(|a| same(a.as_bytes(), format!("Bearer {token}").as_bytes())) {
        return (401, String::new());
    }
    if *req.method() != tiny_http::Method::Post {
        return (405, String::new());
    }
    let mut body = String::new();
    if req.as_reader().take(MAX_BODY).read_to_string(&mut body).is_err() {
        return (400, String::new());
    }
    let Ok(msg) = serde_json::from_str::<Value>(&body) else {
        return (400, json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "parse error" } }).to_string());
    };
    match handle(&msg, state, emit) {
        Some(reply) => (200, reply.to_string()),
        None => (202, String::new()),
    }
}

/// Constant-time comparison, so the token cannot be guessed byte by byte through a tunnel.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// One JSON-RPC message in, the reply out (`None` for notifications).
pub fn handle(msg: &Value, state: &Mcp, emit: &dyn Fn(&str, Value)) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let params = msg.get("params").cloned().unwrap_or(json!({}));
    let result = match msg.get("method").and_then(Value::as_str).unwrap_or("") {
        "initialize" => {
            let asked = params["protocolVersion"].as_str().unwrap_or("");
            json!({
                "protocolVersion": VERSIONS.iter().find(|v| **v == asked).unwrap_or(&VERSIONS[0]),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "pe-ji", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS,
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            let name = params["name"].as_str().unwrap_or("");
            let args = &params["arguments"];
            match call(name, args, state, emit) {
                Ok(text) => json!({ "content": [{ "type": "text", "text": text }] }),
                Err(text) => json!({ "content": [{ "type": "text", "text": text }], "isError": true }),
            }
        }
        _ => return Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "method not found" } })),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

const INSTRUCTIONS: &str = "This is pe-ji, a small Japanese word processor for a learner. \
Read the document, then leave notes or corrections on exact quotes from it. \
Prefer add_note with kind \"correction\" and a suggestion over replace_text, so the learner decides. \
Use insert_text to add new text when asked. \
Write comments in simple English unless asked otherwise.";

const MARKUP: &str = "The text is the file's source: `# `/`## `/`### ` headings, `- ` bullets, leading tabs for indent, \
`**bold**`, `*italic*`, `| a | b |` table rows, ruby as `漢字《かんじ》`, `｜食べ《た》` or `{漢字|かんじ}`, \
and Aozora notes `［＃…］`. Furigana shown on screen is automatic and not in the text.";

fn tools() -> Value {
    let quote = json!({ "type": "string", "description": "Text from the document as the learner sees it; ruby readings and markup may be left out." });
    let occurrence = json!({ "type": "integer", "minimum": 1, "description": "Which match of quote, if it appears more than once (default 1)." });
    json!([
        {
            "name": "read_document",
            "description": format!("The open document: file name, full text and the learner's current selection. {MARKUP}"),
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "list_notes",
            "description": "Notes and corrections currently on the document.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "add_note",
            "description": "Mark a quote in the document with a note, or a correction with a suggested replacement the learner can apply.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "quote": quote,
                    "comment": { "type": "string", "description": "What is wrong or worth knowing, shown to the learner." },
                    "kind": { "type": "string", "enum": ["correction", "note"], "description": "Default \"note\"." },
                    "suggestion": { "type": "string", "description": "Replacement text for a correction." },
                    "occurrence": occurrence,
                },
                "required": ["quote", "comment"],
            },
        },
        {
            "name": "remove_note",
            "description": "Remove a note by id.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] },
            "annotations": { "destructiveHint": true },
        },
        {
            "name": "replace_text",
            "description": "Replace a quote in the document directly. The learner can undo it. Prefer add_note with a suggestion.",
            "inputSchema": {
                "type": "object",
                "properties": { "quote": quote, "replacement": { "type": "string" }, "occurrence": occurrence },
                "required": ["quote", "replacement"],
            },
            "annotations": { "destructiveHint": true },
        },
        {
            "name": "insert_text",
            "description": "Insert text into the document: right after the quote `after`, right before the quote `before`, or at the end when neither is given. Include any line breaks (\\n) yourself. The learner can undo it.",
            "inputSchema": {
                "type": "object",
                "properties": { "text": { "type": "string" }, "after": quote, "before": quote, "occurrence": occurrence },
                "required": ["text"],
            },
        },
    ])
}

fn call(name: &str, args: &Value, state: &Mcp, emit: &dyn Fn(&str, Value)) -> Result<String, String> {
    let doc = state.doc.lock().unwrap();
    let str_arg = |k: &str| args[k].as_str().map(str::to_string);
    // The quote as the AI wrote it, and where it sits in the source: (quote, source text, UTF-16 offset).
    let find = |quote: &Option<String>| -> Result<(String, String, usize), String> {
        let q = quote.clone().filter(|q| !q.trim().is_empty()).ok_or("quote is required")?;
        let n = args["occurrence"].as_u64().unwrap_or(1).max(1) as usize;
        let found = matches(&doc.text, &q);
        let Some(&(start, end)) = found.get(n - 1) else {
            return Err(format!("quote not found in the document ({} matches)", found.len()));
        };
        Ok((q, doc.text[start..end].to_string(), doc.text[..start].encode_utf16().count()))
    };
    match name {
        "read_document" => Ok(json!({ "name": doc.name, "text": doc.text, "selection": doc.selection }).to_string()),
        "list_notes" => Ok(doc.notes.to_string()),
        "add_note" => {
            let (quote, source, at) = find(&str_arg("quote"))?;
            let comment = str_arg("comment").filter(|c| !c.trim().is_empty()).ok_or("comment is required")?;
            let kind = if args["kind"] == "correction" { "correction" } else { "note" };
            let id = format!("n{}", state.next_note.fetch_add(1, Ordering::SeqCst) + 1);
            emit(
                "mcp-note",
                json!({ "id": id, "quote": quote, "source": source, "at": at, "comment": comment, "kind": kind, "suggestion": str_arg("suggestion") }),
            );
            Ok(format!("added note {id}"))
        }
        "remove_note" => {
            let id = str_arg("id").ok_or("id is required")?;
            emit("mcp-remove-note", json!({ "id": id }));
            Ok(format!("removed note {id}"))
        }
        "replace_text" => {
            let (_, source, at) = find(&str_arg("quote"))?;
            let replacement = str_arg("replacement").ok_or("replacement is required")?;
            emit("mcp-replace", json!({ "source": source, "at": at, "replacement": replacement }));
            Ok("replaced".into())
        }
        // An insert is a replace of the anchor quote with itself plus the text, or of "" at the end.
        "insert_text" => {
            let text = str_arg("text").filter(|t| !t.is_empty()).ok_or("text is required")?;
            let (source, at, replacement) = if args["after"].is_string() {
                let (_, source, at) = find(&str_arg("after"))?;
                (source.clone(), at, source + &text)
            } else if args["before"].is_string() {
                let (_, source, at) = find(&str_arg("before"))?;
                (source.clone(), at, text + &source)
            } else {
                (String::new(), doc.text.encode_utf16().count(), text)
            };
            emit("mcp-replace", json!({ "source": source, "at": at, "replacement": replacement }));
            Ok("inserted".into())
        }
        _ => Err(format!("unknown tool {name}")),
    }
}

/// Byte ranges of `quote` in the source `text`, reading it the way the page shows it:
/// ruby readings `《…》`, ruby bars `｜`, Aozora notes `［＃…］` and `*` emphasis in the
/// text are skipped, so "今日は" finds `今日《きょう》は`. A match keeps the word's own
/// reading and bar, so replacing it never leaves half a ruby behind.
fn matches(text: &str, quote: &str) -> Vec<(usize, usize)> {
    let q: Vec<char> = quote.chars().collect();
    let mut out = Vec::new();
    let mut start = 0;
    while start < text.len() {
        match match_at(text, start, &q) {
            Some(end) => {
                let from = if text[..start].ends_with('｜') { start - '｜'.len_utf8() } else { start };
                out.push((from, end));
                start = end;
            }
            None => start += text[start..].chars().next().map_or(1, char::len_utf8),
        }
    }
    out
}

fn match_at(text: &str, start: usize, q: &[char]) -> Option<usize> {
    let (mut i, mut k) = (start, 0);
    while k < q.len() {
        let c = text[i..].chars().next()?;
        if c == q[k] {
            i += c.len_utf8();
            k += 1;
        } else if k > 0 {
            i = skip_markup(text, i)?;
        } else {
            return None;
        }
    }
    // Take the last word's reading along with it.
    Some(if text[i..].starts_with('《') { skip_markup(text, i).unwrap_or(i) } else { i })
}

fn skip_markup(text: &str, i: usize) -> Option<usize> {
    let rest = &text[i..];
    let close = |open: &str, close: char| rest.starts_with(open).then(|| rest.find(close).map(|j| i + j + close.len_utf8())).flatten();
    close("《", '》').or_else(|| close("［＃", '］')).or_else(|| ["｜", "*"].iter().find(|m| rest.starts_with(**m)).map(|m| i + m.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn rpc(state: &Mcp, method: &str, params: Value) -> (Value, Vec<(String, Value)>) {
        let events = RefCell::new(vec![]);
        let reply = handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }), state, &|e, p| {
            events.borrow_mut().push((e.to_string(), p))
        })
        .unwrap();
        (reply, events.into_inner())
    }

    #[test]
    fn reads_and_checks_quotes_before_writing() {
        let state = Mcp::default();
        *state.doc.lock().unwrap() = Doc { name: "a.txt".into(), text: "昨日は学校に行きました。".into(), selection: "".into(), notes: json!([]) };

        let (init, _) = rpc(&state, "initialize", json!({ "protocolVersion": "2025-03-26" }));
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(rpc(&state, "tools/list", json!({})).0["result"]["tools"].as_array().unwrap().len(), 6);

        let (read, _) = rpc(&state, "tools/call", json!({ "name": "read_document", "arguments": {} }));
        assert!(read["result"]["content"][0]["text"].as_str().unwrap().contains("学校"));

        let (bad, events) = rpc(&state, "tools/call", json!({ "name": "add_note", "arguments": { "quote": "公園", "comment": "x" } }));
        assert_eq!(bad["result"]["isError"], true);
        assert!(events.is_empty());

        let args = json!({ "quote": "行きました", "comment": "Fine.", "kind": "correction", "suggestion": "行った" });
        let (ok, events) = rpc(&state, "tools/call", json!({ "name": "add_note", "arguments": args }));
        assert_eq!(ok["result"]["content"][0]["text"], "added note n1");
        assert_eq!(events[0].0, "mcp-note");
        assert_eq!(events[0].1["suggestion"], "行った");
        assert_eq!((events[0].1["source"].as_str(), events[0].1["at"].as_u64()), (Some("行きました"), Some(6)));

        let ins = |args: Value| rpc(&state, "tools/call", json!({ "name": "insert_text", "arguments": args })).1[0].1.clone();
        assert_eq!(ins(json!({ "text": "楽しかった。", "after": "行きました。" })), json!({ "source": "行きました。", "at": 6, "replacement": "行きました。楽しかった。" }));
        assert_eq!(ins(json!({ "text": "今日、", "before": "学校" }))["replacement"], "今日、学校");
        assert_eq!(ins(json!({ "text": "\n終わり" })), json!({ "source": "", "at": 12, "replacement": "\n終わり" }));

        assert!(handle(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }), &state, &|_, _| {}).is_none());
        assert_eq!(rpc(&state, "nope", json!({})).0["error"]["code"], -32601);
    }

    #[test]
    fn http_needs_the_token() {
        use std::io::Write;
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        std::thread::spawn(move || serve(server, "secret", &Mcp::default(), &|_, _| {}));
        let post = |auth: &str| {
            let body = r#"{"jsonrpc":"2.0","id":7,"method":"ping"}"#;
            let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(s, "POST /mcp HTTP/1.1\r\nHost: x\r\n{auth}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            let mut out = String::new();
            s.read_to_string(&mut out).unwrap();
            out
        };
        assert!(post("").starts_with("HTTP/1.1 401"));
        assert!(post("Authorization: Bearer nope\r\n").starts_with("HTTP/1.1 401"));
        let ok = post("Authorization: Bearer secret\r\n");
        assert!(ok.starts_with("HTTP/1.1 200"), "{ok}");
        assert!(ok.ends_with(r#"{"id":7,"jsonrpc":"2.0","result":{}}"#), "{ok}");
    }

    #[test]
    fn quotes_match_what_the_page_shows() {
        let text = "今日《きょう》はもっと｜食べ《た》たい。**大事**な［＃傍点］話";
        let src = |q: &str| matches(text, q).iter().map(|&(s, e)| &text[s..e]).collect::<Vec<_>>();
        assert_eq!(src("今日はもっと"), ["今日《きょう》はもっと"]);
        assert_eq!(src("今日"), ["今日《きょう》"]);
        assert_eq!(src("食べたい"), ["｜食べ《た》たい"]);
        assert_eq!(src("大事な話"), ["大事**な［＃傍点］話"]);
        assert_eq!(src("きょう"), ["きょう"]);
        assert!(src("明日").is_empty());
        assert_eq!(matches("あいあい", "あい").len(), 2);
    }

    #[test]
    fn token_compare_is_exact() {
        assert!(same(b"Bearer abc", b"Bearer abc"));
        assert!(!same(b"Bearer abd", b"Bearer abc"));
        assert!(!same(b"Bearer ab", b"Bearer abc"));
    }
}
