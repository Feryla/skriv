use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
fn install_cli() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    let path = std::path::Path::new("/usr/local/bin/skriv");
    let script = "#!/bin/sh\nopen -a skriv \"$@\"\n";

    // Skip if already correct
    if path.exists() {
        if let Ok(contents) = fs::read_to_string(path) {
            if contents == script {
                return;
            }
        }
    }

    if fs::write(path, script).is_ok() {
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o755));
    }
}

#[cfg(not(target_os = "macos"))]
fn install_cli() {}

struct CliArgs {
    args: Vec<String>,
    cwd: String,
}

#[tauri::command]
fn get_cli_args(state: tauri::State<'_, Mutex<CliArgs>>) -> (Vec<String>, String) {
    let cli = state.lock().unwrap();
    (cli.args.clone(), cli.cwd.clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let _ = app.emit("open-files", (args, cwd));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Mutex::new(CliArgs {
            args: std::env::args().collect(),
            cwd: std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
        }))
        .invoke_handler(tauri::generate_handler![get_cli_args])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            install_cli();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
