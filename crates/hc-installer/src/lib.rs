//! Install and remove the HermiteCut panel (a DaVinci Resolve Workflow
//! Integration plugin). `main.rs` is the console front end.

use hc_paths::{ResolvePaths, NODE_ADDON};
use std::fmt;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

include!(concat!(env!("OUT_DIR"), "/payload.rs"));

/// What went wrong, in words for the person running the installer.
#[derive(Debug)]
pub enum Error {
    /// The installer was built without the panel inside it.
    NoPayload,
    /// Resolve Studio's WorkflowIntegration.node was not found.
    NoStudio { looked_in: PathBuf },
    /// A file operation failed.
    Io { what: String, source: io::Error },
}

impl Error {
    /// Windows or macOS refused because the folder needs administrator rights.
    pub fn needs_admin(&self) -> bool {
        match self {
            Error::Io { source, .. } => {
                source.kind() == io::ErrorKind::PermissionDenied
                    || source.raw_os_error() == Some(5) // ERROR_ACCESS_DENIED
                    || source.to_string().to_lowercase().contains("access is denied")
            }
            _ => false,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::NoPayload => write!(f, "this installer was built without the panel inside it. Download it again from the HermiteCut releases page."),
            Error::NoStudio { looked_in } => write!(
                f,
                "could not find WorkflowIntegration.node.\n  DaVinci Resolve STUDIO (19 or newer) must be installed: Workflow Integration plugins are a Studio feature.\n  Looked in: {}",
                looked_in.display()
            ),
            Error::Io { what, source } => write!(f, "{what}: {source}"),
        }
    }
}

impl std::error::Error for Error {}

fn ctx<T>(r: io::Result<T>, what: impl FnOnce() -> String) -> Result<T, Error> {
    r.map_err(|source| Error::Io {
        what: what(),
        source,
    })
}

/// What `install` did.
#[derive(Debug, PartialEq, Eq)]
pub struct Installed {
    pub files: usize,
    pub removed_legacy: bool,
    pub target: PathBuf,
}

/// Is the panel installed?
pub fn is_installed(paths: &ResolvePaths) -> bool {
    paths.plugin_dir().exists()
}

/// A relative path inside the plugin folder, refusing anything that could
/// leave it (`..`, absolute paths, drive prefixes).
fn safe_join(base: &Path, rel: &str) -> Option<PathBuf> {
    let rel = Path::new(rel);
    if rel.components().all(|c| matches!(c, Component::Normal(_))) {
        Some(base.join(rel))
    } else {
        None
    }
}

/// Install `payload` as the panel, with Resolve's own WorkflowIntegration.node
/// beside it. Replaces any earlier install and removes the pre-release panel.
pub fn install(paths: &ResolvePaths, payload: &[(&str, &[u8])]) -> Result<Installed, Error> {
    if payload.is_empty() {
        return Err(Error::NoPayload);
    }
    let node = paths.find_node_addon().ok_or_else(|| Error::NoStudio {
        looked_in: paths.node_candidates[0]
            .parent()
            .and_then(Path::parent)
            .unwrap_or(&paths.plugins)
            .to_path_buf(),
    })?;
    let target = paths.plugin_dir();
    // A clean install. Files Resolve still has open may refuse to go; the
    // copy below overwrites them, so that is not an error here.
    let _ = fs::remove_dir_all(&target);
    let legacy = paths.legacy_plugin_dir();
    let removed_legacy = legacy.exists();
    if removed_legacy {
        ctx(fs::remove_dir_all(&legacy), || {
            format!("removing the old pre-release panel ({})", legacy.display())
        })?;
    }
    ctx(fs::create_dir_all(&target), || {
        format!("creating {}", target.display())
    })?;
    let mut files = 0;
    for (rel, bytes) in payload {
        let out = safe_join(&target, rel).ok_or_else(|| Error::Io {
            what: format!("unsafe path in the installer: {rel}"),
            source: io::Error::from(io::ErrorKind::InvalidData),
        })?;
        if let Some(dir) = out.parent() {
            ctx(fs::create_dir_all(dir), || {
                format!("creating {}", dir.display())
            })?;
        }
        ctx(fs::write(&out, bytes), || {
            format!("writing {}", out.display())
        })?;
        files += 1;
    }
    let dest = target.join(NODE_ADDON);
    ctx(fs::copy(&node, &dest), || {
        format!("copying {}", node.display())
    })?;
    Ok(Installed {
        files,
        removed_legacy,
        target,
    })
}

/// Remove the panel (and the pre-release panel). `Ok(false)` if it was not installed.
pub fn uninstall(paths: &ResolvePaths) -> Result<bool, Error> {
    let legacy = paths.legacy_plugin_dir();
    if legacy.exists() {
        ctx(fs::remove_dir_all(&legacy), || {
            format!("removing {}", legacy.display())
        })?;
    }
    let target = paths.plugin_dir();
    if !target.exists() {
        return Ok(false);
    }
    ctx(fs::remove_dir_all(&target), || {
        format!("removing {}", target.display())
    })?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn sandbox() -> (PathBuf, ResolvePaths) {
        static N: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "hc-installer-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let p = ResolvePaths::windows(
            &root.join("appdata"),
            &root.join("local"),
            &root.join("pd"),
            &root.join("pf"),
        );
        (root, p)
    }

    fn add_studio(p: &ResolvePaths) {
        let node = &p.node_candidates[1];
        fs::create_dir_all(node.parent().unwrap()).unwrap();
        fs::write(node, b"resolve-node").unwrap();
    }

    const PAYLOAD_T: &[(&str, &[u8])] = &[
        ("manifest.xml", b"<m/>"),
        ("main.js", b"// main"),
        ("core/ui/index.html", b"<html></html>"),
    ];

    #[test]
    fn installs_payload_and_node_addon() {
        let (root, p) = sandbox();
        add_studio(&p);
        let legacy = p.legacy_plugin_dir();
        fs::create_dir_all(&legacy).unwrap();
        let r = install(&p, PAYLOAD_T).unwrap();
        assert_eq!(r.files, 3);
        assert!(r.removed_legacy);
        assert!(!legacy.exists());
        let t = p.plugin_dir();
        assert_eq!(
            fs::read(t.join("core/ui/index.html")).unwrap(),
            b"<html></html>"
        );
        assert_eq!(fs::read(t.join(NODE_ADDON)).unwrap(), b"resolve-node");
        assert!(is_installed(&p));
        // a reinstall replaces stale files
        fs::write(t.join("stale.js"), b"x").unwrap();
        install(&p, PAYLOAD_T).unwrap();
        assert!(!t.join("stale.js").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn needs_studio() {
        let (root, p) = sandbox();
        match install(&p, PAYLOAD_T) {
            Err(Error::NoStudio { .. }) => {}
            other => panic!("expected NoStudio, got {other:?}"),
        }
        assert!(!is_installed(&p));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_empty_payload_and_unsafe_paths() {
        let (root, p) = sandbox();
        add_studio(&p);
        assert!(matches!(install(&p, &[]), Err(Error::NoPayload)));
        let bad: &[(&str, &[u8])] = &[("../escape.txt", b"x")];
        assert!(install(&p, bad).is_err());
        assert!(!p.plugins.join("escape.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn uninstalls() {
        let (root, p) = sandbox();
        add_studio(&p);
        assert!(!uninstall(&p).unwrap());
        install(&p, PAYLOAD_T).unwrap();
        assert!(uninstall(&p).unwrap());
        assert!(!is_installed(&p));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn embedded_payload_never_carries_resolve_binaries() {
        assert!(PAYLOAD
            .iter()
            .all(|(rel, _)| !rel.ends_with(NODE_ADDON) && !rel.ends_with("devtools.flag")));
    }
}
