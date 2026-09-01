//! Sidecar shim for the bundled Next.js server.
//!
//! Tauri puts `externalBin` sidecars in `HeliosGen.app/Contents/MacOS/`. macOS
//! treats anything it launches from a bundle's `MacOS/` dir as a GUI app and
//! gives it its own Dock tile (tauri-apps/tauri#14014) — so a bare `node`
//! sidecar shows a second, generic "node" icon beside the app.
//!
//! So the sidecar is this shim instead. It demotes its own process to a UI
//! element (no Dock tile, no menu bar), then `exec`s the real Node runtime,
//! which ships as a resource in `Contents/Resources/server/node-bin/`. `exec`
//! keeps the same PID, so both the Dock-hidden state and Tauri's
//! `CommandChild::kill()` still apply to the Node process.
//!
//! The Tauri shell passes the Node binary's absolute path in `HELIOS_NODE_BIN`.

#[cfg(target_os = "macos")]
fn hide_from_dock() {
    // Process Manager, <ApplicationServices/ApplicationServices.h>.
    #[repr(C)]
    struct ProcessSerialNumber {
        high_long_of_psn: u32,
        low_long_of_psn: u32,
    }
    const K_CURRENT_PROCESS: u32 = 2;
    const K_PROCESS_TRANSFORM_TO_UI_ELEMENT_APPLICATION: u32 = 4;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn TransformProcessType(psn: *const ProcessSerialNumber, transform_state: u32) -> i32;
    }

    let psn = ProcessSerialNumber {
        high_long_of_psn: 0,
        low_long_of_psn: K_CURRENT_PROCESS,
    };
    // Best effort: the worst case on failure is the pre-existing Dock tile.
    unsafe {
        TransformProcessType(&psn, K_PROCESS_TRANSFORM_TO_UI_ELEMENT_APPLICATION);
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    hide_from_dock();

    let node = match std::env::var_os("HELIOS_NODE_BIN") {
        Some(p) => p,
        None => {
            eprintln!("[helios-node] HELIOS_NODE_BIN not set by the Tauri shell");
            std::process::exit(64);
        }
    };
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let err = std::process::Command::new(&node).args(&args).exec();
        eprintln!(
            "[helios-node] failed to exec {}: {err}",
            std::path::Path::new(&node).display()
        );
        std::process::exit(126);
    }

    #[cfg(not(unix))]
    {
        match std::process::Command::new(&node).args(&args).status() {
            Ok(status) => std::process::exit(status.code().unwrap_or(1)),
            Err(err) => {
                eprintln!("[helios-node] failed to spawn node: {err}");
                std::process::exit(126);
            }
        }
    }
}
