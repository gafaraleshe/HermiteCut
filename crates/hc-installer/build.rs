// Embeds the assembled panel (build/plugin/com.hermitelabs.cut, made by
// scripts/assemble.py) into the installer. HC_PAYLOAD_DIR points elsewhere.
// Without it the installer still builds, for tests and checks, and says it
// has no panel when run.
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const SKIP: &[&str] = &[
    "WorkflowIntegration.node",
    "devtools.flag",
    ".DS_Store",
    "__pycache__",
    "Thumbs.db",
];

fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .expect("read payload dir")
        .flatten()
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let name = e.file_name().to_string_lossy().into_owned();
        if SKIP.contains(&name.as_str()) || name.ends_with(".pyc") {
            continue;
        }
        let path = e.path();
        if path.is_dir() {
            walk(root, &path, out);
        } else {
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            out.push((rel, fs::canonicalize(&path).unwrap()));
        }
    }
}

fn main() {
    println!("cargo:rerun-if-env-changed=HC_PAYLOAD_DIR");
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dir = env::var_os("HC_PAYLOAD_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| manifest.join("../../build/plugin/com.hermitelabs.cut"));
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut files = Vec::new();
    if dir.join("manifest.xml").is_file() {
        walk(&dir, &dir, &mut files);
    } else {
        println!("cargo:warning=No assembled panel at {} (run scripts/assemble.py); building an installer without one.", dir.display());
    }
    let mut src = String::from("/// The panel's files: (path inside the plugin folder, contents).\npub static PAYLOAD: &[(&str, &[u8])] = &[\n");
    for (rel, abs) in &files {
        src.push_str(&format!(
            "    ({:?}, include_bytes!({:?})),\n",
            rel,
            abs.to_string_lossy()
        ));
    }
    src.push_str("];\n");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("payload.rs");
    fs::write(out, src).unwrap();
}
