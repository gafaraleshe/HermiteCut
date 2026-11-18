//! hermitecut-mcp: the bridge Claude Desktop starts to use HermiteCut.
//!
//! Claude Desktop runs local MCP servers as programs that speak JSON-RPC on
//! stdin and stdout, one message per line. HermiteCut's MCP server lives in
//! the running app (core/mcp/server.ts) on 127.0.0.1. This program forwards
//! each message there and prints the reply. It finds the server through
//! ~/.hermitecut/mcp.json, which the app writes when it starts, and only ever
//! connects to this computer.

use serde_json::{json, Value};
use std::io::{self, BufRead, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::Duration;

const NOT_RUNNING: &str =
    "HermiteCut isn't running. Open the HermiteCut app (or its panel in DaVinci Resolve), then try again.";

#[derive(Debug, PartialEq, Eq)]
struct Server {
    host: String,
    port: u16,
    path: String,
    token: String,
}

fn discovery_file() -> PathBuf {
    if let Some(p) = std::env::var_os("HERMITECUT_MCP_DISCOVERY") {
        return PathBuf::from(p);
    }
    let home =
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap_or_default();
    PathBuf::from(home).join(".hermitecut").join("mcp.json")
}

/// Where the app's server is, from mcp.json. Refuses anything but this computer.
fn parse_discovery(text: &str) -> Result<Server, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("mcp.json: {e}"))?;
    let url = v["url"].as_str().ok_or("mcp.json has no url")?;
    let token = v["token"]
        .as_str()
        .ok_or("mcp.json has no token")?
        .to_string();
    let rest = url
        .strip_prefix("http://")
        .ok_or("the server url must be http://127.0.0.1")?;
    let (hostport, path) = rest.split_once('/').map_or((rest, "/"), |(h, p)| (h, p));
    let (host, port) = hostport
        .rsplit_once(':')
        .ok_or("the server url has no port")?;
    if host != "127.0.0.1" && host != "localhost" {
        return Err(format!(
            "refusing to send the token to {host}: HermiteCut's server is local only"
        ));
    }
    Ok(Server {
        host: host.to_string(),
        port: port.parse().map_err(|_| "bad port in mcp.json")?,
        path: format!("/{}", path.trim_start_matches('/')),
        token,
    })
}

fn decode_chunked(mut body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    while let Some(i) = body.windows(2).position(|w| w == b"\r\n") {
        let size = usize::from_str_radix(
            String::from_utf8_lossy(&body[..i])
                .split(';')
                .next()
                .unwrap_or("0")
                .trim(),
            16,
        )
        .unwrap_or(0);
        if size == 0 || body.len() < i + 2 + size {
            break;
        }
        out.extend_from_slice(&body[i + 2..i + 2 + size]);
        body = &body[(i + 2 + size + 2).min(body.len())..];
    }
    out
}

/// POST one message; returns the HTTP status and body.
fn post(s: &Server, body: &str) -> io::Result<(u16, String)> {
    let addr = format!("{}:{}", s.host, s.port);
    let mut stream = TcpStream::connect(&addr)?;
    stream.set_read_timeout(Some(Duration::from_secs(300)))?;
    write!(
        stream,
        "POST {} HTTP/1.1\r\nHost: {addr}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        s.path,
        s.token,
        body.len()
    )?;
    stream.flush()?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw)?;
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| io::Error::other("bad HTTP reply"))?;
    let head = String::from_utf8_lossy(&raw[..split]).to_string();
    let status = head
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);
    let chunked = head.lines().any(|l| {
        l.to_ascii_lowercase().starts_with("transfer-encoding:")
            && l.to_ascii_lowercase().contains("chunked")
    });
    let payload = &raw[split + 4..];
    let body = if chunked {
        decode_chunked(payload)
    } else {
        payload.to_vec()
    };
    Ok((status, String::from_utf8_lossy(&body).into_owned()))
}

fn error_reply(id: &Value, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": message } })
        .to_string()
}

/// One stdin line in, the line to print out (if any).
fn forward(server: Result<Server, String>, line: &str) -> Option<String> {
    let id = serde_json::from_str::<Value>(line)
        .ok()
        .and_then(|v| v.get("id").cloned())
        .unwrap_or(Value::Null);
    let is_request = !id.is_null();
    let server = match server {
        Ok(s) => s,
        Err(e) => return is_request.then(|| error_reply(&id, &format!("{NOT_RUNNING} ({e})"))),
    };
    match post(&server, line) {
        Ok((200, body)) => Some(body.trim().to_string()).filter(|b| !b.is_empty()),
        Ok((202, _)) => None,
        Ok((401, _)) => is_request.then(|| {
            error_reply(
                &id,
                "HermiteCut refused the key. Restart HermiteCut and Claude.",
            )
        }),
        Ok((status, body)) => is_request.then(|| {
            error_reply(
                &id,
                &format!("HermiteCut answered {status}: {}", body.trim()),
            )
        }),
        Err(_) => is_request.then(|| error_reply(&id, NOT_RUNNING)),
    }
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // read mcp.json for every message, so a restarted app (new port) is found
        let server = std::fs::read_to_string(discovery_file())
            .map_err(|_| "no ~/.hermitecut/mcp.json".to_string())
            .and_then(|t| parse_discovery(&t));
        if let Some(out) = forward(server, line) {
            if writeln!(stdout, "{out}")
                .and_then(|_| stdout.flush())
                .is_err()
            {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    /// A one-shot HTTP server that checks the request and sends `reply`.
    fn serve_once(reply: &'static str) -> (u16, thread::JoinHandle<String>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut buf = [0u8; 8192];
            let mut req = Vec::new();
            loop {
                let n = s.read(&mut buf).unwrap();
                req.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&req).to_string();
                if let Some(i) = text.find("\r\n\r\n") {
                    let len: usize = text
                        .lines()
                        .find_map(|l| l.strip_prefix("Content-Length: "))
                        .and_then(|v| v.trim().parse().ok())
                        .unwrap_or(0);
                    if req.len() >= i + 4 + len {
                        break;
                    }
                }
            }
            s.write_all(reply.as_bytes()).unwrap();
            String::from_utf8_lossy(&req).to_string()
        });
        (port, h)
    }

    fn server(port: u16) -> Server {
        Server {
            host: "127.0.0.1".into(),
            port,
            path: "/mcp".into(),
            token: "t0k".into(),
        }
    }

    #[test]
    fn reads_discovery_and_stays_local() {
        let s = parse_discovery(r#"{"url":"http://127.0.0.1:47361/mcp","token":"abc","pid":1}"#)
            .unwrap();
        assert_eq!(
            s,
            Server {
                host: "127.0.0.1".into(),
                port: 47361,
                path: "/mcp".into(),
                token: "abc".into()
            }
        );
        assert!(
            parse_discovery(r#"{"url":"http://evil.example:80/mcp","token":"abc"}"#)
                .unwrap_err()
                .contains("local only")
        );
        assert!(parse_discovery(r#"{"url":"https://127.0.0.1:1/mcp","token":"abc"}"#).is_err());
        assert!(parse_discovery("{}").is_err());
    }

    #[test]
    fn forwards_a_request_with_the_token() {
        let body = r#"{"jsonrpc":"2.0","id":1,"result":{}}"#;
        let reply: &'static str = Box::leak(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()).into_boxed_str());
        let (port, h) = serve_once(reply);
        let out = forward(
            Ok(server(port)),
            r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#,
        );
        assert_eq!(out.as_deref(), Some(body));
        let req = h.join().unwrap();
        assert!(req.starts_with("POST /mcp HTTP/1.1"));
        assert!(req.contains("Authorization: Bearer t0k"));
        assert!(req.ends_with(r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#));
    }

    #[test]
    fn notifications_print_nothing() {
        let (port, h) = serve_once("HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\n\r\n");
        assert_eq!(
            forward(
                Ok(server(port)),
                r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#
            ),
            None
        );
        h.join().unwrap();
    }

    #[test]
    fn chunked_replies_are_decoded() {
        let (port, h) = serve_once("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\n{\"a\":\r\n2\r\n1}\r\n0\r\n\r\n");
        assert_eq!(
            forward(Ok(server(port)), r#"{"id":2,"method":"x"}"#).as_deref(),
            Some(r#"{"a":1}"#)
        );
        h.join().unwrap();
    }

    #[test]
    fn says_when_hermitecut_is_not_running() {
        let free = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let out = forward(
            Ok(server(free)),
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/list"}"#,
        )
        .unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["id"], 7);
        assert!(v["error"]["message"]
            .as_str()
            .unwrap()
            .contains("isn't running"));
        assert!(forward(
            Err("no file".into()),
            r#"{"method":"notifications/initialized"}"#
        )
        .is_none());
        assert!(
            forward(Err("no file".into()), r#"{"id":"a","method":"initialize"}"#)
                .unwrap()
                .contains("isn't running")
        );
    }
}
