use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Grab an OS-assigned free port on the loopback interface, then release it so
/// the Next.js server sidecar can bind it a moment later.
fn pick_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("failed to bind a local port")
        .local_addr()
        .expect("failed to read local addr")
        .port()
}

/// Block until the sidecar is accepting connections (or give up after `timeout`).
fn wait_for_server(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}").parse().unwrap(),
            Duration::from_millis(500),
        )
        .is_ok()
        {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

fn start_server(app: &AppHandle, port: u16) -> Result<(), Box<dyn std::error::Error>> {
    // Bundled: <resources>/server/server.js  (staged by scripts/desktop/build-server.mjs)
    let server_entry = app
        .path()
        .resolve("server/server.js", tauri::path::BaseDirectory::Resource)?;

    let data_dir = app.path().app_data_dir()?;
    let media_dir = data_dir.join("generated");
    std::fs::create_dir_all(&media_dir)?;

    let server_dir = server_entry
        .parent()
        .expect("server.js has no parent dir")
        .to_path_buf();

    let (mut rx, _child) = app
        .shell()
        .sidecar("node")?
        .current_dir(server_dir)
        .args([server_entry.to_string_lossy().to_string()])
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("GUEST_MODE", "true")
        .env("NEXT_PUBLIC_GUEST_MODE", "true")
        .env("HELIOS_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("HELIOS_MEDIA_DIR", media_dir.to_string_lossy().to_string())
        .spawn()?;

    // Drain sidecar output to the parent console for debugging.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("[next] {}", String::from_utf8_lossy(&line))
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[next] {}", String::from_utf8_lossy(&line))
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[next] server exited: {:?}", payload.code)
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // In `tauri dev` we point at an externally-run `next dev` instead of
            // spawning the bundled sidecar (which only exists after a build).
            if let Ok(dev_url) = std::env::var("HELIOS_DEV_URL") {
                if let Some(window) = handle.get_webview_window("main") {
                    if let Ok(parsed) = dev_url.parse() {
                        let _ = window.navigate(parsed);
                    }
                }
                return Ok(());
            }

            let port = pick_free_port();
            start_server(&handle, port)?;

            std::thread::spawn(move || {
                if !wait_for_server(port, Duration::from_secs(90)) {
                    eprintln!("[tauri] server never came up on port {port}");
                    return;
                }
                if let Some(window) = handle.get_webview_window("main") {
                    if let Ok(parsed) = format!("http://127.0.0.1:{port}/").parse() {
                        let _ = window.navigate(parsed);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running HeliosGen");
}
