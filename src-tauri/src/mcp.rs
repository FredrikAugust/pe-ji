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
                "serverInfo": { "name": "pico-sakubun", "version": env!("CARGO_PKG_VERSION") },
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

const INSTRUCTIONS: &str = "This is ぴこぴこ作文帳, a Japanese homework editor for a learner. \
Read the document, then leave notes or corrections on exact quotes from it. \
Prefer add_note with kind \"correction\" and a suggestion over replace_text, so the learner decides. \
Write comments in simple English unless asked otherwise.";

const MARKUP: &str = "The text is the file's source: `# `/`## `/`### ` headings, `- ` bullets, leading tabs for indent, \
`**bold**`, `*italic*`, `| a | b |` table rows, ruby as `漢字《かんじ》`, `｜食べ《た》` or `{漢字|かんじ}`, \
and Aozora notes `［＃…］`. Furigana shown on screen is automatic and not in the text.";

fn tools() -> Value {
    let quote = json!({ "type": "string", "description": "Exact text copied from read_document." });
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
    ])
}

fn call(name: &str, args: &Value, state: &Mcp, emit: &dyn Fn(&str, Value)) -> Result<String, String> {
    let doc = state.doc.lock().unwrap();
    let str_arg = |k: &str| args[k].as_str().map(str::to_string);
    let find = |quote: &Option<String>| -> Result<(String, u64), String> {
        let q = quote.clone().filter(|q| !q.is_empty()).ok_or("quote is required")?;
        let n = args["occurrence"].as_u64().unwrap_or(1).max(1);
        let count = doc.text.matches(q.as_str()).count() as u64;
        if count < n {
            return Err(format!("quote not found in the document ({count} matches); copy it exactly from read_document"));
        }
        Ok((q, n))
    };
    match name {
        "read_document" => Ok(json!({ "name": doc.name, "text": doc.text, "selection": doc.selection }).to_string()),
        "list_notes" => Ok(doc.notes.to_string()),
        "add_note" => {
            let (quote, occurrence) = find(&str_arg("quote"))?;
            let comment = str_arg("comment").filter(|c| !c.trim().is_empty()).ok_or("comment is required")?;
            let kind = if args["kind"] == "correction" { "correction" } else { "note" };
            let id = format!("n{}", state.next_note.fetch_add(1, Ordering::SeqCst) + 1);
            emit(
                "mcp-note",
                json!({ "id": id, "quote": quote, "occurrence": occurrence, "comment": comment, "kind": kind, "suggestion": str_arg("suggestion") }),
            );
            Ok(format!("added note {id}"))
        }
        "remove_note" => {
            let id = str_arg("id").ok_or("id is required")?;
            emit("mcp-remove-note", json!({ "id": id }));
            Ok(format!("removed note {id}"))
        }
        "replace_text" => {
            let (quote, occurrence) = find(&str_arg("quote"))?;
            let replacement = str_arg("replacement").ok_or("replacement is required")?;
            emit("mcp-replace", json!({ "quote": quote, "occurrence": occurrence, "replacement": replacement }));
            Ok("replaced".into())
        }
        _ => Err(format!("unknown tool {name}")),
    }
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
        assert_eq!(rpc(&state, "tools/list", json!({})).0["result"]["tools"].as_array().unwrap().len(), 5);

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
    fn token_compare_is_exact() {
        assert!(same(b"Bearer abc", b"Bearer abc"));
        assert!(!same(b"Bearer abd", b"Bearer abc"));
        assert!(!same(b"Bearer ab", b"Bearer abc"));
    }
}
