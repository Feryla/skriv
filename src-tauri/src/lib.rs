use std::sync::Mutex;
use tauri::{Emitter, Manager};

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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
