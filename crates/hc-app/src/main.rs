//! HermiteCut desktop app: core/ui in a Tauri window, with the Rust back end
//! (hc-core, hc-resolve) in place of Electron's main.js and hosts/resolve.
//!
//! The page talks to `window.hermite` (src/shim.js), the same API the
//! Electron preload gives it, so core/ui is shared unchanged.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use hc_core::{assets, catalogue};
use hc_resolve::Resolve;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const SHIM: &str = include_str!("shim.js");

struct Inner {
    resolve: Resolve,
    resources: PathBuf,
    cache: PathBuf,
    log: PathBuf,
    pinned: AtomicBool,
}

#[derive(Clone)]
struct Hc(Arc<Inner>);

impl Inner {
    fn log(&self, msg: &str) {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&self.log) {
            let _ = writeln!(f, "{}  {msg}", assets::iso_now());
        }
    }
}

fn node_platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    }
}

fn not_ported(name: &str) -> String {
    format!("{name} isn't in the Rust preview yet. Use the main HermiteCut app for it for now.")
}

/// One UI action. The names and JSON match hosts/resolve's `api`.
fn dispatch(hc: &Inner, name: &str, args: &Value) -> Result<Value, String> {
    let r = &hc.resolve;
    match name {
        "hostInfo" => Ok(json!({
            "host": "resolve", "hostName": "DaVinci Resolve", "mode": "standalone",
            "version": env!("CARGO_PKG_VERSION"), "platform": node_platform(), "engine": "rust",
        })),
        "status" => r.status().map_err(|e| e.to_string()),
        "catalogue" => Ok(catalogue::load(&hc.resources)),
        "libraryIndex" => {
            let folders: Vec<String> = args["folders"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            serde_json::to_value(assets::index(&folders, &assets::Options::default()))
                .map_err(|e| e.to_string())
        }
        "libraryClearCache" => assets::clear_cache(&hc.cache)
            .map(|_| json!({ "msg": "Cache cleared" }))
            .map_err(|e| e.to_string()),
        "setupStatus" => Ok(r.setup_status("standalone")),
        "installTemplates" => r.install_templates(),
        "installLauncher" => r.install_launcher(),
        "installFonts" => r.install_fonts(),
        "installPlugin" => r.install_plugin(),
        _ => Err(not_ported(name)),
    }
}

#[tauri::command]
async fn hc_call(state: State<'_, Hc>, name: String, args: Value) -> Result<Value, String> {
    let hc = state.inner().clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let res = dispatch(&hc.0, &name, &args);
        if let Err(e) = &res {
            // the UI polls status every few seconds; a closed Resolve is not worth a log line each time
            if name != "status" {
                hc.0.log(&format!("ERROR {name}: {e}"));
            }
            let lower = e.to_lowercase();
            if [
                "not initialized",
                "invalid",
                "disconnected",
                "closed",
                "not connected",
            ]
            .iter()
            .any(|w| lower.contains(w))
            {
                hc.0.resolve.reset();
            }
        }
        res
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(match out {
        Ok(result) => json!({ "ok": true, "result": result }),
        Err(error) => json!({ "ok": false, "error": error }),
    })
}

#[tauri::command]
fn hc_stat(path: String) -> Result<u64, String> {
    fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn hc_read_file(path: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || fs::read(&path))
        .await
        .map_err(|e| e.to_string())?
        .map(Response::new)
        .map_err(|e| e.to_string())
}

fn title(opts: &Value, fallback: &str) -> String {
    opts["title"].as_str().unwrap_or(fallback).to_string()
}

fn with_filters<R: tauri::Runtime>(
    mut d: tauri_plugin_dialog::FileDialogBuilder<R>,
    opts: &Value,
) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    for f in opts["filters"].as_array().into_iter().flatten() {
        let exts: Vec<&str> = f["extensions"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect();
        d = d.add_filter(f["name"].as_str().unwrap_or("Files"), &exts);
    }
    d
}

fn path_string(p: Option<tauri_plugin_dialog::FilePath>) -> Option<String> {
    p.and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
async fn hc_open_file(app: AppHandle, opts: Value) -> Result<Option<String>, String> {
    let d = with_filters(
        app.dialog().file().set_title(title(&opts, "Choose a file")),
        &opts,
    );
    Ok(path_string(d.blocking_pick_file()))
}

#[tauri::command]
async fn hc_save_file(app: AppHandle, opts: Value) -> Result<Option<String>, String> {
    let mut d = with_filters(app.dialog().file().set_title(title(&opts, "Save")), &opts);
    if let Some(def) = opts["defaultPath"].as_str() {
        let p = Path::new(def);
        if let Some(name) = p.file_name() {
            d = d.set_file_name(name.to_string_lossy());
        }
        if let Some(dir) = p.parent().filter(|d| d.is_dir()) {
            d = d.set_directory(dir);
        }
    }
    Ok(path_string(d.blocking_save_file()))
}

#[tauri::command]
async fn hc_choose_folder(app: AppHandle, opts: Value) -> Result<Option<String>, String> {
    let d = app
        .dialog()
        .file()
        .set_title(title(&opts, "Choose a folder"));
    Ok(path_string(d.blocking_pick_folder()))
}

#[tauri::command]
fn hc_drag(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.start_dragging();
    }
}

#[tauri::command]
fn hc_window(app: AppHandle, state: State<'_, Hc>, cmd: String, val: Value) -> Value {
    let Some(w) = app.get_webview_window("main") else {
        return json!(false);
    };
    let hc = &state.0;
    match cmd.as_str() {
        "close" => json!(w.close().is_ok()),
        "minimize" => json!(w.minimize().is_ok()),
        "pin" => {
            let on = val.as_bool().unwrap_or(true);
            hc.pinned.store(on, Ordering::SeqCst);
            let _ = w.set_always_on_top(on);
            json!(on)
        }
        "isPinned" => json!(hc.pinned.load(Ordering::SeqCst)),
        "openLog" => json!(app
            .opener()
            .open_path(hc.log.to_string_lossy(), None::<&str>)
            .is_ok()),
        "openExternal" => match val.as_str() {
            Some(u) if u.starts_with("https://") || u.starts_with("http://") => {
                json!(app.opener().open_url(u, None::<&str>).is_ok())
            }
            _ => json!(false),
        },
        "reveal" => match val.as_str() {
            Some(p) => json!(app.opener().reveal_item_in_dir(p).is_ok()),
            None => json!(false),
        },
        _ => json!(false),
    }
}

/// The repository root, for `cargo run` before the app is bundled.
fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            hc_call,
            hc_stat,
            hc_read_file,
            hc_open_file,
            hc_save_file,
            hc_choose_folder,
            hc_drag,
            hc_window
        ])
        .setup(|app| {
            let res_dir = app.path().resource_dir().ok();
            let resources = res_dir
                .as_ref()
                .map(|d| d.join("data"))
                .filter(|d| d.join("HermiteCut-manifest.json").is_file())
                .unwrap_or_else(|| repo().join("build").join("resources"));
            let bridge = res_dir
                .map(|d| d.join("bridge.lua"))
                .filter(|p| p.is_file())
                .unwrap_or_else(|| repo().join("hosts").join("resolve").join("bridge.lua"));
            let cache = app.path().app_cache_dir()?.join("library-cache");
            let log_dir = app.path().app_log_dir()?;
            fs::create_dir_all(&log_dir)?;
            let inner = Inner {
                resolve: Resolve::new(bridge, resources.clone()),
                resources,
                cache,
                log: log_dir.join("hermitecut-log.txt"),
                pinned: AtomicBool::new(true),
            };
            inner.log(&format!(
                "HermiteCut {} (Rust preview) started",
                env!("CARGO_PKG_VERSION")
            ));
            app.manage(Hc(Arc::new(inner)));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("HermiteCut")
                .inner_size(1120.0, 720.0)
                .min_inner_size(380.0, 420.0)
                .decorations(false)
                .always_on_top(true)
                .initialization_script(SHIM)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("HermiteCut could not start");
}
