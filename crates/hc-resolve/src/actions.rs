//! The app's Resolve actions, on top of the bridge. Each returns the same JSON
//! as its JS counterpart in `hosts/resolve`, so `core/ui` works unchanged.
//!
//! Ported so far: status, setupStatus, installTemplates, installLauncher,
//! installFonts, installPlugin. The rest are listed in docs/RUST_PLAN.md.

use crate::bridge::{handle_of, Bridge, Error};
use hc_paths::{ResolvePaths, LEGACY_PLUGIN_ID, PLUGIN_ID};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

const FONTS: [&str; 3] = ["archivo.woff2", "outfit.woff2", "montserrat.woff2"];

/// Resolve, as the app sees it: connects on first use and reconnects after
/// Resolve restarts.
pub struct Resolve {
    script: PathBuf,
    resources: PathBuf,
    paths: ResolvePaths,
    bridge: Mutex<Option<Arc<Bridge>>>,
}

fn text(v: Result<Value, Error>) -> Option<String> {
    match v {
        Ok(Value::String(s)) => Some(s),
        Ok(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

fn count(v: &Value) -> usize {
    match v {
        Value::Array(a) => a.len(),
        Value::Object(o) => o.len(),
        _ => 0,
    }
}

impl Resolve {
    /// `script` is bridge.lua; `resources` holds the pack, sounds, fonts,
    /// launcher and panel (the app's bundled resources).
    pub fn new(script: PathBuf, resources: PathBuf) -> Resolve {
        Resolve::with_paths(script, resources, ResolvePaths::detect())
    }

    pub fn with_paths(script: PathBuf, resources: PathBuf, paths: ResolvePaths) -> Resolve {
        Resolve {
            script,
            resources,
            paths,
            bridge: Mutex::new(None),
        }
    }

    pub fn paths(&self) -> &ResolvePaths {
        &self.paths
    }

    fn res(&self, rel: &str) -> PathBuf {
        rel.split('/')
            .fold(self.resources.clone(), |p, part| p.join(part))
    }

    /// The live connection, starting one if needed.
    pub fn bridge(&self) -> Result<Arc<Bridge>, Error> {
        let mut slot = self.bridge.lock().unwrap();
        if let Some(b) = slot.as_ref().filter(|b| b.is_alive()) {
            return Ok(b.clone());
        }
        let fuscript = self.paths.find_fuscript().ok_or(Error::NotFound)?;
        let b = Arc::new(Bridge::start(&fuscript, &self.script)?);
        *slot = Some(b.clone());
        Ok(b)
    }

    /// Use an already started bridge (tests, or a host that starts its own).
    pub fn attach(&self, b: Bridge) {
        *self.bridge.lock().unwrap() = Some(Arc::new(b));
    }

    /// Drop the connection, so the next action reconnects.
    pub fn reset(&self) {
        *self.bridge.lock().unwrap() = None;
    }

    /// `{connected, page, version, project?, timeline?, fps?, width?, height?, tc?, selected?}`
    pub fn status(&self) -> Result<Value, Error> {
        let b = self.bridge()?;
        let mut out =
            json!({ "connected": true, "page": b.call(0, "GetCurrentPage", &[])?, "version": "" });
        if let Some(v) = text(b.call(0, "GetVersionString", &[])) {
            out["version"] = json!(v);
        }
        let Some(pm) = handle_of(&b.call(0, "GetProjectManager", &[])?) else {
            return Ok(out);
        };
        let Some(p) = handle_of(&b.call(pm, "GetCurrentProject", &[])?) else {
            return Ok(out);
        };
        out["project"] = b.call(p, "GetName", &[])?;
        let Some(t) = handle_of(&b.call(p, "GetCurrentTimeline", &[])?) else {
            return Ok(out);
        };
        out["timeline"] = b.call(t, "GetName", &[])?;
        let setting = |k: &str| text(b.call(t, "GetSetting", &[json!(k)])).unwrap_or_default();
        let fps = setting("timelineFrameRate")
            .trim_end_matches(|c: char| !c.is_ascii_digit() && c != '.')
            .parse::<f64>();
        out["fps"] = json!(fps.ok().filter(|f| *f > 0.0).unwrap_or(24.0));
        out["width"] = json!(setting("timelineResolutionWidth")
            .parse::<u32>()
            .unwrap_or(1920));
        out["height"] = json!(setting("timelineResolutionHeight")
            .parse::<u32>()
            .unwrap_or(1080));
        if let Some(tc) = text(b.call(t, "GetCurrentTimecode", &[])) {
            out["tc"] = json!(tc);
        }
        out["selected"] = json!(b
            .call(t, "GetSelectedClips", &[])
            .map(|v| count(&v))
            .unwrap_or(0));
        Ok(out)
    }

    /// What Setup shows: the connection and what is installed.
    pub fn setup_status(&self, mode: &str) -> Value {
        let d = &self.paths;
        let version = self
            .bridge()
            .ok()
            .and_then(|b| text(b.call(0, "GetVersionString", &[])));
        json!({
            "mode": mode,
            "resolve": version.clone().unwrap_or_default(),
            "scripting": version.is_some(),
            "templates": d.templates.join("HermiteCut.drfx").is_file(),
            "launcher": d.scripts.join("HermiteCut.lua").is_file(),
            "plugin": d.plugin_dir().join("main.js").is_file(),
            "fonts": FONTS.iter().all(|f| d.fonts.join(format!("HermiteCut-{f}")).is_file()),
            "paths": {
                "templates": d.templates, "scripts": d.scripts, "plugins": d.plugins,
                "sample": d.node_candidates.first(), "fonts": d.fonts,
            },
        })
    }

    pub fn install_templates(&self) -> Result<Value, String> {
        let src = self.res("HermiteCut.drfx");
        if !src.is_file() {
            return Err("The template pack is missing from this install.".into());
        }
        copy_into(&src, &self.paths.templates, "HermiteCut.drfx")?;
        Ok(json!({ "msg": "Templates installed. Restart Resolve to load them." }))
    }

    pub fn install_launcher(&self) -> Result<Value, String> {
        copy_into(
            &self.res("launcher/HermiteCut.lua"),
            &self.paths.scripts,
            "HermiteCut.lua",
        )?;
        Ok(json!({ "msg": "Added Workspace → Scripts → HermiteCut" }))
    }

    pub fn install_fonts(&self) -> Result<Value, String> {
        for f in FONTS {
            let src = self.res(&format!("fonts/{f}"));
            if src.is_file() {
                copy_into(&src, &self.paths.fonts, &format!("HermiteCut-{f}"))?;
            }
        }
        Ok(json!({ "msg": "Fonts copied. Titles can now use Archivo, Outfit and Montserrat." }))
    }

    /// The panel folder is machine-wide, so this asks for administrator rights.
    pub fn install_plugin(&self) -> Result<Value, String> {
        let src = self.res(&format!("plugin/{PLUGIN_ID}"));
        if !src.is_dir() {
            return Err("The Resolve panel is missing from this install.".into());
        }
        let node = self.paths.find_node_addon().ok_or(
            "DaVinci Resolve Studio was not found. The Resolve panel needs Studio 19 or newer; the app works with the free version.",
        )?;
        let dest = self.paths.plugin_dir();
        let legacy = self.paths.plugins.join(LEGACY_PLUGIN_ID);
        let ok = if cfg!(windows) {
            let q = |p: &Path| p.to_string_lossy().replace('\'', "''");
            let ps = format!(
                "Remove-Item -Recurse -Force '{l}' -ErrorAction SilentlyContinue; Remove-Item -Recurse -Force '{d}' -ErrorAction SilentlyContinue; \
                 New-Item -ItemType Directory -Force '{d}' | Out-Null; Copy-Item -Recurse -Force '{s}\\*' '{d}'; Copy-Item -Force '{n}' '{d}'",
                l = q(&legacy), d = q(&dest), s = q(&src), n = q(&node)
            );
            let outer = format!(
                "Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-Command',\"{}\"",
                ps.replace('"', "`\"")
            );
            Command::new("powershell").args(["-NoProfile", "-Command", &outer]).status()
        } else {
            let q = |p: &Path| p.to_string_lossy().replace('\'', r"'\''");
            let sh = format!(
                "rm -rf '{l}' '{d}'; mkdir -p '{d}' && cp -R '{s}/.' '{d}/' && cp '{n}' '{d}/'",
                l = q(&legacy), d = q(&dest), s = q(&src), n = q(&node)
            );
            let script = format!(
                "do shell script \"{}\" with administrator privileges",
                sh.replace('\\', "\\\\").replace('"', "\\\"")
            );
            Command::new("osascript").args(["-e", &script]).status()
        }
        .map(|s| s.success())
        .unwrap_or(false);
        if !ok || !dest.join("main.js").is_file() {
            return Err("Installation was cancelled or failed.".into());
        }
        Ok(
            json!({ "msg": "Resolve panel installed. Restart Resolve, then Workspace → Workflow Integrations → HermiteCut." }),
        )
    }
}

fn copy_into(src: &Path, dir: &Path, name: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    fs::copy(src, dir.join(name)).map_err(|e| format!("Could not copy {}: {e}", src.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::tests::fake;
    use std::time::Duration;

    fn sandbox(tag: &str) -> (PathBuf, Resolve) {
        let root = std::env::temp_dir().join(format!("hc-resolve-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let res = root.join("res");
        fs::create_dir_all(res.join("fonts")).unwrap();
        fs::create_dir_all(res.join("launcher")).unwrap();
        fs::write(res.join("HermiteCut.drfx"), b"drfx").unwrap();
        fs::write(res.join("launcher/HermiteCut.lua"), b"-- lua").unwrap();
        for f in FONTS {
            fs::write(res.join("fonts").join(f), b"font").unwrap();
        }
        let paths = ResolvePaths::macos(&root.join("home"), &root.join("sys"));
        (
            root.clone(),
            Resolve::with_paths(root.join("bridge.lua"), res, paths),
        )
    }

    #[test]
    fn status_reads_project_timeline_and_settings() {
        let (root, r) = sandbox("status");
        r.attach(fake("ok", Duration::from_secs(10)).unwrap());
        let s = r.status().unwrap();
        assert_eq!(s["connected"], true);
        assert_eq!(s["page"], "edit");
        assert_eq!(s["version"], "21.2.0");
        assert_eq!(s["project"], "Scratch");
        assert_eq!(s["timeline"], "Edit 1");
        assert_eq!(s["fps"], 25.0);
        assert_eq!(
            (s["width"].as_u64(), s["height"].as_u64()),
            (Some(1080), Some(1920))
        );
        assert_eq!(s["tc"], "01:00:02:10");
        assert_eq!(s["selected"], 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn setup_installs_user_files() {
        let (root, r) = sandbox("setup");
        let before = r.setup_status("standalone");
        assert_eq!(before["templates"], false);
        assert_eq!(before["scripting"], false);
        r.install_templates().unwrap();
        r.install_launcher().unwrap();
        r.install_fonts().unwrap();
        let after = r.setup_status("standalone");
        assert_eq!(
            (
                after["templates"].as_bool(),
                after["launcher"].as_bool(),
                after["fonts"].as_bool()
            ),
            (Some(true), Some(true), Some(true))
        );
        assert_eq!(after["plugin"], false);
        assert!(r.install_plugin().unwrap_err().contains("panel is missing"));
        fs::remove_dir_all(root).unwrap();
    }
}
