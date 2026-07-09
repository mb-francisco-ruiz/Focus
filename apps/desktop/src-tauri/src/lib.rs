use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::Manager;

/// The running local-AI sidecar: the child process plus the loopback endpoint
/// the webview uses to reach it.
#[derive(Default)]
struct LocalAi(Mutex<Option<Running>>);

struct Running {
    child: Child,
    endpoint: Endpoint,
}

#[derive(Clone, Serialize, Deserialize)]
struct Endpoint {
    port: u16,
    token: String,
}

/// A GUI-launched macOS app inherits launchd's minimal PATH (`/usr/bin:/bin:…`),
/// not the user's shell PATH — so Node (nvm) and `claude` (~/.local/bin) are
/// invisible. Ask the login shell for the real PATH so both the sidecar and the
/// `claude` binary it spawns are found. Falls back to the inherited PATH.
fn login_path() -> String {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let inherited = std::env::var("PATH").unwrap_or_default();
    Command::new(shell)
        .args(["-lic", "echo $PATH"])
        .output()
        .ok()
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .rev()
                .find(|l| l.contains('/'))
                .map(|l| l.trim().to_string())
        })
        .filter(|p| !p.is_empty())
        .unwrap_or(inherited)
}

/// First existing `bin` across the colon-separated `path`, else the bare name.
fn which(bin: &str, path: &str) -> String {
    path.split(':')
        .map(|d| PathBuf::from(d).join(bin))
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| bin.to_string())
}

/// Resolve the sidecar's `index.js`: env override → dev path (next to this
/// crate) → bundled resource (packaged builds).
fn sidecar_entry(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(dir) = std::env::var("FOCUS_SIDECAR_DIR") {
        return PathBuf::from(dir).join("index.js");
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sidecar/index.js");
    if dev.exists() {
        return dev;
    }
    app.path()
        .resolve("sidecar/index.js", tauri::path::BaseDirectory::Resource)
        .unwrap_or(dev)
}

/// Start the sidecar (idempotent) and return its endpoint. Spawns `node`, reads
/// the `{port,token}` handshake line from stdout, and keeps the child alive in
/// managed state. NB: a GUI-launched app may not inherit the shell PATH, so
/// `node`/`claude` must be discoverable — fine in dev (terminal-launched).
#[tauri::command]
fn start_local_ai(
    app: tauri::AppHandle,
    state: tauri::State<'_, LocalAi>,
) -> Result<Endpoint, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(running) = guard.as_ref() {
        return Ok(running.endpoint.clone());
    }

    let entry = sidecar_entry(&app);
    let path = login_path();
    let node = which("node", &path);
    let mut child = Command::new(&node)
        .arg(&entry)
        .env("PATH", &path) // so the sidecar's `claude` subprocess is found too
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start sidecar (is Node installed?): {e} [node={node}]"))?;

    let stdout = child.stdout.take().ok_or("no sidecar stdout")?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| format!("sidecar handshake failed: {e}"))?;
    let endpoint: Endpoint =
        serde_json::from_str(line.trim()).map_err(|e| format!("bad sidecar handshake: {e}"))?;

    // Drain the rest of stdout/stderr so the child never blocks on a full pipe.
    std::thread::spawn(move || {
        for _ in reader.lines() {}
    });
    if let Some(err) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                eprintln!("[sidecar] {line}");
            }
        });
    }

    *guard = Some(Running {
        child,
        endpoint: endpoint.clone(),
    });
    Ok(endpoint)
}

#[tauri::command]
fn stop_local_ai(state: tauri::State<'_, LocalAi>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut running) = guard.take() {
        let _ = running.child.kill();
    }
    Ok(())
}

#[tauri::command]
fn local_ai_endpoint(state: tauri::State<'_, LocalAi>) -> Option<Endpoint> {
    state.0.lock().ok()?.as_ref().map(|r| r.endpoint.clone())
}

// ---- MCP one-click setup ---------------------------------------------------

#[derive(Serialize)]
struct McpSetup {
    built: bool,
    claude_code: String,
    claude_desktop: String,
    dist: String,
}

#[derive(Serialize)]
struct McpStatus {
    registered: bool,
    connected: bool,
    detail: String,
}

/// Live check: is the Focus MCP server registered (and connected) in Claude Code?
/// Runs `claude mcp list` off-thread so it never blocks the UI.
#[tauri::command]
async fn mcp_status() -> Result<McpStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = login_path();
        let claude = which("claude", &path);
        if !claude.contains('/') {
            return McpStatus { registered: false, connected: false, detail: "Claude Code CLI not found".into() };
        }
        let out = Command::new(&claude)
            .args(["mcp", "list"])
            .env("PATH", &path)
            .stdin(Stdio::null())
            .output();
        match out {
            Ok(o) => {
                let s = String::from_utf8_lossy(&o.stdout);
                match s.lines().find(|l| l.trim_start().starts_with("focus:")) {
                    Some(l) => {
                        let connected = l.contains('\u{2714}') || l.to_lowercase().contains("connected");
                        McpStatus { registered: true, connected, detail: l.trim().to_string() }
                    }
                    None => McpStatus { registered: false, connected: false, detail: "Not set up in Claude Code yet".into() },
                }
            }
            Err(e) => McpStatus { registered: false, connected: false, detail: format!("couldn't run claude: {e}") },
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Resolve the MCP server folder (apps/mcp): env override → dev path → resource.
fn mcp_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(d) = std::env::var("FOCUS_MCP_DIR") {
        return PathBuf::from(d);
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../mcp");
    if dev.exists() {
        return dev;
    }
    app.path()
        .resolve("mcp", tauri::path::BaseDirectory::Resource)
        .unwrap_or(dev)
}

/// Run a command in `dir` with the login PATH; return stdout or a readable error.
fn run_in(dir: &Path, program: &str, args: &[&str], path: &str) -> Result<String, String> {
    let out = Command::new(program)
        .args(args)
        .current_dir(dir)
        .env("PATH", path)
        .stdin(Stdio::null()) // never block waiting on stdin (npm/claude prompts)
        .output()
        .map_err(|e| format!("{program} not runnable: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "`{program} {}` failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Merge a `focus` entry into Claude Desktop's config JSON (macOS path).
fn write_desktop_config(dist: &str, token: &str, api: &str) -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "no HOME".to_string())?;
    let cfg = PathBuf::from(home).join("Library/Application Support/Claude/claude_desktop_config.json");
    let dir = cfg.parent().ok_or("bad config path")?;
    if !dir.exists() {
        return Ok("skipped — Claude Desktop not installed".into());
    }
    let mut root: serde_json::Value = if cfg.exists() {
        serde_json::from_str(&std::fs::read_to_string(&cfg).map_err(|e| e.to_string())?)
            .unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };
    if !root.is_object() {
        root = json!({});
    }
    let servers = root
        .as_object_mut()
        .unwrap()
        .entry("mcpServers")
        .or_insert(json!({}));
    if !servers.is_object() {
        *servers = json!({});
    }
    servers.as_object_mut().unwrap().insert(
        "focus".into(),
        json!({ "command": "node", "args": [dist], "env": { "FOCUS_TOKEN": token, "FOCUS_API_URL": api } }),
    );
    std::fs::write(&cfg, serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok("configured — restart Claude Desktop".into())
}

/// Build the MCP server (npm install + build if needed) and register it with
/// Claude Code and Claude Desktop, wired to this user's Focus account.
/// Async + spawn_blocking so the long npm/claude subprocesses never block the
/// UI thread (a sync command would freeze the whole window).
#[tauri::command]
async fn setup_mcp(app: tauri::AppHandle, token: String, api_url: String) -> Result<McpSetup, String> {
    tauri::async_runtime::spawn_blocking(move || setup_mcp_blocking(&app, &token, &api_url))
        .await
        .map_err(|e| format!("setup task failed: {e}"))?
}

fn setup_mcp_blocking(app: &tauri::AppHandle, token: &str, api_url: &str) -> Result<McpSetup, String> {
    let dir = mcp_dir(app);
    if !dir.exists() {
        return Err(format!("MCP folder not found at {}", dir.display()));
    }
    let path = login_path();
    let dist = dir.join("dist/index.js");

    // Build once (or when dist is missing). npm/node come from the login PATH.
    let mut built = false;
    if !dir.join("node_modules").exists() {
        run_in(&dir, &which("npm", &path), &["install", "--legacy-peer-deps"], &path)?;
        built = true;
    }
    if built || !dist.exists() {
        run_in(&dir, &which("npm", &path), &["run", "build"], &path)?;
        built = true;
    }
    let dist_str = dist.to_string_lossy().to_string();

    // Register with Claude Code (remove first so it's idempotent).
    let claude = which("claude", &path);
    let claude_code = if claude.contains('/') {
        let _ = run_in(&dir, &claude, &["mcp", "remove", "focus", "--scope", "user"], &path);
        match run_in(
            &dir,
            &claude,
            &[
                "mcp", "add", "focus",
                "--scope", "user", // available in every Claude Code session, not just here
                "--env", &format!("FOCUS_TOKEN={token}"),
                "--env", &format!("FOCUS_API_URL={api_url}"),
                "--", "node", &dist_str,
            ],
            &path,
        ) {
            Ok(_) => "added".into(),
            Err(e) => format!("error — {e}"),
        }
    } else {
        "skipped — Claude Code CLI not found".into()
    };

    let claude_desktop =
        write_desktop_config(&dist_str, token, api_url).unwrap_or_else(|e| format!("error — {e}"));

    Ok(McpSetup { built, claude_code, claude_desktop, dist: dist_str })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(LocalAi::default())
        .invoke_handler(tauri::generate_handler![
            start_local_ai,
            stop_local_ai,
            local_ai_endpoint,
            setup_mcp,
            mcp_status
        ]);

    // Global shortcuts are desktop-only; mobile builds skip the plugin.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
