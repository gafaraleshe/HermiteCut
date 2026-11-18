//! HermiteCut panel installer: a console program for Windows and macOS.
//!
//!   hermitecut-installer              install, or ask what to do if installed
//!   hermitecut-installer /uninstall   remove
//!   add /quiet (or -q) to skip the questions and the final pause
//!
//! The release ships it on Windows as "Install HermiteCut.exe".

use hc_installer::{install, is_installed, uninstall, Error, PAYLOAD};
use hc_paths::ResolvePaths;
use std::io::{self, BufRead, Write};
use std::process::{exit, Command};

const BANNER: &str = r"
  ██╗  ██╗███████╗██████╗ ███╗   ███╗██╗████████╗███████╗ ██████╗██╗   ██╗████████╗
  ██║  ██║██╔════╝██╔══██╗████╗ ████║██║╚══██╔══╝██╔════╝██╔════╝██║   ██║╚══██╔══╝
  ███████║█████╗  ██████╔╝██╔████╔██║██║   ██║   █████╗  ██║     ██║   ██║   ██║
  ██╔══██║██╔══╝  ██╔══██╗██║╚██╔╝██║██║   ██║   ██╔══╝  ██║     ██║   ██║   ██║
  ██║  ██║███████╗██║  ██║██║ ╚═╝ ██║██║   ██║   ███████╗╚██████╗╚██████╔╝   ██║
  ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═════╝    ╚═╝";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Mode {
    Install,
    Uninstall,
}

fn parse_args<I: IntoIterator<Item = String>>(args: I) -> (Mode, bool) {
    let mut mode = Mode::Install;
    let mut quiet = false;
    for a in args {
        match a.trim_start_matches(['-', '/']).to_lowercase().as_str() {
            "uninstall" | "remove" | "u" => mode = Mode::Uninstall,
            "quiet" | "q" => quiet = true,
            _ => {}
        }
    }
    (mode, quiet)
}

#[cfg(windows)]
fn utf8_console() {
    #[link(name = "kernel32")]
    extern "system" {
        fn SetConsoleOutputCP(code_page: u32) -> i32;
    }
    // SAFETY: a plain Win32 call with no pointers.
    unsafe {
        SetConsoleOutputCP(65001);
    }
}

#[cfg(not(windows))]
fn utf8_console() {}

fn read_line() -> String {
    let mut s = String::new();
    let _ = io::stdin().lock().read_line(&mut s);
    s.trim().to_lowercase()
}

fn pause() {
    print!("\n  Press Enter to close...");
    let _ = io::stdout().flush();
    read_line();
}

fn resolve_running() -> bool {
    let out = if cfg!(windows) {
        Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq Resolve.exe", "/NH"])
            .output()
    } else {
        Command::new("pgrep").args(["-x", "Resolve"]).output()
    };
    match out {
        Ok(o) if cfg!(windows) => String::from_utf8_lossy(&o.stdout)
            .to_lowercase()
            .contains("resolve.exe"),
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

/// Run this program again with administrator rights and the same mode.
/// Returns the elevated run's success (macOS waits for it; Windows hands over).
fn elevate(mode: Mode) -> bool {
    let exe = match std::env::current_exe() {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(_) => return false,
    };
    if cfg!(windows) {
        let exe = exe.replace('\'', "''");
        let ps = match mode {
            Mode::Uninstall => {
                format!("Start-Process -FilePath '{exe}' -ArgumentList '/uninstall' -Verb RunAs")
            }
            Mode::Install => format!("Start-Process -FilePath '{exe}' -Verb RunAs"),
        };
        Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    } else {
        let flag = if mode == Mode::Uninstall {
            " --uninstall"
        } else {
            ""
        };
        let sh = format!("'{}' --quiet{flag}", exe.replace('\'', r"'\''"));
        let script = format!(
            "do shell script \"{}\" with administrator privileges",
            sh.replace('\\', "\\\\").replace('"', "\\\"")
        );
        Command::new("osascript")
            .args(["-e", &script])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

fn main() {
    utf8_console();
    let (mut mode, quiet) = parse_args(std::env::args().skip(1));
    let paths = ResolvePaths::detect();

    println!("{BANNER}");
    println!(
        "  for DaVinci Resolve Studio  ·  cut.hermitelabs.com  ·  v{}\n",
        env!("CARGO_PKG_VERSION")
    );

    if mode == Mode::Install && !quiet && is_installed(&paths) {
        println!("  HermiteCut is already installed.");
        print!("  [Enter] Update / reinstall    [R] Remove    [Q] Quit  > ");
        let _ = io::stdout().flush();
        match read_line().as_str() {
            "q" => return,
            "r" => mode = Mode::Uninstall,
            _ => {}
        }
    }

    let result: Result<Option<String>, Error> = match mode {
        Mode::Uninstall => {
            println!("  Removing HermiteCut...");
            uninstall(&paths).map(|was| {
                Some(if was {
                    "Removed. Restart DaVinci Resolve to update the menu.".to_string()
                } else {
                    "HermiteCut is not installed.".to_string()
                })
            })
        }
        Mode::Install => {
            println!("  Installing to:\n  {}", paths.plugin_dir().display());
            install(&paths, PAYLOAD).map(|r| {
                if r.removed_legacy {
                    println!("  Removed the old pre-release panel.");
                }
                println!(
                    "  Copied {} files + Resolve's WorkflowIntegration.node",
                    r.files
                );
                None
            })
        }
    };

    match result {
        Err(e) if e.needs_admin() => {
            println!("  This folder needs administrator permission - asking now...");
            let ok = elevate(mode);
            if cfg!(windows) {
                exit(if ok { 0 } else { 1 });
            }
            if ok {
                println!("\n  ✓ Done.");
                if mode == Mode::Install {
                    println!("  Open it from:  Workspace > Workflow Integrations > HermiteCut");
                }
            } else {
                println!("\n  ✗ Cancelled or failed.");
            }
            if !quiet {
                pause();
            }
            exit(if ok { 0 } else { 1 });
        }
        Err(e) => {
            println!("\n  ✗ {e}");
            if !quiet {
                pause();
            }
            exit(1);
        }
        Ok(Some(msg)) => println!("\n  ✓ {msg}"),
        Ok(None) => {
            println!("\n  ✓ Installed!\n");
            if resolve_running() {
                println!(
                    "  DaVinci Resolve is running: quit and reopen it once so it finds the panel."
                );
            }
            println!("  Open it from:  Workspace > Workflow Integrations > HermiteCut");
        }
    }
    if !quiet {
        pause();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> (Mode, bool) {
        parse_args(a.iter().map(|s| s.to_string()))
    }

    #[test]
    fn parses_windows_and_unix_flags() {
        assert_eq!(args(&[]), (Mode::Install, false));
        assert_eq!(args(&["/uninstall"]), (Mode::Uninstall, false));
        assert_eq!(args(&["--remove", "-q"]), (Mode::Uninstall, true));
        assert_eq!(args(&["/QUIET"]), (Mode::Install, true));
        assert_eq!(args(&["/u", "/q"]), (Mode::Uninstall, true));
    }
}
