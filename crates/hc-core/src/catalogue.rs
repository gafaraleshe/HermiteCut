//! The template and sound catalogue the UI shows. It is read from the
//! resources shipped with the app: `HermiteCut-manifest.json` (written by
//! tools/fusegen/build_pack.py) and `sfx/sfx.json` (tools/sfxgen).

use serde_json::{json, Value};
use std::fs;
use std::path::Path;

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// `{ templates, version, sounds, sfxDir }`, the same shape as the JS `catalogue` action.
/// Missing files give empty lists rather than an error.
pub fn load(resources: &Path) -> Value {
    let manifest =
        read_json(&resources.join("HermiteCut-manifest.json")).unwrap_or_else(|| json!({}));
    let sfx = read_json(&resources.join("sfx").join("sfx.json")).unwrap_or_else(|| json!({}));
    json!({
        "templates": manifest.get("templates").cloned().unwrap_or_else(|| json!([])),
        "version": manifest.get("version").cloned().unwrap_or(Value::Null),
        "sounds": sfx.get("sounds").cloned().unwrap_or_else(|| json!([])),
        "sfxDir": resources.join("sfx").to_string_lossy(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_manifest_and_sounds() {
        let dir = std::env::temp_dir().join(format!("hc-cat-{}", std::process::id()));
        fs::create_dir_all(dir.join("sfx")).unwrap();
        fs::write(
            dir.join("HermiteCut-manifest.json"),
            r#"{"version":"2.0.0","templates":[{"name":"Flash"}]}"#,
        )
        .unwrap();
        fs::write(
            dir.join("sfx/sfx.json"),
            r#"{"sounds":[{"name":"Whoosh"}]}"#,
        )
        .unwrap();
        let c = load(&dir);
        assert_eq!(c["version"], "2.0.0");
        assert_eq!(c["templates"][0]["name"], "Flash");
        assert_eq!(c["sounds"][0]["name"], "Whoosh");
        let empty = load(&dir.join("missing"));
        assert_eq!(empty["templates"], json!([]));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reads_the_real_build_when_present() {
        let res = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../build/resources");
        if res.join("HermiteCut-manifest.json").is_file() {
            let c = load(&res);
            assert!(c["templates"].as_array().unwrap().len() >= 90);
            assert!(c["sounds"].as_array().unwrap().len() >= 80);
        }
    }
}
