use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct AppPaths {
    resource_dir: PathBuf,
    exe_path: PathBuf,
    bin_dir: PathBuf,
}

struct SidecarState {
    child: Mutex<Option<Child>>,
    paths: Mutex<Option<AppPaths>>,
}

fn spawn_llama_server(paths: &AppPaths, model_name: &str) -> Result<Child, String> {
    // Prevent path traversal
    if model_name.contains('/') || model_name.contains('\\') || model_name.contains("..") {
        return Err("Invalid model name".to_string());
    }

    let model_path = paths.resource_dir.join("resources").join(model_name);

    if !model_path.exists() {
        return Err(format!("Model not found: {}", model_path.to_string_lossy()));
    }

    let model_path_str = model_path.to_string_lossy().to_string();
    println!("Starting llama-server with model: {}", model_path_str);

    Command::new(&paths.exe_path)
        .current_dir(&paths.bin_dir)
        .args([
            "-m",
            &model_path_str,
            "--host",
            "127.0.0.1",
            "--port",
            "8080",
            "--ctx-size",
            "2048",
            "--n-gpu-layers",
            "0",
        ])
        .spawn()
        .map_err(|e| format!("Failed to spawn llama-server: {}", e))
}

#[tauri::command]
fn list_models(state: tauri::State<SidecarState>) -> Vec<String> {
    let paths_guard = state.paths.lock().unwrap();
    let Some(paths) = paths_guard.as_ref() else {
        return vec![];
    };

    let resources_dir = paths.resource_dir.join("resources");
    let mut models = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&resources_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "gguf") {
                if let Some(name) = path.file_name() {
                    models.push(name.to_string_lossy().to_string());
                }
            }
        }
    }

    models.sort();
    models
}

#[tauri::command]
fn switch_model(model_name: String, state: tauri::State<SidecarState>) -> Result<String, String> {
    // Kill existing llama-server
    {
        let mut child_guard = state.child.lock().unwrap();
        if let Some(mut child) = child_guard.take() {
            println!("Killing current llama-server...");
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    // Wait a moment for port to be released
    std::thread::sleep(std::time::Duration::from_millis(500));

    // Start new llama-server with the selected model
    let paths_guard = state.paths.lock().unwrap();
    let paths = paths_guard.as_ref().ok_or("Paths not initialized")?;

    let child = spawn_llama_server(paths, &model_name)?;
    let pid = child.id();
    drop(paths_guard);

    *state.child.lock().unwrap() = Some(child);

    println!(
        "llama-server restarted with model: {} (PID: {})",
        model_name, pid
    );
    Ok(format!("Model switched to {}", model_name))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .manage(SidecarState {
            child: Mutex::new(None),
            paths: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![list_models, switch_model])
        .setup(|app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("failed to resolve resource dir");

            let default_model = "Qwen3.5-0.8B-JP-Q8_0.gguf";

            // Resolve paths
            let bin_dir = resource_dir.join("bin");
            let exe_path = bin_dir.join("llama-server-x86_64-pc-windows-msvc.exe");

            let (exe_path, bin_dir) = if exe_path.exists() {
                (exe_path, bin_dir)
            } else {
                let dev_bin_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin");
                let dev_exe = dev_bin_dir.join("llama-server-x86_64-pc-windows-msvc.exe");
                (dev_exe, dev_bin_dir)
            };

            println!("llama-server exe: {}", exe_path.to_string_lossy());
            println!("Working dir (DLLs): {}", bin_dir.to_string_lossy());

            let paths = AppPaths {
                resource_dir: resource_dir.clone(),
                exe_path,
                bin_dir,
            };

            // Spawn default model
            let child =
                spawn_llama_server(&paths, default_model).expect("Failed to start llama-server");
            println!("llama-server spawned with PID: {}", child.id());

            let state = app.state::<SidecarState>();
            *state.child.lock().unwrap() = Some(child);
            *state.paths.lock().unwrap() = Some(paths);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle();
                let state = app.state::<SidecarState>();
                let mut guard = state.child.lock().unwrap();
                if let Some(mut child) = guard.take() {
                    println!("Killing llama-server sidecar...");
                    let _ = child.kill();
                    let _ = child.wait();
                    println!("llama-server sidecar killed.");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
