//! Where DaVinci Resolve keeps things, on Windows and macOS.
//!
//! The same locations as `hosts/resolve/studio.js` (`supportDirs`) and the old
//! Go installer, in one place for the Rust installer and app.

use std::env;
use std::path::{Path, PathBuf};

/// The panel's folder name inside "Workflow Integration Plugins".
pub const PLUGIN_ID: &str = "com.hermitelabs.cut";
/// The pre-release panel's folder. Removed on install and uninstall so Resolve
/// does not list two copies of the panel.
pub const LEGACY_PLUGIN_ID: &str = "com.gaffystudios.editkit.resolve";
/// Resolve's own Node addon. It is copied from Resolve's examples at install
/// time and never shipped with HermiteCut.
pub const NODE_ADDON: &str = "WorkflowIntegration.node";

/// Resolve's folders for one user on one machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvePaths {
    /// Fusion templates (`HermiteCut.drfx` goes here). Per user.
    pub templates: PathBuf,
    /// Workspace > Scripts > Utility (the `HermiteCut.lua` launcher). Per user.
    pub scripts: PathBuf,
    /// Workflow Integration plugins. Machine-wide, so installing needs admin.
    pub plugins: PathBuf,
    /// Where Resolve Studio keeps its example plugins, which carry
    /// `WorkflowIntegration.node`, in the order to try them.
    pub node_candidates: Vec<PathBuf>,
    /// The user's font folder.
    pub fonts: PathBuf,
    /// Where fuscript usually is.
    pub fuscript_candidates: Vec<PathBuf>,
}

impl ResolvePaths {
    /// The folders on this machine.
    pub fn detect() -> Self {
        if cfg!(windows) {
            let home = home_dir();
            let appdata =
                env_path("APPDATA").unwrap_or_else(|| home.join("AppData").join("Roaming"));
            let local =
                env_path("LOCALAPPDATA").unwrap_or_else(|| home.join("AppData").join("Local"));
            let program_data =
                env_path("PROGRAMDATA").unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
            let program_files =
                env_path("ProgramFiles").unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
            Self::windows(&appdata, &local, &program_data, &program_files)
        } else {
            Self::macos(&home_dir(), Path::new("/"))
        }
    }

    /// Windows layout under the given roots (normally %APPDATA%, %LOCALAPPDATA%,
    /// %PROGRAMDATA% and %ProgramFiles%).
    pub fn windows(
        appdata: &Path,
        local_appdata: &Path,
        program_data: &Path,
        program_files: &Path,
    ) -> Self {
        let user = appdata
            .join("Blackmagic Design")
            .join("DaVinci Resolve")
            .join("Support");
        let machine = program_data
            .join("Blackmagic Design")
            .join("DaVinci Resolve")
            .join("Support");
        let examples = machine
            .join("Developer")
            .join("Workflow Integrations")
            .join("Examples");
        ResolvePaths {
            templates: user.join("Fusion").join("Templates"),
            scripts: user.join("Fusion").join("Scripts").join("Utility"),
            plugins: machine.join("Workflow Integration Plugins"),
            node_candidates: [
                "SamplePlugin",
                "SamplePromisePlugin",
                "CompatibleSamplePlugin",
            ]
            .iter()
            .map(|d| examples.join(d).join(NODE_ADDON))
            .collect(),
            fonts: local_appdata
                .join("Microsoft")
                .join("Windows")
                .join("Fonts"),
            fuscript_candidates: vec![program_files
                .join("Blackmagic Design")
                .join("DaVinci Resolve")
                .join("fuscript.exe")],
        }
    }

    /// macOS layout for the given home folder, with machine-wide folders under
    /// `root` (normally `/`).
    pub fn macos(home: &Path, root: &Path) -> Self {
        let user = home
            .join("Library")
            .join("Application Support")
            .join("Blackmagic Design")
            .join("DaVinci Resolve");
        let machine = root
            .join("Library")
            .join("Application Support")
            .join("Blackmagic Design")
            .join("DaVinci Resolve");
        let examples = machine
            .join("Developer")
            .join("Workflow Integrations")
            .join("Examples");
        let apps = root.join("Applications");
        ResolvePaths {
            templates: user.join("Fusion").join("Templates"),
            scripts: user.join("Fusion").join("Scripts").join("Utility"),
            plugins: machine.join("Workflow Integration Plugins"),
            node_candidates: [
                "SamplePlugin",
                "SamplePromisePlugin",
                "CompatibleSamplePlugin",
            ]
            .iter()
            .map(|d| examples.join(d).join(NODE_ADDON))
            .collect(),
            fonts: home.join("Library").join("Fonts"),
            fuscript_candidates: ["DaVinci Resolve", "DaVinci Resolve Studio"]
                .iter()
                .map(|d| {
                    apps.join(d)
                        .join("DaVinci Resolve.app")
                        .join("Contents")
                        .join("Libraries")
                        .join("Fusion")
                        .join("fuscript")
                })
                .collect(),
        }
    }

    /// The installed panel's folder.
    pub fn plugin_dir(&self) -> PathBuf {
        self.plugins.join(PLUGIN_ID)
    }

    /// The pre-release panel's folder.
    pub fn legacy_plugin_dir(&self) -> PathBuf {
        self.plugins.join(LEGACY_PLUGIN_ID)
    }

    /// Resolve Studio's `WorkflowIntegration.node`, if Studio is installed.
    pub fn find_node_addon(&self) -> Option<PathBuf> {
        self.node_candidates.iter().find(|p| p.is_file()).cloned()
    }

    /// fuscript: `HERMITECUT_FUSCRIPT` if set and present, else the usual places.
    pub fn find_fuscript(&self) -> Option<PathBuf> {
        if let Some(p) = env_path("HERMITECUT_FUSCRIPT") {
            if p.is_file() {
                return Some(p);
            }
        }
        self.fuscript_candidates
            .iter()
            .find(|p| p.is_file())
            .cloned()
    }
}

fn env_path(name: &str) -> Option<PathBuf> {
    env::var_os(name)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

fn home_dir() -> PathBuf {
    env_path(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_layout_matches_resolve() {
        let p = ResolvePaths::windows(
            Path::new("A"),
            Path::new("L"),
            Path::new("PD"),
            Path::new("PF"),
        );
        assert_eq!(
            p.plugin_dir(),
            Path::new("PD/Blackmagic Design/DaVinci Resolve/Support/Workflow Integration Plugins/com.hermitelabs.cut")
        );
        assert_eq!(
            p.templates,
            Path::new("A/Blackmagic Design/DaVinci Resolve/Support/Fusion/Templates")
        );
        assert_eq!(
            p.node_candidates[0],
            Path::new("PD/Blackmagic Design/DaVinci Resolve/Support/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node")
        );
        assert_eq!(
            p.fuscript_candidates[0],
            Path::new("PF/Blackmagic Design/DaVinci Resolve/fuscript.exe")
        );
    }

    #[test]
    fn macos_layout_matches_resolve() {
        let p = ResolvePaths::macos(Path::new("/Users/me"), Path::new("/"));
        assert_eq!(
            p.plugins,
            Path::new("/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins")
        );
        assert_eq!(
            p.scripts,
            Path::new("/Users/me/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility")
        );
        assert_eq!(
            p.fuscript_candidates[1],
            Path::new("/Applications/DaVinci Resolve Studio/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript")
        );
    }
}
