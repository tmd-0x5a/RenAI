use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;
use reqwest::blocking::Client;
use std::fs::File;
use zip::ZipArchive;

struct AppPaths {
    resource_dir: PathBuf,
    exe_path: PathBuf,
    bin_dir: PathBuf,
}

struct SidecarState {
    child: Mutex<Option<Child>>,
    paths: Mutex<Option<AppPaths>>,
}

fn spawn_llama_server(paths: &AppPaths, model_name: &str, use_gpu: bool) -> Result<Child, String> {
    // Prevent path traversal
    if model_name.contains('/') || model_name.contains('\\') || model_name.contains("..") {
        return Err("Invalid model name".to_string());
    }

    let model_path = paths.resource_dir.join("resources").join(model_name);

    if !model_path.exists() {
        return Err(format!("Model not found: {}", model_path.to_string_lossy()));
    }

    let model_path_str = model_path.to_string_lossy().to_string();
    println!("Starting llama-server with model: {} (GPU: {})", model_path_str, use_gpu);

    let (exe_path, work_dir, gpu_layers) = if use_gpu {
        let cuda_dir = paths.bin_dir.join("cuda");
        let exe = cuda_dir.join("llama-server.exe");
        if !exe.exists() {
            return Err("GPU engine not installed".into());
        }
        (exe, cuda_dir, "99")
    } else {
        (paths.exe_path.clone(), paths.bin_dir.clone(), "0")
    };

    Command::new(&exe_path)
        .current_dir(&work_dir)
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
            gpu_layers,
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
fn switch_model(model_name: String, use_gpu: bool, state: tauri::State<SidecarState>) -> Result<String, String> {
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

    let child = spawn_llama_server(paths, &model_name, use_gpu)?;
    let pid = child.id();
    drop(paths_guard);

    *state.child.lock().unwrap() = Some(child);

    println!(
        "llama-server restarted with model: {} (PID: {})",
        model_name, pid
    );
    Ok(format!("Model switched to {}", model_name))
}

#[tauri::command]
async fn download_gpu_engine(state: tauri::State<'_, SidecarState>) -> Result<String, String> {
    let bin_dir = {
        let paths_guard = state.paths.lock().unwrap();
        let paths = paths_guard.as_ref().ok_or("Paths not initialized")?;
        paths.bin_dir.clone()
    };

    let cuda_dir = bin_dir.join("cuda");
    if cuda_dir.join("llama-server.exe").exists() {
        return Ok("Already installed".into());
    }

    std::fs::create_dir_all(&cuda_dir).map_err(|e| e.to_string())?;

    let url = "https://github.com/ggerganov/llama.cpp/releases/download/b4921/llama-b4921-bin-win-cuda-cu12.2.0-x64.zip";

    tokio::task::spawn_blocking(move || {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .map_err(|e| e.to_string())?;

        let mut response = client.get(url).send().map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("Download failed with status: {}", response.status()));
        }

        let zip_path = cuda_dir.join("engine.zip");
        let mut file = File::create(&zip_path).map_err(|e| e.to_string())?;
        response.copy_to(&mut file).map_err(|e| e.to_string())?;

        let file = File::open(&zip_path).map_err(|e| e.to_string())?;
        let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let outpath = match file.enclosed_name() {
                Some(path) => cuda_dir.join(path),
                None => continue,
            };

            if (*file.name()).ends_with('/') {
                std::fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
                    }
                }
                let mut outfile = File::create(&outpath).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            }
        }

        std::fs::remove_file(zip_path).ok();
        Ok(())
    })
    .await
    .map_err(|e| format!("Task joined failed: {}", e))?
    .map_err(|e| e)?;

    Ok("GPU Engine installed successfully".into())
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
        .invoke_handler(tauri::generate_handler![list_models, switch_model, download_gpu_engine])
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

            // Spawn default model (CPU by default initially, frontend handles switch on load)
            let child =
                spawn_llama_server(&paths, default_model, false).expect("Failed to start llama-server");
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
