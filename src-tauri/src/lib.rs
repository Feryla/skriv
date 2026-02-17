use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
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
            let app_menu = Submenu::with_items(app, "skriv", true, &[
                &PredefinedMenuItem::about(app, Some("About skriv"), None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ])?;
            let file_menu = Submenu::with_items(app, "File", true, &[
                &MenuItem::with_id(app, "new_tab", "New Tab", true, Some("CmdOrCtrl+N"))?,
                &MenuItem::with_id(app, "open_file", "Open...", true, Some("CmdOrCtrl+O"))?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "save_file", "Save", true, Some("CmdOrCtrl+S"))?,
                &MenuItem::with_id(app, "save_file_as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::close_window(app, None)?,
            ])?;
            let edit_menu = Submenu::with_items(app, "Edit", true, &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::select_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "toggle_comment", "Toggle Comment", true, Some("CmdOrCtrl+Shift+C"))?,
                &MenuItem::with_id(app, "format_document", "Format Document", true, Some("CmdOrCtrl+Shift+F"))?,
                &MenuItem::with_id(app, "column_selection", "Column Selection", true, None::<&str>)?,
            ])?;
            let command_palette = MenuItem::with_id(app, "command_palette", "Command Palette", true, Some("Super+Shift+P"))?;
            let word_wrap = MenuItem::with_id(app, "word_wrap", "Word Wrap", true, Some("Alt+Z"))?;
            let toggle_theme = MenuItem::with_id(app, "toggle_theme", "Toggle Theme", true, None::<&str>)?;
            let view_menu = Submenu::with_items(app, "View", true, &[
                &command_palette,
                &PredefinedMenuItem::separator(app)?,
                &word_wrap,
                &toggle_theme,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::fullscreen(app, None)?,
            ])?;
            let window_menu = Submenu::with_items(app, "Window", true, &[
                &PredefinedMenuItem::minimize(app, None)?,
                &PredefinedMenuItem::maximize(app, None)?,
            ])?;
            let help_menu = Submenu::with_items(app, "Help", true, &[])?;
            let menu = Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])?;
            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                let id = event.id();
                match id.as_ref() {
                    "command_palette" => { let _ = app.emit("menu-command-palette", ()); }
                    "word_wrap" => { let _ = app.emit("menu-word-wrap", ()); }
                    "toggle_comment" => { let _ = app.emit("menu-toggle-comment", ()); }
                    "new_tab" => { let _ = app.emit("menu-new-tab", ()); }
                    "open_file" => { let _ = app.emit("menu-open-file", ()); }
                    "save_file" => { let _ = app.emit("menu-save-file", ()); }
                    "save_file_as" => { let _ = app.emit("menu-save-file-as", ()); }
                    "format_document" => { let _ = app.emit("menu-format-document", ()); }
                    "column_selection" => { let _ = app.emit("menu-column-selection", ()); }
                    "toggle_theme" => { let _ = app.emit("menu-toggle-theme", ()); }
                    _ => {}
                }
            });

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
