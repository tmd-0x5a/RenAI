use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, Emitter};
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

    let exe_name = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };
    
    let (exe_path, work_dir, gpu_layers) = if use_gpu {
        let cuda_dir = paths.bin_dir.join("cuda");
        let exe = cuda_dir.join(exe_name);
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
            "--chat-template",
            "chatml", // 強制的にchatmlテンプレートを適用し、モデル内蔵の思考(thinking=1)モードを上書きして無効化する
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

#[derive(Clone, serde::Serialize)]
struct ProgressPayload {
    status: String,
    progress: f64,
}

#[tauri::command]
async fn download_gpu_engine(app: tauri::AppHandle, state: tauri::State<'_, SidecarState>) -> Result<String, String> {
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

    let app_handle = app.clone();
    tokio::task::spawn_blocking(move || {
        use std::io::{Read, Write};
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .map_err(|e| e.to_string())?;

        // 常に動作確認済みバージョン(b8216)を安全に使用する
        let version_tag = "b8216";

        // ====== 1. 搭載GPUとCUDAバージョンの自動判定 ======
        let output = {
            use std::os::windows::process::CommandExt;
            std::process::Command::new("powershell")
                .args(&[
                    "-Command",
                    "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
                ])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()
        };
            
        let is_nvidia = if let Ok(out) = output {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.to_uppercase().contains("NVIDIA")
        } else {
            false
        };

        let cuda_version = if is_nvidia {
            let smi_output = {
                use std::os::windows::process::CommandExt;
                std::process::Command::new("nvidia-smi")
                    .creation_flags(0x08000000)
                    .output()
            };
            if let Ok(out) = smi_output {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if let Some(idx) = stdout.find("CUDA Version: ") {
                    let ver_str = &stdout[idx + 14..];
                    let ver_end = ver_str.find(|c: char| !c.is_numeric() && c != '.').unwrap_or(ver_str.len());
                    let ver_num = ver_str[..ver_end].trim();
                    ver_num.parse::<f32>().unwrap_or(0.0)
                } else {
                    0.0
                }
            } else {
                0.0
            }
        } else {
            0.0
        };

        let os = std::env::consts::OS;
        let arch = std::env::consts::ARCH;

        let mut download_urls = vec![];
        let mut engine_type_display = String::new();

        if os == "windows" {
            if is_nvidia && cuda_version >= 12.4 {
                download_urls.push(format!("https://github.com/ggerganov/llama.cpp/releases/download/{}/llama-{}-bin-win-cuda-12.4-x64.zip", version_tag, version_tag));
                // CUDA 12.x環境ではcudartのDLL群も必要になるため、両方ダウンロードする
                download_urls.push(format!("https://github.com/ggerganov/llama.cpp/releases/download/{}/cudart-llama-bin-win-cuda-12.4-x64.zip", version_tag));
                engine_type_display = "Windows CUDA 12.4 (NVIDIA専用)".to_string();
            } else if is_nvidia {
                download_urls.push(format!("https://github.com/ggerganov/llama.cpp/releases/download/{}/llama-{}-bin-win-vulkan-x64.zip", version_tag, version_tag));
                engine_type_display = "Windows Vulkan (NVIDIA互換)".to_string();
            } else {
                download_urls.push(format!("https://github.com/ggerganov/llama.cpp/releases/download/{}/llama-{}-bin-win-vulkan-x64.zip", version_tag, version_tag));
                engine_type_display = format!("Windows Vulkan ({:.1}汎用)", version_tag);
            }
        } else if os == "macos" {
            let mac_arch = if arch == "aarch64" { "arm64" } else { "x64" };
            download_urls.push(format!("https://github.com/ggerganov/llama.cpp/releases/download/{}/llama-{}-bin-macos-{}.tar.gz", version_tag, version_tag, mac_arch));
            // macOSはパッケージ内にMetal用の全ての依存が含まれる
            engine_type_display = format!("macOS Metal ({})", mac_arch);
        } else {
            // Linux fallback
            download_urls.push(format!("https://github.com/ggerganov/llama.cpp/releases/download/{}/llama-{}-bin-ubuntu-x64.tar.gz", version_tag, version_tag));
            engine_type_display = "Ubuntu x64 (汎用)".to_string();
        }

        for (url_idx, download_url) in download_urls.iter().enumerate() {
            let is_cudart = download_url.contains("cudart");
            let is_tar_gz = download_url.ends_with(".tar.gz");
            
            let filename = if is_cudart { "cudart.zip" } else if is_tar_gz { "engine.tar.gz" } else { "engine.zip" };
            let archive_path = cuda_dir.join(filename);

            let _ = app_handle.emit("download-progress", ProgressPayload {
                status: format!("{}版 ({}/{}) のDL中...", engine_type_display, url_idx + 1, download_urls.len()),
                progress: 0.0,
            });

            let mut response = client.get(download_url).send().map_err(|e| e.to_string())?;
            if !response.status().is_success() {
                return Err(format!("Download failed with status: {}", response.status()));
            }

            let total_size = response.content_length().unwrap_or(0);
            let mut file = File::create(&archive_path).map_err(|e| e.to_string())?;

            let mut downloaded: u64 = 0;
            let mut buffer = [0; 8192];
            let mut last_emit = std::time::Instant::now();

            while let Ok(n) = response.read(&mut buffer) {
                if n == 0 { break; }
                std::io::Write::write_all(&mut file, &buffer[..n]).map_err(|e| e.to_string())?;
                downloaded += n as u64;

                if last_emit.elapsed().as_millis() > 100 {
                    let progress = if total_size > 0 {
                        (downloaded as f64 / total_size as f64) * 100.0
                    } else {
                        0.0
                    };
                    let _ = app_handle.emit("download-progress", ProgressPayload {
                        status: format!("DL中... ({}/{})", url_idx + 1, download_urls.len()),
                        progress,
                    });
                    last_emit = std::time::Instant::now();
                }
            }

            let _ = app_handle.emit("download-progress", ProgressPayload {
                status: format!("解凍中... ({}/{})", url_idx + 1, download_urls.len()),
                progress: 0.0,
            });

            if is_tar_gz {
                let file_for_tar = File::open(&archive_path).map_err(|e| e.to_string())?;
                let tar = flate2::read::GzDecoder::new(file_for_tar);
                let mut archive = tar::Archive::new(tar);
                
                let _ = app_handle.emit("download-progress", ProgressPayload {
                    status: format!("解凍中... ({}/{})", url_idx + 1, download_urls.len()),
                    progress: 50.0, // tarは展開中のファイル数全容把握が難しいため固定プログレス
                });

                for entry_res in archive.entries().map_err(|e| e.to_string())? {
                    let mut entry = entry_res.map_err(|e| e.to_string())?;
                    let path = entry.path().map_err(|e| e.to_string())?.into_owned();
                    let name = path.to_string_lossy().to_string();
                    let file_name_str = std::path::Path::new(&name)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(&name);
                    
                    let lower_fname = file_name_str.to_lowercase();
                    
                    if lower_fname.ends_with(".exe") || 
                       lower_fname.ends_with(".dll") || 
                       lower_fname.ends_with(".so") || 
                       lower_fname.ends_with(".dylib") || 
                       lower_fname == "llama-server" 
                    {
                        let outpath = cuda_dir.join(file_name_str);
                        let mut outfile = File::create(&outpath).map_err(|e| e.to_string())?;
                        std::io::copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;
                        
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            let mut perms = std::fs::metadata(&outpath).map_err(|e| e.to_string())?.permissions();
                            perms.set_mode(0o755);
                            std::fs::set_permissions(&outpath, perms).map_err(|e| e.to_string())?;
                        }
                    }
                }
            } else {
                let file_for_zip = File::open(&archive_path).map_err(|e| e.to_string())?;
                let mut archive = ZipArchive::new(file_for_zip).map_err(|e| e.to_string())?;
                let total_files = archive.len();

                for i in 0..total_files {
                    if i % 10 == 0 {
                        let progress = (i as f64 / total_files as f64) * 100.0;
                        let _ = app_handle.emit("download-progress", ProgressPayload {
                            status: format!("解凍中... ({}/{})", url_idx + 1, download_urls.len()),
                            progress,
                        });
                    }
                    let mut zip_file = archive.by_index(i).map_err(|e| e.to_string())?;
                    if zip_file.is_dir() { continue; }
                    
                    let name = zip_file.name().to_string();
                    let file_name_str = std::path::Path::new(&name)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(&name);
                    
                    let lower_fname = file_name_str.to_lowercase();
                    
                    if lower_fname.ends_with(".exe") || 
                       lower_fname.ends_with(".dll") || 
                       lower_fname.ends_with(".so") || 
                       lower_fname.ends_with(".dylib") || 
                       lower_fname == "llama-server" 
                    {
                        let outpath = cuda_dir.join(file_name_str);
                        let mut outfile = File::create(&outpath).map_err(|e| e.to_string())?;
                        std::io::copy(&mut zip_file, &mut outfile).map_err(|e| e.to_string())?;
                        
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            let mut perms = std::fs::metadata(&outpath).map_err(|e| e.to_string())?.permissions();
                            perms.set_mode(0o755);
                            std::fs::set_permissions(&outpath, perms).map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
            std::fs::remove_file(archive_path).ok();
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Task joined failed: {}", e))?
    .map_err(|e| e)?;

    Ok("GPU Engine installed successfully".into())
}

#[derive(Clone, serde::Serialize)]
struct ChatChunk {
    token: String,
    is_thought: bool,
}

#[derive(Clone, serde::Serialize)]
struct ChatError {
    message: String,
}

#[tauri::command]
async fn stream_chat_response(app: tauri::AppHandle, request_json: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        use std::io::{BufRead, BufReader};
        
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .map_err(|e| e.to_string())?;

        // ターミナルへリクエスト対象のモデル名をプリントする
        let model_name = serde_json::from_str::<serde_json::Value>(&request_json)
            .ok()
            .and_then(|v| v.get("model").and_then(|m| m.as_str().map(|s| s.to_string())))
            .unwrap_or_else(|| "unknown".to_string());
        println!("\n>> Starting generation with model: {}", model_name);

        let mut attempt = 0;
        let max_retries = 3;
        
        let res = loop {
            let resp = client.post("http://127.0.0.1:8080/v1/chat/completions")
                .header("Content-Type", "application/json")
                .body(request_json.clone())
                .send()
                .map_err(|e| e.to_string())?;

            if resp.status().as_u16() == 503 && attempt < max_retries {
                let _ = app.emit("chat-status", ChatError { message: "モデル読み込み中... 待機します".into() });
                attempt += 1;
                std::thread::sleep(std::time::Duration::from_secs(3));
                continue;
            }
            break resp;
        };

        if !res.status().is_success() {
            let status = res.status();
            let err_text = res.text().unwrap_or_default();
            let _ = app.emit("chat-error", ChatError { 
                message: format!("API Error {}: {}", status, err_text) 
            });
            return Err(format!("API Error {}", status));
        }

        let reader = BufReader::new(res);
        for line_res in reader.lines() {
            let line = match line_res {
                Ok(l) => l,
                Err(_) => break,
            };
            
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            if !trimmed.starts_with("data: ") { continue; }
            
            let data = trimmed[6..].trim();
            if data == "[DONE]" { break; }
            
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(error) = json.get("error") {
                    let _ = app.emit("chat-error", ChatError { 
                        message: error.to_string() 
                    });
                } else if let Some(choices) = json.get("choices") {
                    if let Some(choice) = choices.as_array().and_then(|c| c.first()) {
                        if let Some(delta) = choice.get("delta") {
                            if let Some(reasoning) = delta.get("reasoning_content") {
                                if let Some(token) = reasoning.as_str() {
                                    use std::io::Write;
                                    print!("{}", token);
                                    let _ = std::io::stdout().flush();
                                    
                                    let _ = app.emit("chat-chunk", ChatChunk { 
                                        token: token.to_string(),
                                        is_thought: true,
                                    });
                                }
                            }
                            if let Some(content) = delta.get("content") {
                                if let Some(token) = content.as_str() {
                                    use std::io::Write;
                                    print!("{}", token);
                                    let _ = std::io::stdout().flush();
                                    
                                    let _ = app.emit("chat-chunk", ChatChunk { 
                                        token: token.to_string(),
                                        is_thought: false, 
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        
        let _ = app.emit("chat-done", ());
        Ok(())
    }).await.map_err(|e| format!("Task joined failed: {}", e))??;
    
    Ok(())
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
        .invoke_handler(tauri::generate_handler![list_models, switch_model, download_gpu_engine, stream_chat_response])
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
