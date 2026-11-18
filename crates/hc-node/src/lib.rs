//! HermiteCut's Rust engine for Electron: a Node-API addon (napi-rs) that
//! loads in the HermiteCut app and in Resolve's own Electron (the panel).
//!
//! TypeScript loads it through `core/native/index.ts`, which also declares
//! the types. Names are camelCase on the JavaScript side (`libraryIndex`).
//! Work that can take a while (indexing folders, installing) runs on Node's
//! thread pool and returns a Promise, so the window never freezes. Those
//! return JSON text, which `core/native/index.ts` parses.

use hc_core::{assets, catalogue as cat};
use hc_paths::ResolvePaths;
use hc_resolve::Setup;
use napi::bindgen_prelude::*;
use napi::{Env, Task};
use napi_derive::napi;
use serde_json::Value;
use std::path::{Path, PathBuf};

fn reason<E: std::fmt::Display>(e: E) -> Error {
    Error::from_reason(e.to_string())
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// The engine's version (the Cargo workspace version).
#[napi]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Resolve's folders on this machine.
#[napi(object)]
pub struct ResolveFolders {
    pub templates: String,
    pub scripts: String,
    pub plugins: String,
    pub fonts: String,
    pub plugin_dir: String,
    pub node_candidates: Vec<String>,
    pub fuscript_candidates: Vec<String>,
    /// fuscript, if Resolve is installed (or HERMITECUT_FUSCRIPT is set).
    pub fuscript: Option<String>,
    /// Resolve Studio's WorkflowIntegration.node, if Studio is installed.
    pub node_addon: Option<String>,
}

#[napi]
pub fn resolve_folders() -> ResolveFolders {
    let p = ResolvePaths::detect();
    ResolveFolders {
        templates: s(&p.templates),
        scripts: s(&p.scripts),
        plugins: s(&p.plugins),
        fonts: s(&p.fonts),
        plugin_dir: s(&p.plugin_dir()),
        node_candidates: p.node_candidates.iter().map(|x| s(x)).collect(),
        fuscript_candidates: p.fuscript_candidates.iter().map(|x| s(x)).collect(),
        fuscript: p.find_fuscript().map(|x| s(&x)),
        node_addon: p.find_node_addon().map(|x| s(&x)),
    }
}

/// `{templates, version, sounds, sfxDir}` from the app's resources folder.
#[napi(ts_return_type = "Catalogue")]
pub fn catalogue(resources: String) -> Value {
    cat::load(Path::new(&resources))
}

pub struct IndexTask {
    folders: Vec<String>,
    opts: assets::Options,
}

impl Task for IndexTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<String> {
        serde_json::to_string(&assets::index(&self.folders, &self.opts)).map_err(reason)
    }

    fn resolve(&mut self, _env: Env, output: String) -> Result<String> {
        Ok(output)
    }
}

/// Index folders (and the zips in them) for the asset library, as JSON.
#[napi]
pub fn library_index_json(
    folders: Vec<String>,
    max_files: Option<u32>,
    max_depth: Option<u32>,
) -> AsyncTask<IndexTask> {
    let d = assets::Options::default();
    AsyncTask::new(IndexTask {
        folders,
        opts: assets::Options {
            max_files: max_files.map_or(d.max_files, |n| n as usize),
            max_depth: max_depth.map_or(d.max_depth, |n| n as usize),
        },
    })
}

/// A real file for a library item: the file itself, or its extracted copy.
#[napi]
pub fn library_materialise(
    #[napi(ts_arg_type = "LibraryItem")] item: Value,
    cache_dir: String,
) -> Result<String> {
    let item: assets::Item = serde_json::from_value(item).map_err(reason)?;
    assets::materialise(&item, Path::new(&cache_dir))
        .map(|p| s(&p))
        .map_err(reason)
}

/// Delete every extracted copy in `cacheDir`.
#[napi]
pub fn library_clear_cache(cache_dir: String) -> Result<()> {
    assets::clear_cache(Path::new(&cache_dir)).map_err(reason)
}

/// What Setup has installed: `{templates, launcher, plugin, fonts, paths}`.
#[napi(ts_return_type = "SetupInstalled")]
pub fn setup_installed(resources: String) -> Value {
    Setup::new(PathBuf::from(resources)).installed()
}

pub struct InstallTask {
    resources: PathBuf,
    what: String,
}

impl Task for InstallTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<String> {
        let setup = Setup::new(self.resources.clone());
        match self.what.as_str() {
            "templates" => setup.install_templates(),
            "launcher" => setup.install_launcher(),
            "fonts" => setup.install_fonts(),
            "plugin" => setup.install_plugin(),
            other => Err(format!("Unknown Setup item: {other}")),
        }
        .map(|v| v.to_string())
        .map_err(Error::from_reason)
    }

    fn resolve(&mut self, _env: Env, output: String) -> Result<String> {
        Ok(output)
    }
}

/// Install one Setup item from the app's resources, as JSON `{msg}`.
/// `plugin` asks for administrator rights (UAC on Windows, the password
/// prompt on macOS).
#[napi]
pub fn setup_install_json(
    resources: String,
    #[napi(ts_arg_type = "'templates' | 'launcher' | 'fonts' | 'plugin'")] what: String,
) -> AsyncTask<InstallTask> {
    AsyncTask::new(InstallTask {
        resources: PathBuf::from(resources),
        what,
    })
}
