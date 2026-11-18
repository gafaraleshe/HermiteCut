//! Just enough zip reading for the asset library: list an archive from its
//! central directory, and read one entry (stored or deflated). Nothing else is
//! loaded, so indexing a folder of large packs stays fast.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

/// One file inside a zip.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub method: u16,
    pub compressed_size: u64,
    pub size: u64,
    pub local_header: u64,
}

fn u16_at(b: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([b[i], b[i + 1]])
}

fn u32_at(b: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]])
}

fn bad(msg: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg.to_string())
}

/// Latin-1 is the zip default; flag bit 11 means UTF-8.
fn decode_name(bytes: &[u8], utf8: bool) -> String {
    if utf8 {
        String::from_utf8_lossy(bytes).into_owned()
    } else {
        bytes.iter().map(|&b| b as char).collect()
    }
}

/// The entries of the zip at `path`, from its central directory.
pub fn list(path: &Path) -> io::Result<Vec<Entry>> {
    let mut f = File::open(path)?;
    let size = f.metadata()?.len();
    let tail_len = size.min(65_557) as usize;
    let mut tail = vec![0u8; tail_len];
    f.seek(SeekFrom::Start(size - tail_len as u64))?;
    f.read_exact(&mut tail)?;
    if tail_len < 22 {
        return Err(bad("not a zip file"));
    }
    let eocd = (0..=tail_len - 22)
        .rev()
        .find(|&i| u32_at(&tail, i) == 0x0605_4b50)
        .ok_or_else(|| bad("not a zip file"))?;
    let count = u16_at(&tail, eocd + 10);
    let cd_size = u32_at(&tail, eocd + 12);
    let cd_offset = u32_at(&tail, eocd + 16);
    if cd_offset == u32::MAX || count == u16::MAX {
        return Err(bad("zip64 archives are not supported yet"));
    }
    if u64::from(cd_offset) + u64::from(cd_size) > size {
        return Err(bad("damaged zip file"));
    }
    let mut cd = vec![0u8; cd_size as usize];
    f.seek(SeekFrom::Start(u64::from(cd_offset)))?;
    f.read_exact(&mut cd)?;
    let mut entries = Vec::with_capacity(count as usize);
    let mut p = 0usize;
    for _ in 0..count {
        if p + 46 > cd.len() || u32_at(&cd, p) != 0x0201_4b50 {
            break;
        }
        let flags = u16_at(&cd, p + 8);
        let (nlen, xlen, clen) = (
            u16_at(&cd, p + 28) as usize,
            u16_at(&cd, p + 30) as usize,
            u16_at(&cd, p + 32) as usize,
        );
        if p + 46 + nlen > cd.len() {
            break;
        }
        entries.push(Entry {
            name: decode_name(&cd[p + 46..p + 46 + nlen], flags & 0x800 != 0),
            method: u16_at(&cd, p + 10),
            compressed_size: u64::from(u32_at(&cd, p + 20)),
            size: u64::from(u32_at(&cd, p + 24)),
            local_header: u64::from(u32_at(&cd, p + 42)),
        });
        p += 46 + nlen + xlen + clen;
    }
    Ok(entries)
}

/// The contents of one entry.
pub fn read(path: &Path, entry: &Entry) -> io::Result<Vec<u8>> {
    let mut f = File::open(path)?;
    let mut head = [0u8; 30];
    f.seek(SeekFrom::Start(entry.local_header))?;
    f.read_exact(&mut head)?;
    if u32_at(&head, 0) != 0x0403_4b50 {
        return Err(bad("bad zip entry"));
    }
    let start =
        entry.local_header + 30 + u64::from(u16_at(&head, 26)) + u64::from(u16_at(&head, 28));
    let mut data = vec![0u8; entry.compressed_size as usize];
    f.seek(SeekFrom::Start(start))?;
    f.read_exact(&mut data)?;
    match entry.method {
        0 => Ok(data),
        8 => miniz_oxide::inflate::decompress_to_vec_with_limit(&data, entry.size.max(1) as usize)
            .map_err(|e| bad(&format!("could not decompress {}: {e:?}", entry.name))),
        m => Err(bad(&format!("unsupported zip compression (method {m})"))),
    }
}

/// Writes small zips for tests (stored or deflated), with no zip dependency.
#[cfg(test)]
pub(crate) mod testzip {
    use std::path::Path;

    fn crc32(data: &[u8]) -> u32 {
        let mut c = 0xffff_ffffu32;
        for &b in data {
            c ^= u32::from(b);
            for _ in 0..8 {
                c = if c & 1 != 0 {
                    0xedb8_8320 ^ (c >> 1)
                } else {
                    c >> 1
                };
            }
        }
        !c
    }

    pub fn write(path: &Path, files: &[(&str, &[u8], bool)]) {
        let (mut out, mut cd) = (Vec::new(), Vec::new());
        for (name, data, deflate) in files {
            let body = if *deflate {
                miniz_oxide::deflate::compress_to_vec(data, 6)
            } else {
                data.to_vec()
            };
            let method: u16 = if *deflate { 8 } else { 0 };
            let offset = out.len() as u32;
            let crc = crc32(data);
            let mut common = Vec::new();
            common.extend_from_slice(&20u16.to_le_bytes());
            common.extend_from_slice(&0x800u16.to_le_bytes());
            common.extend_from_slice(&method.to_le_bytes());
            common.extend_from_slice(&[0, 0, 0, 0]);
            common.extend_from_slice(&crc.to_le_bytes());
            common.extend_from_slice(&(body.len() as u32).to_le_bytes());
            common.extend_from_slice(&(data.len() as u32).to_le_bytes());
            common.extend_from_slice(&(name.len() as u16).to_le_bytes());
            common.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
            out.extend_from_slice(&common);
            out.extend_from_slice(name.as_bytes());
            out.extend_from_slice(&body);
            cd.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
            cd.extend_from_slice(&20u16.to_le_bytes());
            cd.extend_from_slice(&common);
            cd.extend_from_slice(&[0; 10]); // comment len, disk, internal and external attributes
            cd.extend_from_slice(&offset.to_le_bytes());
            cd.extend_from_slice(name.as_bytes());
        }
        let cd_offset = out.len() as u32;
        out.extend_from_slice(&cd);
        out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&(files.len() as u16).to_le_bytes());
        out.extend_from_slice(&(files.len() as u16).to_le_bytes());
        out.extend_from_slice(&(cd.len() as u32).to_le_bytes());
        out.extend_from_slice(&cd_offset.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        std::fs::write(path, out).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_and_reads_stored_and_deflated() {
        let dir = std::env::temp_dir().join(format!("hc-zip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let z = dir.join("pack.zip");
        let big = "grade ".repeat(500);
        testzip::write(
            &z,
            &[
                ("LUTs/Teal.cube", b"LUT_3D_SIZE 2", false),
                ("Readme ü.txt", big.as_bytes(), true),
            ],
        );
        let e = list(&z).unwrap();
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].name, "LUTs/Teal.cube");
        assert_eq!(e[1].name, "Readme ü.txt");
        assert_eq!(e[1].method, 8);
        assert_eq!(read(&z, &e[0]).unwrap(), b"LUT_3D_SIZE 2");
        assert_eq!(read(&z, &e[1]).unwrap(), big.as_bytes());
        std::fs::write(dir.join("not.zip"), b"hello").unwrap();
        assert!(list(&dir.join("not.zip")).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(test)]
mod interop {
    /// A zip written by another tool, when HC_TEST_ZIP points at one
    /// (CI and local checks use Python's zipfile).
    #[test]
    fn reads_foreign_zip() {
        let Some(p) = std::env::var_os("HC_TEST_ZIP") else {
            return;
        };
        let p = std::path::PathBuf::from(p);
        let entries = super::list(&p).unwrap();
        assert!(!entries.is_empty());
        for e in &entries {
            let data = super::read(&p, e).unwrap();
            assert_eq!(data.len() as u64, e.size, "{}", e.name);
        }
    }
}
