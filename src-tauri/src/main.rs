// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File};
use std::io::{BufReader, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State, Manager};
use serde_json::Value;
use std::thread;
use std::process::{Command, Stdio};
use std::time::Duration;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use std::path::PathBuf;

struct AppState {
    cancel_read: Arc<AtomicBool>,
    child_process: std::sync::Mutex<Option<std::process::Child>>,
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ── Configuration & Presets ──

fn get_config_dir() -> PathBuf {
    // In dev mode, std::env::current_dir() might be src-tauri. We want the parent.
    let mut p = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if p.ends_with("src-tauri") {
        p.pop();
    }
    p
}

#[tauri::command]
fn list_presets() -> Result<Vec<String>, String> {
    let mut presets = Vec::new();
    let dir = get_config_dir();
    
    println!("Scanning for presets in: {:?}", dir);
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_file() {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    if file_name == "pattern_config.json" || (file_name.starts_with("Preset") && file_name.ends_with(".json")) {
                        presets.push(file_name);
                    }
                }
            }
        }
    }
    if presets.is_empty() {
        presets.push("pattern_config.json".to_string());
    }
    Ok(presets)
}

#[tauri::command]
fn load_config() -> Result<Value, String> {
    switch_preset("pattern_config.json".to_string())
}

#[tauri::command]
fn switch_preset(file_name: String) -> Result<Value, String> {
    let mut path = get_config_dir();
    path.push(&file_name);
    
    println!("Loading preset: {:?}", path);
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(val) = serde_json::from_str::<Value>(&content) {
            return Ok(serde_json::json!({
                "config": val,
                "fileName": file_name
            }));
        } else {
            println!("Failed to parse JSON for {}", file_name);
        }
    } else {
        println!("Failed to read file for {}", file_name);
    }
    
    // Fallback default config
    let default_config = r#"{
        "start_patterns": ["cmd_from_mockapp", "REQUEST OPEN SERVER"],
        "end_patterns": ["Process Finished!"],
        "success_patterns": ["result_code=success"],
        "failure_patterns": ["result_code=fail"],
        "clickable_patterns": {},
        "utterance_patterns": {
            "cmd_from_mockapp": { "pattern": "cmd_from_mockapp, ([^\\]]+)", "utterance": "{value}" },
            "kAsr2Response": { "pattern": "kAsr2Response \\[\\[FINAL\\]\\] \\[\\[([^\\]]+)\\]\\]", "utterance": "{value}" }
        },
        "pattern_groups": {},
        "table_columns": [
            { "key": "conversationId", "label": "Conversation ID", "width": "22%", "clickable_key": "conversationId" },
            { "key": "requestId", "label": "Request ID", "width": "12%" },
            { "key": "utterance", "label": "Utterance", "width": "30%", "type": "utterance" },
            { "key": "result", "label": "Result", "width": "8%", "type": "badge" },
            { "key": "successLine", "label": "Success Match", "width": "28%", "type": "log" }
        ]
    }"#;
    let v: Value = serde_json::from_str(default_config).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "config": v,
        "fileName": "default_fallback"
    }))
}

#[tauri::command]
fn add_custom_preset_file(file_path: String) -> Result<Value, String> {
    let source_path = PathBuf::from(&file_path);
    let file_name = source_path.file_name().unwrap_or_default().to_string_lossy().to_string();
    
    let mut dest_path = get_config_dir();
    dest_path.push(&file_name);

    if let Err(e) = fs::copy(&source_path, &dest_path) {
        return Err(format!("Failed to copy preset: {}", e));
    }

    Ok(serde_json::json!({ "success": true, "fileName": file_name }))
}

#[tauri::command]
fn open_config_folder() {
    let dir = get_config_dir();
    println!("Opening config folder: {:?}", dir);
    let _ = open::that(dir);
}

#[tauri::command]
fn open_log_file(app: AppHandle) {
    if let Ok(log_dir) = app.path().app_log_dir() {
        println!("Opening log folder: {:?}", log_dir);
        let _ = open::that(log_dir);
    }
}

#[tauri::command]
fn toggle_dev_tools(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_devtools_open() {
            window.close_devtools();
        } else {
            window.open_devtools();
        }
    }
}

// ── Web / OS Interactions ──

#[tauri::command]
fn open_external(url: String) {
    println!("Opening external URL: {}", url);
    let _ = open::that(&url);
}

// ── Log File Streaming ──

#[tauri::command]
fn read_file_stream(app: AppHandle, state: State<'_, AppState>, file_path: String) -> Result<(), String> {
    println!("Reading file stream: {}", file_path);
    let cancel_flag = state.cancel_read.clone();
    cancel_flag.store(false, Ordering::SeqCst);

    thread::spawn(move || {
        let file = match File::open(&file_path) {
            Ok(f) => f,
            Err(e) => {
                let _ = app.emit("file-read-error", e.to_string());
                return;
            }
        };

        let mut reader = BufReader::new(file);
        let mut buffer = [0; 64 * 1024]; // 64KB chunk

        loop {
            if cancel_flag.load(Ordering::SeqCst) {
                println!("File reading canceled.");
                break;
            }

            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = app.emit("file-read-complete", ());
                    break;
                }
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = app.emit("file-data-chunk", chunk);
                    thread::sleep(Duration::from_millis(1)); // small yield
                }
                Err(e) => {
                    let _ = app.emit("file-read-error", e.to_string());
                    break;
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn cancel_file_read(state: State<'_, AppState>) {
    state.cancel_read.store(true, Ordering::SeqCst);
}

// ── SDB Stream ──

#[tauri::command]
fn start_log_stream(app: AppHandle, state: State<'_, AppState>, command_str: String) -> Result<(), String> {
    println!("Starting log stream with command: {}", command_str);
    // Windows cmd parsing (naive)
    let child = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(&["/C", &command_str])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
    } else {
        Command::new("sh")
            .args(&["-c", &command_str])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
    };

    let mut child = child.map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    
    let mut state_child = state.child_process.lock().unwrap();
    *state_child = Some(child);
    drop(state_child);

    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buffer = [0; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = app.emit("log-stream-closed", 0);
                    break;
                }
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = app.emit("log-stream-data", text);
                }
                Err(_) => break,
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn stop_log_stream(state: State<'_, AppState>) {
    println!("Stopping log stream.");
    let mut child_guard = state.child_process.lock().unwrap();
    if let Some(mut child) = child_guard.take() {
        let _ = child.kill();
    }
}

// ── Screenshots & Export ──

#[tauri::command]
fn run_screenshot_command(command: String, save_path: String) -> Result<String, String> {
    println!("Running screenshot command: {}", command);
    let mut script_path = std::env::temp_dir();
    script_path.push("screenshot_cmd.bat");
    
    if let Ok(mut file) = File::create(&script_path) {
        let _ = file.write_all(command.as_bytes());
    }

    let status = Command::new("cmd")
        .args(&["/C", script_path.to_str().unwrap()])
        .current_dir(&save_path)
        .status()
        .map_err(|e| e.to_string())?;

    if status.success() {
        // Return latest png in folder
        if let Ok(entries) = fs::read_dir(&save_path) {
            let mut latest = None;
            let mut latest_time = std::time::UNIX_EPOCH;
            
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if entry.path().extension().and_then(|s| s.to_str()) == Some("png") {
                        if let Ok(modified) = meta.modified() {
                            if modified > latest_time {
                                latest_time = modified;
                                latest = Some(entry.path().to_string_lossy().into_owned());
                            }
                        }
                    }
                }
            }
            if let Some(p) = latest {
                return Ok(p);
            }
        }
        Ok(format!("{}/yymmdd_hhmmss.png", save_path)) // fallback
    } else {
        Err("Screenshot command failed".to_string())
    }
}

#[tauri::command]
fn read_screenshot(path: String) -> Result<String, String> {
    let data = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(BASE64.encode(&data))
}

#[tauri::command]
fn open_detail_html(html: String) -> Result<(), String> {
    let mut temp_path = std::env::temp_dir();
    temp_path.push(format!("detail_{}.html", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
    
    let mut file = File::create(&temp_path).map_err(|e| e.to_string())?;
    file.write_all(html.as_bytes()).map_err(|e| e.to_string())?;
    
    open::that(temp_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_screenshots(_log_file_path: Option<String>, _utterance: Option<String>) -> Result<Vec<Value>, String> {
    // In electron, it searched for screenshots containing utterance text. We return empty for now unless needed.
    Ok(vec![])
}

#[tauri::command]
fn save_export(html_data: String, base_name: String) -> Result<(), String> {
    let mut path = get_config_dir();
    path.push(format!("{}_report.html", base_name));
    println!("Saving export to: {:?}", path);
    
    let mut file = File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(html_data.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .manage(AppState {
            cancel_read: Arc::new(AtomicBool::new(false)),
            child_process: std::sync::Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            list_presets,
            load_config,
            switch_preset,
            add_custom_preset_file,
            open_config_folder,
            open_log_file,
            toggle_dev_tools,
            open_external,
            read_file_stream,
            cancel_file_read,
            start_log_stream,
            stop_log_stream,
            run_screenshot_command,
            read_screenshot,
            open_detail_html,
            get_screenshots,
            save_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
