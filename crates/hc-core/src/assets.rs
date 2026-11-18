//! The asset library. It indexes the user's own folders by reference, and
//! nothing is copied. Zips are listed from their central directory, and a
//! file inside one is extracted to a cache the first time it is used.
//! Supported types: lut, video, image, audio, drfx, drt, setting.
//!
//! The Rust port of `core/lib/assets.js`, with the same JSON shapes.

use crate::zip;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const TYPES: &[(&str, &[&str])] = &[
    ("lut", &["cube", "3dl"]),
    ("video", &["mp4", "mov", "m4v", "webm", "mxf", "avi", "mkv"]),
    (
        "image",
        &["png", "jpg", "jpeg", "tif", "tiff", "exr", "dpx", "webp"],
    ),
    (
        "audio",
        &["wav", "mp3", "aif", "aiff", "flac", "m4a", "ogg"],
    ),
    ("drfx", &["drfx"]),
    ("drt", &["drt"]),
    ("setting", &["setting"]),
];

/// The library type of a file name, from its extension.
pub fn type_of(name: &str) -> Option<&'static str> {
    let ext = Path::new(name).extension()?.to_str()?.to_lowercase();
    TYPES
        .iter()
        .find(|(_, exts)| exts.contains(&ext.as_str()))
        .map(|(t, _)| *t)
}

/// One asset: a file on disk, or a file inside a zip.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub root: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
    pub folder: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub items: Vec<Item>,
    pub counts: BTreeMap<String, usize>,
    pub errors: Vec<String>,
    pub truncated: bool,
    pub indexed_at: String,
}

pub struct Options {
    pub max_files: usize,
    pub max_depth: usize,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            max_files: 50_000,
            max_depth: 12,
        }
    }
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn relative(root: &Path, p: &Path) -> String {
    p.strip_prefix(root).map(s).unwrap_or_else(|_| s(p))
}

struct Walker<'a> {
    opts: &'a Options,
    items: Vec<Item>,
    errors: Vec<String>,
    seen: HashSet<PathBuf>,
}

impl Walker<'_> {
    fn add(&mut self, it: Item) {
        if self.items.len() < self.opts.max_files {
            self.items.push(it);
        }
    }

    fn walk(&mut self, dir: &Path, depth: usize, root: &Path) {
        if depth > self.opts.max_depth || self.items.len() >= self.opts.max_files {
            return;
        }
        let mut list: Vec<_> = match fs::read_dir(dir) {
            Ok(r) => r.flatten().collect(),
            Err(e) => {
                self.errors.push(format!("{}: {e}", dir.display()));
                return;
            }
        };
        list.sort_by_key(|e| e.file_name());
        for d in list {
            let name = d.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name == "__MACOSX" {
                continue;
            }
            let full = d.path();
            let is_dir = d.file_type().map(|t| t.is_dir()).unwrap_or(false) || full.is_dir();
            if is_dir {
                self.walk(&full, depth + 1, root);
                continue;
            }
            if name.to_lowercase().ends_with(".zip") {
                self.add_zip(&full, root);
                continue;
            }
            let Some(kind) = type_of(&name) else { continue };
            if !self.seen.insert(full.clone()) {
                continue;
            }
            let size = d.metadata().map(|m| m.len()).unwrap_or(0);
            let folder = relative(root, dir);
            self.add(Item {
                id: s(&full),
                name,
                kind: kind.into(),
                root: s(root),
                path: Some(s(&full)),
                zip: None,
                entry: None,
                folder: if folder.is_empty() {
                    ".".into()
                } else {
                    folder
                },
                size,
            });
        }
    }

    fn add_zip(&mut self, full: &Path, root: &Path) {
        match zip::list(full) {
            Ok(entries) => {
                for e in entries {
                    if e.name.ends_with('/') || e.name.contains("__MACOSX") {
                        continue;
                    }
                    let Some(kind) = type_of(&e.name) else {
                        continue;
                    };
                    let (dirname, base) = match e.name.rsplit_once('/') {
                        Some((d, b)) => (d.to_string(), b.to_string()),
                        None => (".".to_string(), e.name.clone()),
                    };
                    self.add(Item {
                        id: format!("{}::{}", s(full), e.name),
                        name: base,
                        kind: kind.into(),
                        root: s(root),
                        path: None,
                        zip: Some(s(full)),
                        entry: Some(e.name.clone()),
                        folder: format!("{} › {}", relative(root, full), dirname),
                        size: e.size,
                    });
                }
            }
            Err(err) => self.errors.push(format!("{}: {err}", full.display())),
        }
    }
}

/// Index the given folders (and the zips inside them).
pub fn index<P: AsRef<Path>>(folders: &[P], opts: &Options) -> Index {
    let mut w = Walker {
        opts,
        items: Vec::new(),
        errors: Vec::new(),
        seen: HashSet::new(),
    };
    for f in folders {
        let f = f.as_ref();
        w.walk(f, 0, f);
    }
    let mut counts = BTreeMap::new();
    for it in &w.items {
        *counts.entry(it.kind.clone()).or_insert(0) += 1;
    }
    Index {
        truncated: w.items.len() >= opts.max_files,
        items: w.items,
        counts,
        errors: w.errors,
        indexed_at: iso_now(),
    }
}

/// A stable 16-hex-digit key for the cache folder (FNV-1a, 64 bit).
fn cache_key(id: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in id.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// A real file path for an item: the file itself, or its extracted copy in `cache_dir`.
pub fn materialise(item: &Item, cache_dir: &Path) -> io::Result<PathBuf> {
    let (Some(zip_path), Some(entry_name)) = (&item.zip, &item.entry) else {
        return item
            .path
            .as_ref()
            .map(PathBuf::from)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "this item has no file"));
    };
    let base = entry_name.rsplit('/').next().unwrap_or(entry_name);
    let dir = cache_dir.join(cache_key(&item.id));
    let out = dir.join(base);
    if out.is_file() {
        return Ok(out);
    }
    let zip_path = Path::new(zip_path);
    let entry = zip::list(zip_path)?
        .into_iter()
        .find(|e| &e.name == entry_name)
        .ok_or_else(|| {
            let zname = zip_path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("That file is no longer inside {zname}."),
            )
        })?;
    fs::create_dir_all(&dir)?;
    fs::write(&out, zip::read(zip_path, &entry)?)?;
    Ok(out)
}

/// Delete every extracted copy.
pub fn clear_cache(cache_dir: &Path) -> io::Result<()> {
    if cache_dir.exists() {
        fs::remove_dir_all(cache_dir)?;
    }
    Ok(())
}

/// Now, as `2026-11-18T15:04:05.000Z`.
pub fn iso_now() -> String {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    iso_from_unix(d.as_secs() as i64, d.subsec_millis())
}

fn iso_from_unix(secs: i64, millis: u32) -> String {
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // civil-from-days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::zip::testzip;

    #[test]
    fn types() {
        assert_eq!(type_of("Teal.CUBE"), Some("lut"));
        assert_eq!(type_of("a/b/Hit.wav"), Some("audio"));
        assert_eq!(type_of("notes.txt"), None);
        assert_eq!(type_of("noext"), None);
    }

    #[test]
    fn iso_dates() {
        assert_eq!(iso_from_unix(0, 0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_from_unix(1_795_014_245, 7), "2026-11-18T15:04:05.007Z");
        assert_eq!(iso_from_unix(951_782_400, 0), "2000-02-29T00:00:00.000Z");
    }

    #[test]
    fn indexes_folders_and_zips_and_materialises() {
        let root = std::env::temp_dir().join(format!("hc-assets-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Overlays/Dust")).unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        fs::write(root.join("Overlays/Dust/dust.mov"), b"mov").unwrap();
        fs::write(root.join("readme.txt"), b"x").unwrap();
        fs::write(root.join(".hidden/secret.wav"), b"x").unwrap();
        testzip::write(
            &root.join("Pack.zip"),
            &[
                ("LUTs/Teal.cube", b"LUT", true),
                ("__MACOSX/LUTs/._Teal.cube", b"x", false),
                ("Docs/", b"", false),
            ],
        );
        let ix = index(&[&root], &Options::default());
        assert_eq!(ix.items.len(), 2, "{:?}", ix.items);
        assert_eq!(ix.counts.get("lut"), Some(&1));
        assert_eq!(ix.counts.get("video"), Some(&1));
        let lut = ix.items.iter().find(|i| i.kind == "lut").unwrap();
        assert_eq!(lut.folder, "Pack.zip › LUTs");
        assert_eq!(lut.name, "Teal.cube");
        let mov = ix.items.iter().find(|i| i.kind == "video").unwrap();
        assert_eq!(Path::new(&mov.folder), Path::new("Overlays/Dust"));

        // the JSON shape the UI reads
        let v = serde_json::to_value(&ix).unwrap();
        assert!(v["indexedAt"].is_string());
        let items = v["items"].as_array().unwrap();
        let (vlut, vmov) = (
            items.iter().find(|i| i["type"] == "lut").unwrap(),
            items.iter().find(|i| i["type"] == "video").unwrap(),
        );
        assert!(vlut["zip"].is_string() && vlut["entry"] == "LUTs/Teal.cube");
        assert!(vmov.get("zip").is_none() && vmov["path"].is_string());

        let cache = root.join("cache");
        let out = materialise(lut, &cache).unwrap();
        assert_eq!(fs::read(&out).unwrap(), b"LUT");
        assert_eq!(
            materialise(mov, &cache).unwrap(),
            PathBuf::from(mov.path.clone().unwrap())
        );
        let back: Item = serde_json::from_value(serde_json::to_value(lut).unwrap()).unwrap();
        assert_eq!(&back, lut);
        clear_cache(&cache).unwrap();
        assert!(!cache.exists());

        let few = index(
            &[&root],
            &Options {
                max_files: 1,
                max_depth: 12,
            },
        );
        assert!(few.truncated);
        fs::remove_dir_all(root).unwrap();
    }
}
