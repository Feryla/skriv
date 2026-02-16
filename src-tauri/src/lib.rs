use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[tauri::command]
fn install_cli() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let path = "/usr/local/bin/skriv";
        let script_content = "#!/bin/sh\\n/Applications/skriv.app/Contents/MacOS/app \\\"$@\\\" &\\n";

        // Check if already installed correctly
        if let Ok(contents) = std::fs::read_to_string(path) {
            if contents == "#!/bin/sh\n/Applications/skriv.app/Contents/MacOS/app \"$@\" &\n" {
                return Ok("already_installed".into());
            }
        }

        let cmd = format!(
            "printf '{}' > {} && chmod +x {}",
            script_content, path, path
        );
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(format!(
                "do shell script \"{}\" with administrator privileges",
                cmd
            ))
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            Ok("installed".into())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(stderr.into_owned())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("CLI installation is only supported on macOS".into())
    }
}

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
        .invoke_handler(tauri::generate_handler![get_cli_args, install_cli])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
