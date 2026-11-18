//! The connection to Resolve: fuscript runs `bridge.lua`, which reads one JSON
//! request per line and answers one JSON reply per line.
//!
//!   request  {"id":1,"h":0,"m":"GetProjectManager","a":[]}   call a method on handle h (0 = Resolve)
//!            {"id":2,"op":"release","h":5}                    forget a handle
//!            {"id":3,"op":"ping"}
//!   reply    {"id":1,"ok":true,"r":{"$h":4}}                 objects come back as handles
//!            {"id":1,"ok":false,"e":"message"}
//!
//! The Rust port of `hosts/resolve/bridge-fuscript.js`.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::fmt;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const NOT_ANSWERING: &str =
    "Resolve did not answer. Is it running, with External scripting set to Local?";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// fuscript is not where Resolve installs it.
    NotFound,
    /// fuscript could not be started.
    Start(String),
    /// fuscript started but Resolve did not accept the connection.
    NotAnswering,
    /// A call took longer than the timeout.
    Timeout(String),
    /// The connection closed.
    Closed,
    /// Resolve (or bridge.lua) reported an error.
    Resolve(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::NotFound => write!(f, "DaVinci Resolve was not found (fuscript is missing)."),
            Error::Start(e) => write!(f, "Could not start fuscript: {e}"),
            Error::NotAnswering => write!(f, "{NOT_ANSWERING}"),
            Error::Timeout(m) => write!(f, "Resolve took too long to answer ({m})."),
            Error::Closed => write!(f, "The connection to Resolve closed."),
            Error::Resolve(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for Error {}

type Reply = Result<Value, Error>;

/// The handle number in a `{"$h": n}` value.
pub fn handle_of(v: &Value) -> Option<u64> {
    let o = v.as_object()?;
    if o.len() == 1 {
        o.get("$h")?.as_u64()
    } else {
        None
    }
}

/// `{"$h": n}`, to pass a Resolve object as an argument.
pub fn handle(n: u64) -> Value {
    json!({ "$h": n })
}

pub struct Bridge {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Arc<Mutex<HashMap<u64, Sender<Reply>>>>,
    seq: AtomicU64,
    alive: Arc<AtomicBool>,
    timeout: Duration,
}

impl Bridge {
    /// Start fuscript with `bridge.lua` and wait for Resolve to accept.
    pub fn start(fuscript: &Path, script: &Path) -> Result<Bridge, Error> {
        let mut cmd = Command::new(fuscript);
        cmd.args(["-l", "lua"]).arg(script);
        Bridge::spawn(cmd, Duration::from_secs(15), Duration::from_secs(30))
    }

    /// Start any command that speaks the protocol (tests use a stand-in).
    pub fn spawn(
        mut cmd: Command,
        ready_timeout: Duration,
        call_timeout: Duration,
    ) -> Result<Bridge, Error> {
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| Error::Start(e.to_string()))?;
        let stdout = child.stdout.take().ok_or(Error::Closed)?;
        let stdin = child.stdin.take().ok_or(Error::Closed)?;
        let pending: Arc<Mutex<HashMap<u64, Sender<Reply>>>> = Arc::default();
        let alive = Arc::new(AtomicBool::new(true));
        let (ready_tx, ready_rx) = mpsc::channel::<bool>();

        let (pending_r, alive_r) = (pending.clone(), alive.clone());
        thread::spawn(move || {
            let mut ready_tx = Some(ready_tx);
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else {
                    continue;
                };
                if let Some(r) = msg.get("ready") {
                    if let Some(tx) = ready_tx.take() {
                        let _ = tx.send(r.as_bool() == Some(true));
                    }
                    continue;
                }
                let Some(id) = msg.get("id").and_then(Value::as_u64) else {
                    continue;
                };
                let Some(tx) = pending_r.lock().unwrap().remove(&id) else {
                    continue;
                };
                let reply = if msg.get("ok").and_then(Value::as_bool) == Some(true) {
                    Ok(msg.get("r").cloned().unwrap_or(Value::Null))
                } else {
                    let e = msg
                        .get("e")
                        .and_then(Value::as_str)
                        .unwrap_or("Resolve error")
                        .to_string();
                    // A method Resolve doesn't have answers null, so feature
                    // checks behave like they do through WorkflowIntegration.node.
                    if e.contains("no method") {
                        Ok(Value::Null)
                    } else {
                        Err(Error::Resolve(e))
                    }
                };
                let _ = tx.send(reply);
            }
            alive_r.store(false, Ordering::SeqCst);
            if let Some(tx) = ready_tx.take() {
                let _ = tx.send(false);
            }
            for (_, tx) in pending_r.lock().unwrap().drain() {
                let _ = tx.send(Err(Error::Closed));
            }
        });

        let ready = ready_rx.recv_timeout(ready_timeout);
        if ready != Ok(true) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Error::NotAnswering);
        }
        Ok(Bridge {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            pending,
            seq: AtomicU64::new(1),
            alive,
            timeout: call_timeout,
        })
    }

    /// Is the connection still open?
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn send(&self, mut req: Value, what: &str) -> Reply {
        if !self.is_alive() {
            return Err(Error::Closed);
        }
        let id = self.seq.fetch_add(1, Ordering::SeqCst);
        req["id"] = json!(id);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let line = format!("{req}\n");
        let written = {
            let mut w = self.stdin.lock().unwrap();
            w.write_all(line.as_bytes()).and_then(|_| w.flush())
        };
        if written.is_err() {
            self.pending.lock().unwrap().remove(&id);
            return Err(Error::Closed);
        }
        match rx.recv_timeout(self.timeout) {
            Ok(r) => r,
            Err(RecvTimeoutError::Timeout) => {
                self.pending.lock().unwrap().remove(&id);
                Err(Error::Timeout(what.to_string()))
            }
            Err(RecvTimeoutError::Disconnected) => Err(Error::Closed),
        }
    }

    /// Call `method` on the object with handle `h` (0 is Resolve itself).
    pub fn call(&self, h: u64, method: &str, args: &[Value]) -> Reply {
        self.send(json!({ "h": h, "m": method, "a": args }), method)
    }

    /// Let bridge.lua forget a handle.
    pub fn release(&self, h: u64) {
        let _ = self.send(json!({ "op": "release", "h": h }), "release");
    }

    /// Is Resolve still answering?
    pub fn ping(&self) -> bool {
        matches!(self.send(json!({ "op": "ping" }), "ping"), Ok(Value::String(s)) if s == "pong")
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        if let Ok(mut c) = self.child.lock() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::time::Instant;

    /// The pretend Resolve behind the fake fuscript (see `fake_server_loop`).
    pub(crate) fn serve_line(line: &str) -> Option<String> {
        let req: Value = serde_json::from_str(line).ok()?;
        let id = req["id"].as_u64()?;
        let ok = |r: Value| Some(json!({ "id": id, "ok": true, "r": r }).to_string());
        let err = |e: &str| Some(json!({ "id": id, "ok": false, "e": e }).to_string());
        if req["op"] == "ping" {
            return ok(json!("pong"));
        }
        if req["op"] == "release" {
            return ok(json!(true));
        }
        match (req["h"].as_u64()?, req["m"].as_str()?) {
            (0, "GetVersionString") => ok(json!("21.2.0")),
            (0, "GetCurrentPage") => ok(json!("edit")),
            (0, "GetProjectManager") => ok(handle(1)),
            (1, "GetCurrentProject") => ok(handle(2)),
            (2, "GetName") => ok(json!("Scratch")),
            (2, "GetCurrentTimeline") => ok(handle(3)),
            (3, "GetName") => ok(json!("Edit 1")),
            (3, "GetSetting") => match req["a"][0].as_str()? {
                "timelineFrameRate" => ok(json!("25")),
                "timelineResolutionWidth" => ok(json!("1080")),
                "timelineResolutionHeight" => ok(json!("1920")),
                _ => ok(Value::Null),
            },
            (3, "GetCurrentTimecode") => ok(json!("01:00:02:10")),
            (_, "Echo") => ok(req["a"].clone()),
            (_, "Slow") => None,
            (_, "Boom") => err("boom"),
            (_, m) => err(&format!("no method {m}")),
        }
    }

    /// Start a bridge against this binary in fake-fuscript mode.
    pub(crate) fn fake(mode: &str, call_timeout: Duration) -> Result<Bridge, Error> {
        let mut cmd = Command::new(std::env::current_exe().unwrap());
        cmd.args([
            "--exact",
            "bridge::tests::fake_server_loop",
            "--nocapture",
            "--test-threads=1",
        ])
        .env("HC_FAKE_FUSCRIPT", mode);
        Bridge::spawn(cmd, Duration::from_secs(20), call_timeout)
    }

    /// When HC_FAKE_FUSCRIPT is set, this test binary acts as fuscript running
    /// bridge.lua against a tiny pretend Resolve; otherwise it does nothing.
    /// libtest's own lines on stdout are not JSON, so the bridge skips them,
    /// as it skips anything fuscript prints that isn't a reply.
    #[test]
    fn fake_server_loop() {
        let Ok(mode) = std::env::var("HC_FAKE_FUSCRIPT") else {
            return;
        };
        let out = std::io::stdout();
        let say = |s: &str| {
            let mut o = out.lock();
            let _ = writeln!(o, "{s}");
            let _ = o.flush();
        };
        if mode == "refuse" {
            say(r#"{"ready":false}"#);
            return;
        }
        say("Fusion fuscript banner (not JSON)");
        say(r#"{"ready":true}"#);
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if let Some(reply) = serve_line(&line) {
                say(&reply);
            }
        }
    }

    #[test]
    fn calls_handles_errors_and_missing_methods() {
        let b = fake("ok", Duration::from_secs(10)).expect("fake fuscript starts");
        assert!(b.ping());
        assert_eq!(b.call(0, "GetVersionString", &[]).unwrap(), json!("21.2.0"));
        let pm = b.call(0, "GetProjectManager", &[]).unwrap();
        assert_eq!(handle_of(&pm), Some(1));
        let args = [json!(1), json!("two"), handle(7), json!({"k": [1, 2]})];
        assert_eq!(b.call(0, "Echo", &args).unwrap(), json!(args));
        assert_eq!(b.call(0, "Boom", &[]), Err(Error::Resolve("boom".into())));
        assert_eq!(b.call(0, "NotAMethod", &[]).unwrap(), Value::Null);
        b.release(1);
        assert!(b.is_alive());
    }

    #[test]
    fn times_out_and_survives() {
        let b = fake("ok", Duration::from_millis(300)).unwrap();
        let t = Instant::now();
        assert_eq!(b.call(0, "Slow", &[]), Err(Error::Timeout("Slow".into())));
        assert!(t.elapsed() < Duration::from_secs(5));
        assert_eq!(b.call(0, "GetCurrentPage", &[]).unwrap(), json!("edit"));
    }

    #[test]
    fn refused_or_missing_fuscript() {
        assert_eq!(
            fake("refuse", Duration::from_secs(1)).err(),
            Some(Error::NotAnswering)
        );
        let missing = Bridge::start(
            Path::new("/definitely/not/fuscript"),
            Path::new("bridge.lua"),
        );
        assert!(matches!(missing.err(), Some(Error::Start(_))));
    }

    #[test]
    fn handles() {
        assert_eq!(handle_of(&json!({"$h": 4})), Some(4));
        assert_eq!(handle_of(&json!({"$h": 4, "x": 1})), None);
        assert_eq!(handle_of(&json!("x")), None);
    }
}
