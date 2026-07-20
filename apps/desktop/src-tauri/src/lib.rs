use aes_gcm::{
    aead::{Aead, OsRng, rand_core::RngCore},
    Aes256Gcm, KeyInit, Nonce,
};
use base64::{engine::general_purpose, Engine as _};
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    env, fs,
    fs::OpenOptions,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
        Arc,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindowBuilder, WindowEvent, Wry,
};

mod calendar_sources;

const MAIN_WINDOW_LABEL: &str = "main";
const COMPACT_WINDOW_WIDTH: u32 = 620;
const COMPACT_WINDOW_HEIGHT: u32 = 850;
const COMPACT_WINDOW_RIGHT_MARGIN: i32 = 16;
const COMPACT_WINDOW_TOP_OFFSET: i32 = 44;
const KEYCHAIN_SERVICE: &str = "com.weekform.desktop";
const CAPTURE_JOURNAL_KEY_ACCOUNT: &str = "weekform:capture-journal-key:v1";
const CAPTURE_JOURNAL_FILE: &str = "capture-journal-v1.jsonl";
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

struct PauseMenuItem(MenuItem<Wry>);

// Handle to the system tray so the frontend can refresh its tooltip with a
// privacy-safe status line (counts/percentages only).
struct TrayHandle(TrayIcon<Wry>);

struct ActivityCaptureState {
    paused: Arc<AtomicBool>,
}

// Whether opening Weekform from the tray shows the compact quick view instead of
// the full dashboard. Mirrors the frontend's persisted "Default window size"
// setting (set_default_window_mode); defaults to the full window so a first-run
// user lands in the walkthrough and getting-started flow, which only run there.
struct DefaultOpenState {
    compact: AtomicBool,
}
#[derive(Clone, Deserialize, Serialize)]
struct ActiveWindowPayload {
    sample_id: String,
    timestamp_ms: u64,
    app_name: Option<String>,
    window_title: Option<String>,
    capture_error: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct EncryptedJournalEntry {
    version: u8,
    timestamp_ms: u64,
    nonce: String,
    ciphertext: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureJournalStatus {
    encrypted: bool,
    entry_count: usize,
    byte_count: u64,
}

#[derive(Deserialize)]
struct NarrativeGenerationRequest {
    prompt: String,
    model: Option<String>,
    // AI config for multi-provider support
    ai_config: Option<AIConfigRequest>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AIConfigRequest {
    provider: Option<String>,
    connection_mode: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    vision_model: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct GeneratedWeeklyNarrative {
    week_id: String,
    headline: String,
    summary_text: String,
    key_drivers: Vec<String>,
    manager_ready_summary: String,
}

#[derive(Serialize)]
struct NarrativeGenerationResponse {
    narrative: GeneratedWeeklyNarrative,
    model: String,
}

#[derive(Deserialize)]
struct WorkBlockClassificationRequest {
    prompt: String,
    model: Option<String>,
    ai_config: Option<AIConfigRequest>,
}

#[derive(Deserialize, Serialize)]
struct ClassifiedWorkBlock {
    session_ids: Vec<String>,
    start_time: String,
    end_time: String,
    category: String,
    mode: String,
    planned_status: String,
    project_name: String,
    stakeholder_group: String,
    evidence: Vec<String>,
    confidence: f64,
    blocker_flag: bool,
    notes: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct WorkBlockClassificationResult {
    work_blocks: Vec<ClassifiedWorkBlock>,
}

#[derive(Serialize)]
struct WorkBlockClassificationResponse {
    result: WorkBlockClassificationResult,
    model: String,
}

#[derive(Deserialize)]
struct ReviewCopilotRequest {
    prompt: String,
    model: Option<String>,
    ai_config: Option<AIConfigRequest>,
}

#[derive(Deserialize, Serialize)]
struct ReviewCopilotSuggestionOutput {
    action: String,
    work_block_ids: Vec<String>,
    title: String,
    rationale: String,
    confidence: f64,
    proposed_category: Option<String>,
    proposed_mode: Option<String>,
    proposed_planned_status: Option<String>,
    proposed_project_name: Option<String>,
    proposed_stakeholder_group: Option<String>,
    proposed_blocker_flag: Option<bool>,
    proposed_notes: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct ReviewCopilotResult {
    suggestions: Vec<ReviewCopilotSuggestionOutput>,
}

#[derive(Serialize)]
struct ReviewCopilotResponse {
    result: ReviewCopilotResult,
    model: String,
}

#[derive(Deserialize)]
struct ForecastAgentRequest {
    prompt: String,
    model: Option<String>,
    ai_config: Option<AIConfigRequest>,
}

#[derive(Deserialize, Serialize)]
struct ForecastAgentResult {
    forecast_week_label: String,
    reliable_new_work_capacity_pct: f64,
    confidence: f64,
    headline: String,
    summary_text: String,
    key_constraints: Vec<String>,
    risk_flags: Vec<String>,
    recommended_actions: Vec<String>,
    assumptions: Vec<String>,
    optimistic_capacity_pct: f64,
    likely_capacity_pct: f64,
    conservative_capacity_pct: f64,
}

#[derive(Serialize)]
struct ForecastAgentResponse {
    forecast: ForecastAgentResult,
    model: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VisualContextRequest {
    prompt: String,
    app_name: String,
    window_title: Option<String>,
    session_id: Option<String>,
    model: Option<String>,
    ai_config: Option<AIConfigRequest>,
}

#[derive(Deserialize)]
struct AgentChatRequest {
    prompt: String,
    ai_config: Option<AIConfigRequest>,
}

#[derive(Serialize)]
struct AgentChatResponse {
    response: String,
    model: String,
}

/// Generic AI request. The frontend owns all operation-specific shape
/// (instructions, response schema, sampling) and passes it through; Rust keeps
/// only the native concerns: credential resolution, the HTTP call, optional
/// screenshot capture (raw bytes never round-trip to JS), and text extraction.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiCompleteRequest {
    prompt: String,
    instructions: String,
    /// Goes verbatim into body["text"]["format"]: either {"type":"text"} or a
    /// {"type":"json_schema", ...} block built on the TypeScript side.
    response_format: Value,
    model: Option<String>,
    temperature: Option<f64>,
    top_p: Option<f64>,
    reasoning_effort: Option<String>,
    /// When true, Rust captures a PNG, injects it as input_image, and deletes
    /// the file immediately. Keeps screenshot bytes out of the frontend bundle.
    capture_screen: Option<bool>,
    /// When true, fall back to OPENAI_VISION_MODEL before OPENAI_MODEL.
    vision_model_fallback: Option<bool>,
    ai_config: Option<AIConfigRequest>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiCompleteResponse {
    output_text: String,
    model: String,
    /// Present only when capture_screen was requested.
    captured_at_ms: Option<u64>,
    raw_screenshot_retained: Option<bool>,
}

#[derive(Deserialize, Serialize)]
struct VisualContextInsightOutput {
    activity_summary: String,
    visible_tool: Option<String>,
    likely_work_category: Option<String>,
    likely_mode: Option<String>,
    project_hint: Option<String>,
    sensitive_content_detected: bool,
    confidence: f64,
    evidence: Vec<String>,
}

#[derive(Serialize)]
struct VisualContextResponse {
    insight: VisualContextInsightOutput,
    model: String,
    captured_at_ms: u64,
    app_name: String,
    window_title: Option<String>,
    session_id: Option<String>,
    raw_screenshot_retained: bool,
}

fn show_dashboard(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let _ = WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::default())
        .title("Weekform")
        .inner_size(1280.0, 860.0)
        .min_inner_size(1024.0, 720.0)
        .visible(true)
        .build();
}

fn apply_window_mode(app: &AppHandle, mode: &str) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        match mode {
            "compact" => {
                let _ = window.unmaximize();
                let _ = window.set_min_size(Some(PhysicalSize::new(340, 440)));
                let _ = window.set_size(PhysicalSize::new(
                    COMPACT_WINDOW_WIDTH,
                    COMPACT_WINDOW_HEIGHT,
                ));
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let monitor_position = monitor.position();
                    let monitor_size = monitor.size();
                    let x = monitor_position.x + monitor_size.width as i32
                        - COMPACT_WINDOW_WIDTH as i32
                        - COMPACT_WINDOW_RIGHT_MARGIN;
                    let y = monitor_position.y + COMPACT_WINDOW_TOP_OFFSET;
                    let _ = window.set_position(PhysicalPosition::new(x, y));
                }
            }
            _ => {
                let _ = window.set_min_size(Some(PhysicalSize::new(1024, 720)));
                let _ = window.maximize();
            }
        }
    }
}

fn show_quick_view(app: &AppHandle) {
    show_dashboard(app);
    apply_window_mode(app, "compact");
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.eval("window.dispatchEvent(new CustomEvent('clear-capacity:quick-view'))");
    }
}

fn show_large_dashboard(app: &AppHandle) {
    show_dashboard(app);
    apply_window_mode(app, "large");
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.eval("window.dispatchEvent(new CustomEvent('clear-capacity:large-view'))");
    }
}

#[tauri::command]
fn set_clear_capacity_window_mode(app: AppHandle, mode: String) {
    apply_window_mode(&app, &mode);
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn sample_active_window() -> ActiveWindowPayload {
    let sample_id = random_sample_id();
    let output = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\"",
            "-e",
            "set frontApp to name of first application process whose frontmost is true",
            "-e",
            "set windowTitle to \"\"",
            "-e",
            "try",
            "-e",
            "set windowTitle to name of front window of process frontApp",
            "-e",
            "end try",
            "-e",
            "return frontApp & linefeed & windowTitle",
            "-e",
            "end tell",
        ])
        .output();

    match output {
        Ok(result) if result.status.success() => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            let mut lines = stdout.lines();
            let app_name = lines
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let window_title = lines
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);

            ActiveWindowPayload {
                sample_id,
                timestamp_ms: now_ms(),
                app_name,
                window_title,
                capture_error: None,
            }
        }
        Ok(result) => ActiveWindowPayload {
            sample_id,
            timestamp_ms: now_ms(),
            app_name: None,
            window_title: None,
            capture_error: Some(String::from_utf8_lossy(&result.stderr).trim().to_string()),
        },
        Err(error) => ActiveWindowPayload {
            sample_id,
            timestamp_ms: now_ms(),
            app_name: None,
            window_title: None,
            capture_error: Some(error.to_string()),
        },
    }
}

fn random_sample_id() -> String {
    let mut bytes = [0_u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn model_supports_reasoning_effort(model: &str) -> bool {
    let normalized = model.to_ascii_lowercase();
    normalized.starts_with("o1")
        || normalized.starts_with("o3")
        || normalized.starts_with("o4")
        || normalized.starts_with("gpt-5")
        || normalized.contains("reasoning")
}

fn with_reasoning_effort_if_supported(body: &mut Value, model: &str) {
    if model_supports_reasoning_effort(model) {
        body["reasoning"] = json!({ "effort": "low" });
    }
}

fn extract_response_text(value: &Value) -> Option<String> {
    if let Some(output_text) = value.get("output_text").and_then(Value::as_str) {
        return Some(output_text.to_string());
    }

    value
        .get("output")?
        .as_array()?
        .iter()
        .flat_map(|item| {
            item.get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .find_map(|content| {
            content
                .get("text")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn capture_screen_png_base64() -> Result<String, String> {
    let path = env::temp_dir().join(format!("weekform-visual-context-{}.png", now_ms()));
    let status = Command::new("screencapture")
        .args(["-x", "-t", "png"])
        .arg(&path)
        .status()
        .map_err(|error| format!("Could not start macOS screen capture: {error}"))?;

    if !status.success() {
        let _ = fs::remove_file(&path);
        return Err(
            "macOS screen capture failed. Weekform may need Screen Recording permission."
                .to_string(),
        );
    }

    let bytes =
        fs::read(&path).map_err(|error| format!("Could not read screen capture: {error}"))?;
    let _ = fs::remove_file(&path);
    Ok(general_purpose::STANDARD.encode(bytes))
}

fn capture_journal_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve Weekform data directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not prepare Weekform data directory: {error}"))?;
    Ok(directory.join(CAPTURE_JOURNAL_FILE))
}

fn capture_journal_key() -> Result<Vec<u8>, String> {
    match get_generic_password(KEYCHAIN_SERVICE, CAPTURE_JOURNAL_KEY_ACCOUNT) {
        Ok(key) if key.len() == 32 => Ok(key),
        Ok(_) => Err("Capture journal key has an invalid length.".to_string()),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => {
            let mut key = vec![0_u8; 32];
            OsRng.fill_bytes(&mut key);
            set_generic_password(KEYCHAIN_SERVICE, CAPTURE_JOURNAL_KEY_ACCOUNT, &key)
                .map_err(|error| format!("Could not store the capture journal key in macOS Keychain: {error}"))?;
            Ok(key)
        }
        Err(error) => Err(format!("Could not read the capture journal key from macOS Keychain: {error}")),
    }
}

fn encrypt_capture_payload(payload: &ActiveWindowPayload) -> Result<EncryptedJournalEntry, String> {
    let key = capture_journal_key()?;
    let mut nonce_bytes = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    encrypt_capture_payload_with_key(payload, &key, nonce_bytes)
}

fn encrypt_capture_payload_with_key(
    payload: &ActiveWindowPayload,
    key: &[u8],
    nonce_bytes: [u8; 12],
) -> Result<EncryptedJournalEntry, String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Could not initialize capture journal encryption.".to_string())?;
    let plaintext = serde_json::to_vec(payload)
        .map_err(|error| format!("Could not encode the capture journal entry: {error}"))?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_ref())
        .map_err(|_| "Could not encrypt the capture journal entry.".to_string())?;
    Ok(EncryptedJournalEntry {
        version: 1,
        timestamp_ms: payload.timestamp_ms,
        nonce: general_purpose::STANDARD.encode(nonce_bytes),
        ciphertext: general_purpose::STANDARD.encode(ciphertext),
    })
}

fn decrypt_capture_payload(entry: &EncryptedJournalEntry, key: &[u8]) -> Result<ActiveWindowPayload, String> {
    if entry.version != 1 { return Err("Unsupported capture journal version.".to_string()); }
    let nonce = general_purpose::STANDARD.decode(&entry.nonce)
        .map_err(|_| "Capture journal nonce is invalid.".to_string())?;
    let ciphertext = general_purpose::STANDARD.decode(&entry.ciphertext)
        .map_err(|_| "Capture journal ciphertext is invalid.".to_string())?;
    if nonce.len() != 12 { return Err("Capture journal nonce has an invalid length.".to_string()); }
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Could not initialize capture journal decryption.".to_string())?;
    let plaintext = cipher.decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| "Capture journal authentication failed; no entries were returned.".to_string())?;
    serde_json::from_slice(&plaintext)
        .map_err(|_| "Capture journal entry could not be decoded.".to_string())
}

fn append_capture_journal(app: &AppHandle, payload: &ActiveWindowPayload) -> Result<(), String> {
    let path = capture_journal_path(app)?;
    let encrypted = encrypt_capture_payload(payload)?;
    let line = serde_json::to_string(&encrypted)
        .map_err(|error| format!("Could not encode the encrypted capture entry: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("Could not open the encrypted capture journal: {error}"))?;
    writeln!(file, "{line}")
        .and_then(|_| file.flush())
        .map_err(|error| format!("Could not write the encrypted capture journal: {error}"))
}

#[tauri::command]
fn keychain_get_secret(key: String) -> Result<Option<String>, String> {
    match get_generic_password(KEYCHAIN_SERVICE, &key) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "The macOS Keychain value was not valid UTF-8.".to_string()),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
        Err(error) => Err(format!("Could not read from macOS Keychain: {error}")),
    }
}

#[tauri::command]
fn keychain_set_secret(key: String, value: String) -> Result<(), String> {
    set_generic_password(KEYCHAIN_SERVICE, &key, value.as_bytes())
        .map_err(|error| format!("Could not write to macOS Keychain: {error}"))
}

#[tauri::command]
fn keychain_delete_secret(key: String) -> Result<(), String> {
    match delete_generic_password(KEYCHAIN_SERVICE, &key) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
        Err(error) => Err(format!("Could not delete from macOS Keychain: {error}")),
    }
}

#[tauri::command]
fn capture_journal_status(app: AppHandle) -> Result<CaptureJournalStatus, String> {
    let path = capture_journal_path(&app)?;
    if !path.exists() {
        return Ok(CaptureJournalStatus { encrypted: true, entry_count: 0, byte_count: 0 });
    }
    let file = fs::File::open(&path)
        .map_err(|error| format!("Could not inspect the capture journal: {error}"))?;
    let entry_count = BufReader::new(file).lines().filter(|line| line.as_ref().is_ok_and(|value| !value.trim().is_empty())).count();
    let byte_count = fs::metadata(path).map(|metadata| metadata.len()).unwrap_or(0);
    Ok(CaptureJournalStatus { encrypted: true, entry_count, byte_count })
}

#[tauri::command]
fn read_capture_journal(app: AppHandle) -> Result<Vec<ActiveWindowPayload>, String> {
    let path = capture_journal_path(&app)?;
    if !path.exists() { return Ok(Vec::new()); }
    let key = get_generic_password(KEYCHAIN_SERVICE, CAPTURE_JOURNAL_KEY_ACCOUNT)
        .map_err(|error| format!("Could not unlock the encrypted capture journal: {error}"))?;
    if key.len() != 32 { return Err("Capture journal key has an invalid length.".to_string()); }
    let file = fs::File::open(path)
        .map_err(|error| format!("Could not open the encrypted capture journal: {error}"))?;
    let mut samples = Vec::new();
    for line in BufReader::new(file).lines() {
        let line = line.map_err(|error| format!("Could not read a capture journal entry: {error}"))?;
        let entry: EncryptedJournalEntry = serde_json::from_str(&line)
            .map_err(|_| "The encrypted capture journal is corrupt; no partial history was loaded.".to_string())?;
        samples.push(decrypt_capture_payload(&entry, &key)?);
    }
    Ok(samples)
}

#[tauri::command]
fn import_capture_journal_samples(app: AppHandle, samples: Vec<ActiveWindowPayload>) -> Result<usize, String> {
    let existing: HashSet<String> = read_capture_journal(app.clone())?
        .into_iter()
        .map(|sample| sample.sample_id)
        .collect();
    let mut imported = 0_usize;
    for sample in samples {
      if sample.capture_error.is_some() || sample.app_name.is_none() || existing.contains(&sample.sample_id) {
          continue;
      }
      append_capture_journal(&app, &sample)?;
      imported += 1;
    }
    Ok(imported)
}

#[tauri::command]
fn prune_capture_journal(app: AppHandle, cutoff_ms: u64) -> Result<usize, String> {
    let path = capture_journal_path(&app)?;
    if !path.exists() { return Ok(0); }
    let file = fs::File::open(&path)
        .map_err(|error| format!("Could not read the capture journal for retention: {error}"))?;
    let mut kept = Vec::new();
    let mut removed = 0_usize;
    for line in BufReader::new(file).lines() {
        let line = line.map_err(|error| format!("Could not read a capture journal entry: {error}"))?;
        match serde_json::from_str::<EncryptedJournalEntry>(&line) {
            Ok(entry) if entry.version == 1 && entry.timestamp_ms >= cutoff_ms => kept.push(line),
            Ok(_) => removed += 1,
            Err(_) => return Err("The encrypted capture journal is corrupt; retention stopped without rewriting it.".to_string()),
        }
    }
    let replacement = path.with_extension("jsonl.next");
    {
        let mut file = fs::File::create(&replacement)
            .map_err(|error| format!("Could not prepare the retained capture journal: {error}"))?;
        for line in kept { writeln!(file, "{line}").map_err(|error| format!("Could not write retained capture entries: {error}"))?; }
        file.flush().map_err(|error| format!("Could not flush retained capture entries: {error}"))?;
    }
    fs::rename(replacement, path)
        .map_err(|error| format!("Could not replace the capture journal after retention: {error}"))?;
    Ok(removed)
}

#[tauri::command]
fn clear_capture_journal(app: AppHandle) -> Result<(), String> {
    let path = capture_journal_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("Could not clear the capture journal: {error}"))?;
    }
    match delete_generic_password(KEYCHAIN_SERVICE, CAPTURE_JOURNAL_KEY_ACCOUNT) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
        Err(error) => Err(format!("Capture data was removed, but its Keychain key could not be removed: {error}")),
    }
}

#[cfg(test)]
mod capture_journal_tests {
    use super::*;

    #[test]
    fn encrypted_capture_entry_round_trips_and_contains_no_plaintext() {
        let payload = ActiveWindowPayload {
            sample_id: "sample-test".to_string(),
            timestamp_ms: 1_721_000_000_000,
            app_name: Some("Sensitive App".to_string()),
            window_title: Some("Customer Alpha renewal".to_string()),
            capture_error: None,
        };
        let key = [7_u8; 32];
        let entry = encrypt_capture_payload_with_key(&payload, &key, [9_u8; 12])
            .expect("encrypts");
        let serialized = serde_json::to_string(&entry).expect("serializes");
        assert!(!serialized.contains("Sensitive App"));
        assert!(!serialized.contains("Customer Alpha"));
        let decoded = decrypt_capture_payload(&entry, &key).expect("decrypts");
        assert_eq!(decoded.sample_id, payload.sample_id);
        assert_eq!(decoded.app_name, payload.app_name);
        assert_eq!(decoded.window_title, payload.window_title);
    }

    #[test]
    fn tampered_capture_entry_fails_authentication() {
        let payload = ActiveWindowPayload {
            sample_id: "sample-test".to_string(),
            timestamp_ms: 1,
            app_name: Some("App".to_string()),
            window_title: None,
            capture_error: None,
        };
        let key = [1_u8; 32];
        let mut entry = encrypt_capture_payload_with_key(&payload, &key, [2_u8; 12])
            .expect("encrypts");
        entry.ciphertext.push('A');
        assert!(decrypt_capture_payload(&entry, &key).is_err());
    }
}

fn start_activity_capture(app: AppHandle, paused: Arc<AtomicBool>) {
    thread::spawn(move || loop {
        if !paused.load(Ordering::SeqCst) {
            let mut payload = sample_active_window();
            if payload.capture_error.is_none() && payload.app_name.is_some() {
                if let Err(error) = append_capture_journal(&app, &payload) {
                    // Fail closed: a sensitive sample is not emitted into JS when its
                    // encrypted native journal write did not complete.
                    payload.app_name = None;
                    payload.window_title = None;
                    payload.capture_error = Some(error);
                }
            }
            let _ = app.emit("clear-capacity:active-window-sample", payload);
        }

        thread::sleep(Duration::from_secs(5));
    });
}

fn dispatch_to_main_window(app: &AppHandle, script: &str) {
    show_dashboard(app);

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.eval(script);
    }
}

fn navigate(app: &AppHandle, screen: &str) {
    dispatch_to_main_window(
        app,
        &format!(
            "window.dispatchEvent(new CustomEvent('clear-capacity:navigate', {{ detail: '{}' }}))",
            screen
        ),
    );
}

#[tauri::command]
fn set_pause_menu_label(pause_item: State<'_, PauseMenuItem>, paused: bool) {
    let label = if paused {
        "Resume Tracking"
    } else {
        "Pause Tracking"
    };
    let _ = pause_item.0.set_text(label);
}

#[tauri::command]
fn set_tray_tooltip(tray: State<'_, TrayHandle>, tooltip: String) {
    let _ = tray.0.set_tooltip(Some(tooltip));
}

#[tauri::command]
fn set_activity_capture_paused(activity_state: State<'_, ActivityCaptureState>, paused: bool) {
    activity_state.paused.store(paused, Ordering::SeqCst);
}

#[tauri::command]
fn set_default_window_mode(open_state: State<'_, DefaultOpenState>, mode: String) {
    open_state.compact.store(mode == "compact", Ordering::SeqCst);
}

/// Bring the main window forward in the full dashboard layout. Called by the
/// frontend on a first launch (walkthrough not yet completed) so onboarding
/// starts immediately after install instead of hiding behind the menu-bar icon.
#[tauri::command]
fn present_main_window(app: AppHandle) {
    show_large_dashboard(&app);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvAiKeyStatus {
    openai_key_present: bool,
}

/// Whether an OpenAI key is already available from the environment (a local
/// `.env` loaded by dotenvy at startup, or an exported shell variable). The
/// AI commands' `get_ai_credentials` falls back to exactly this variable, so
/// "present" here means AI calls will work without any key saved in Settings —
/// the onboarding wizard uses it to show an honest "already connected" state.
#[tauri::command]
fn get_env_ai_key_status() -> EnvAiKeyStatus {
    EnvAiKeyStatus {
        openai_key_present: env::var("OPENAI_API_KEY")
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
    }
}

const CODEX_APP_SERVER_TIMEOUT: Duration = Duration::from_secs(45);
const CODEX_TURN_TIMEOUT: Duration = Duration::from_secs(180);
const CODEX_LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

const CODEX_FEATURE_OVERRIDES: &[&str] = &[
    "features.apps=false",
    "features.auth_elicitation=false",
    "features.browser_use=false",
    "features.browser_use_external=false",
    "features.code_mode_host=false",
    "features.computer_use=false",
    "features.goals=false",
    "features.hooks=false",
    "features.image_generation=false",
    "features.in_app_browser=false",
    "features.multi_agent=false",
    "features.plugins=false",
    "features.plugin_sharing=false",
    "features.remote_plugin=false",
    "features.shell_snapshot=false",
    "features.shell_tool=false",
    "features.skill_mcp_dependency_install=false",
    "features.skill_search=false",
    "features.tool_suggest=false",
    "features.unified_exec=false",
    "features.workspace_dependencies=false",
];

fn uses_codex_app_server(config: Option<&AIConfigRequest>) -> bool {
    config
        .and_then(|value| value.connection_mode.as_deref())
        == Some("codex")
}

fn find_codex_binary() -> Result<PathBuf, String> {
    if let Ok(configured) = env::var("WEEKFORM_CODEX_BINARY") {
        let path = PathBuf::from(configured);
        if path.is_file() {
            return Ok(path);
        }
        return Err(
            "WEEKFORM_CODEX_BINARY does not point to a usable Codex executable.".to_string(),
        );
    }

    let fixed_candidates = [
        "/Applications/ChatGPT.app/Contents/Resources/codex",
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
    ];
    for candidate in fixed_candidates {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Ok(path);
        }
    }
    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path) {
            let candidate = directory.join("codex");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    Err(
        "Weekform could not find a Codex app-server. Install the ChatGPT desktop app or Codex CLI, then try again."
            .to_string(),
    )
}

fn codex_data_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve Weekform's local data folder: {error}"))?;
    let codex_home = app_data.join("codex-app-server");
    let workspace = app_data.join("codex-workspace");
    fs::create_dir_all(&codex_home)
        .map_err(|error| format!("Could not prepare Codex credentials storage: {error}"))?;
    fs::create_dir_all(&workspace)
        .map_err(|error| format!("Could not prepare the private Codex workspace: {error}"))?;
    Ok((codex_home, workspace))
}

struct CodexAppServer {
    child: Child,
    stdin: ChildStdin,
    messages: Receiver<Value>,
    pending: Vec<Value>,
    next_id: u64,
}

impl Drop for CodexAppServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl CodexAppServer {
    fn start(codex_home: &Path, workspace: &Path) -> Result<Self, String> {
        let fallback_auth = codex_home.join("auth.json");
        if fallback_auth.exists() {
            fs::remove_file(&fallback_auth).map_err(|_| {
                "Weekform found Codex credentials outside macOS Keychain and could not remove them. Remove the Weekform Codex connection before continuing."
                    .to_string()
            })?;
        }
        let binary = find_codex_binary()?;
        let mut command = Command::new(binary);
        command
            .env("CODEX_HOME", codex_home)
            .env_remove("OPENAI_API_KEY")
            .env_remove("CODEX_API_KEY")
            .env_remove("CODEX_ACCESS_TOKEN")
            .current_dir(workspace)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // App-server diagnostics may contain local paths; Weekform neither logs nor retains them.
            .stderr(Stdio::null())
            .arg("-c")
            .arg("cli_auth_credentials_store=\"keyring\"")
            .arg("-c")
            .arg("check_for_update_on_startup=false")
            .arg("-c")
            .arg("web_search=\"disabled\"");
        for feature in CODEX_FEATURE_OVERRIDES {
            command.arg("-c").arg(feature);
        }
        command.arg("app-server");

        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start the Codex app-server: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex app-server input was unavailable.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex app-server output was unavailable.".to_string())?;
        let (sender, messages) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if sender.send(value).is_err() {
                    break;
                }
            }
        });

        let mut server = Self {
            child,
            stdin,
            messages,
            pending: Vec::new(),
            next_id: 1,
        };
        server.request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "weekform",
                    "title": "Weekform",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {
                    "experimentalApi": true,
                    "optOutNotificationMethods": [
                        "item/agentMessage/delta",
                        "item/reasoning/summaryTextDelta",
                        "item/reasoning/textDelta"
                    ]
                }
            }),
            CODEX_APP_SERVER_TIMEOUT,
        )?;
        server.notify("initialized", json!({}))?;
        Ok(server)
    }

    fn write_value(&mut self, value: &Value) -> Result<(), String> {
        serde_json::to_writer(&mut self.stdin, value)
            .map_err(|error| format!("Could not encode a Codex app-server request: {error}"))?;
        self.stdin
            .write_all(b"\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("Could not send a Codex app-server request: {error}"))
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.write_value(&json!({ "method": method, "params": params }))
    }

    fn request(&mut self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.write_value(&json!({ "method": method, "id": id, "params": params }))?;
        let deadline = std::time::Instant::now() + timeout;

        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return Err(format!("Codex app-server timed out during {method}."));
            }
            let message = self
                .messages
                .recv_timeout(remaining)
                .map_err(|_| format!("Codex app-server stopped during {method}."))?;
            if message.get("id").and_then(Value::as_u64) == Some(id) {
                if let Some(error) = message.get("error") {
                    let detail = error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Codex app-server returned an error.");
                    return Err(detail.to_string());
                }
                return message
                    .get("result")
                    .cloned()
                    .ok_or_else(|| "Codex app-server returned an empty response.".to_string());
            }
            // This integration never exposes tools. Deny any unexpected server request instead
            // of leaving a model-initiated operation waiting for approval.
            if message.get("id").is_some() && message.get("method").is_some() {
                if let Some(request_id) = message.get("id").cloned() {
                    self.write_value(&json!({
                        "id": request_id,
                        "error": { "code": -32601, "message": "Weekform does not expose tools." }
                    }))?;
                }
            } else {
                self.pending.push(message);
            }
        }
    }

    fn next_message(&mut self, timeout: Duration) -> Result<Value, String> {
        if !self.pending.is_empty() {
            return Ok(self.pending.remove(0));
        }
        let deadline = std::time::Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return Err("Codex app-server did not complete the operation in time.".to_string());
            }
            let message = self.messages.recv_timeout(remaining).map_err(|_| {
                "Codex app-server did not complete the operation in time.".to_string()
            })?;
            if message.get("id").is_some() && message.get("method").is_some() {
                if let Some(request_id) = message.get("id").cloned() {
                    self.write_value(&json!({
                        "id": request_id,
                        "error": { "code": -32601, "message": "Weekform does not expose tools." }
                    }))?;
                }
                continue;
            }
            return Ok(message);
        }
    }
}

fn codex_output_schema(response_format: &Value) -> Option<Value> {
    (response_format.get("type").and_then(Value::as_str) == Some("json_schema"))
        .then(|| response_format.get("schema").cloned())
        .flatten()
}

fn codex_thread_start_params(model: &str, workspace: &Path, instructions: &str) -> Value {
    json!({
        "model": model,
        "cwd": workspace,
        "approvalPolicy": "never",
        "sandbox": "read-only",
        "ephemeral": true,
        "serviceName": "weekform",
        "baseInstructions": format!(
            "{instructions}\n\nDo not use tools, browse, inspect files, run commands, modify state, or ask for approval. Use only the content supplied in the user turn. Return one bounded final answer."
        )
    })
}

fn codex_turn_start_params(
    thread_id: &str,
    prompt: &str,
    output_schema: Option<Value>,
    image_data_url: Option<&str>,
) -> Value {
    let mut input = vec![json!({ "type": "text", "text": prompt, "text_elements": [] })];
    if let Some(url) = image_data_url {
        input.push(json!({ "type": "image", "url": url, "detail": "low" }));
    }
    let mut params = json!({ "threadId": thread_id, "input": input });
    if let Some(schema) = output_schema {
        params["outputSchema"] = schema;
    }
    params
}

fn select_codex_model(preferred: Option<&str>, response: &Value) -> Option<String> {
    let models = response.get("data")?.as_array()?;
    if let Some(preferred) = preferred {
        if let Some(model) = models.iter().find(|entry| {
            entry.get("id").and_then(Value::as_str) == Some(preferred)
                || entry.get("model").and_then(Value::as_str) == Some(preferred)
        }) {
            return model
                .get("model")
                .or_else(|| model.get("id"))
                .and_then(Value::as_str)
                .map(str::to_string);
        }
    }
    models
        .iter()
        .find(|entry| entry.get("isDefault").and_then(Value::as_bool) == Some(true))
        .or_else(|| models.iter().find(|entry| entry.get("hidden").and_then(Value::as_bool) != Some(true)))
        .and_then(|model| model.get("model").or_else(|| model.get("id")))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn codex_account(server: &mut CodexAppServer, refresh: bool) -> Result<Value, String> {
    server.request(
        "account/read",
        json!({ "refreshToken": refresh }),
        CODEX_APP_SERVER_TIMEOUT,
    )
}

fn require_codex_keyring_storage(codex_home: &Path) -> Result<(), String> {
    let fallback_auth = codex_home.join("auth.json");
    if !fallback_auth.exists() {
        return Ok(());
    }
    let removed = fs::remove_file(&fallback_auth).is_ok();
    Err(if removed {
        "macOS Keychain was unavailable, so Weekform discarded the Codex sign-in instead of retaining OAuth credentials in a local file. Unlock Keychain and try again."
            .to_string()
    } else {
        "macOS Keychain was unavailable and Weekform could not remove Codex's fallback credential file. Reset Local Data before continuing."
            .to_string()
    })
}

fn codex_model_catalog(server: &mut CodexAppServer) -> Result<Value, String> {
    server.request(
        "model/list",
        json!({ "includeHidden": false, "limit": 100 }),
        CODEX_APP_SERVER_TIMEOUT,
    )
}

fn complete_with_codex_app_server(
    app: &AppHandle,
    preferred_model: Option<&str>,
    instructions: &str,
    prompt: &str,
    response_format: &Value,
    image_data_url: Option<&str>,
) -> Result<(String, String), String> {
    let (codex_home, workspace) = codex_data_paths(app)?;
    let mut server = CodexAppServer::start(&codex_home, &workspace)?;
    let account = codex_account(&mut server, true)?;
    require_codex_keyring_storage(&codex_home)?;
    if account
        .pointer("/account/type")
        .and_then(Value::as_str)
        != Some("chatgpt")
    {
        return Err(
            "Connect your ChatGPT/Codex plan in Weekform Settings before using AI features."
                .to_string(),
        );
    }
    let catalog = codex_model_catalog(&mut server)?;
    let model = select_codex_model(preferred_model, &catalog)
        .ok_or_else(|| "Your ChatGPT workspace did not return an available Codex model.".to_string())?;
    let thread = server.request(
        "thread/start",
        codex_thread_start_params(&model, &workspace, instructions),
        CODEX_APP_SERVER_TIMEOUT,
    )?;
    let thread_id = thread
        .pointer("/thread/id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Codex app-server did not return a thread id.".to_string())?
        .to_string();
    let turn = server.request(
        "turn/start",
        codex_turn_start_params(
            &thread_id,
            prompt,
            codex_output_schema(response_format),
            image_data_url,
        ),
        CODEX_APP_SERVER_TIMEOUT,
    )?;
    let turn_id = turn
        .pointer("/turn/id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Codex app-server did not return a turn id.".to_string())?
        .to_string();
    let deadline = std::time::Instant::now() + CODEX_TURN_TIMEOUT;
    let mut output_text: Option<String> = None;

    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err("Codex generation timed out.".to_string());
        }
        let message = server.next_message(remaining)?;
        match message.get("method").and_then(Value::as_str) {
            Some("item/completed")
                if message.pointer("/params/turnId").and_then(Value::as_str)
                    == Some(turn_id.as_str()) =>
            {
                if message.pointer("/params/item/type").and_then(Value::as_str)
                    == Some("agentMessage")
                {
                    output_text = message
                        .pointer("/params/item/text")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                }
            }
            Some("turn/completed")
                if message.pointer("/params/turn/id").and_then(Value::as_str)
                    == Some(turn_id.as_str()) =>
            {
                let status = message
                    .pointer("/params/turn/status")
                    .and_then(Value::as_str)
                    .unwrap_or("failed");
                if status != "completed" {
                    let detail = message
                        .pointer("/params/turn/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("Codex could not complete the generation.");
                    return Err(detail.to_string());
                }
                return output_text
                    .filter(|text| !text.trim().is_empty())
                    .map(|text| (text, model))
                    .ok_or_else(|| "Codex completed without a final answer.".to_string());
            }
            _ => {}
        }
    }
}

async fn complete_with_codex_async(
    app: AppHandle,
    preferred_model: Option<String>,
    instructions: String,
    prompt: String,
    response_format: Value,
    image_data_url: Option<String>,
) -> Result<(String, String), String> {
    tauri::async_runtime::spawn_blocking(move || {
        complete_with_codex_app_server(
            &app,
            preferred_model.as_deref(),
            &instructions,
            &prompt,
            &response_format,
            image_data_url.as_deref(),
        )
    })
    .await
    .map_err(|error| format!("Codex generation stopped unexpectedly: {error}"))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexPlanConnectResult {
    model: String,
    plan_type: String,
    message: String,
}

#[tauri::command]
async fn connect_codex_via_chatgpt(app: AppHandle) -> Result<CodexPlanConnectResult, String> {
    let (codex_home, workspace) = codex_data_paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut server = CodexAppServer::start(&codex_home, &workspace)?;
        let mut account = codex_account(&mut server, false)?;
        if account.get("account").is_none() || account.get("account") == Some(&Value::Null) {
            let login = server.request(
                "account/login/start",
                json!({
                    "type": "chatgpt",
                    "appBrand": "codex",
                    "codexStreamlinedLogin": true,
                    "useHostedLoginSuccessPage": true
                }),
                CODEX_APP_SERVER_TIMEOUT,
            )?;
            let auth_url = login
                .get("authUrl")
                .and_then(Value::as_str)
                .ok_or_else(|| "Codex did not return a browser sign-in URL.".to_string())?;
            let login_id = login
                .get("loginId")
                .and_then(Value::as_str)
                .ok_or_else(|| "Codex did not return a sign-in id.".to_string())?
                .to_string();
            tauri_plugin_opener::open_url(auth_url, None::<&str>)
                .map_err(|error| format!("Could not open ChatGPT sign-in: {error}"))?;

            let deadline = std::time::Instant::now() + CODEX_LOGIN_TIMEOUT;
            loop {
                let remaining = deadline.saturating_duration_since(std::time::Instant::now());
                if remaining.is_zero() {
                    return Err("Timed out waiting for ChatGPT sign-in.".to_string());
                }
                let message = server.next_message(remaining)?;
                if message.get("method").and_then(Value::as_str)
                    != Some("account/login/completed")
                    || message.pointer("/params/loginId").and_then(Value::as_str)
                        != Some(login_id.as_str())
                {
                    continue;
                }
                if message.pointer("/params/success").and_then(Value::as_bool) != Some(true) {
                    return Err(message
                        .pointer("/params/error")
                        .and_then(Value::as_str)
                        .unwrap_or("ChatGPT sign-in was not completed.")
                        .to_string());
                }
                break;
            }
            account = codex_account(&mut server, true)?;
        }
        require_codex_keyring_storage(&codex_home)?;

        if account.pointer("/account/type").and_then(Value::as_str) != Some("chatgpt") {
            return Err("The Codex app-server is not signed in with ChatGPT.".to_string());
        }
        let plan_type = account
            .pointer("/account/planType")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let catalog = codex_model_catalog(&mut server)?;
        let model = select_codex_model(None, &catalog)
            .ok_or_else(|| "Your ChatGPT workspace did not return an available Codex model.".to_string())?;
        Ok(CodexPlanConnectResult {
            model,
            plan_type,
            message: "Connected through the Codex app-server. No Platform API key was created or copied."
                .to_string(),
        })
    })
    .await
    .map_err(|error| format!("Codex sign-in stopped unexpectedly: {error}"))?
}

#[tauri::command]
async fn disconnect_codex(app: AppHandle) -> Result<(), String> {
    let (codex_home, workspace) = codex_data_paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        {
            let mut server = CodexAppServer::start(&codex_home, &workspace)?;
            server.request("account/logout", json!({}), CODEX_APP_SERVER_TIMEOUT)?;
        }
        if codex_home.exists() {
            fs::remove_dir_all(&codex_home)
                .map_err(|error| format!("Codex signed out, but its local cache could not be cleared: {error}"))?;
        }
        if workspace.exists() {
            fs::remove_dir_all(&workspace)
                .map_err(|error| format!("Codex signed out, but its private workspace could not be cleared: {error}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Codex sign-out stopped unexpectedly: {error}"))?
}

fn random_urlsafe(byte_len: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; byte_len];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

fn oauth_html_response(stream: &mut std::net::TcpStream, status: u16, message: &str) {
    use std::io::Write;
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Weekform</title></head>\
         <body style=\"display:grid;place-items:center;height:100vh;margin:0;\
         font-family:-apple-system,system-ui,sans-serif;background:#141413;color:#f2f1ed\">\
         <p style=\"max-width:420px;text-align:center;line-height:1.6\">{message}</p></body></html>"
    );
    let status_line = if status == 200 { "200 OK" } else { "404 Not Found" };
    let _ = stream.write_all(
        format!(
            "HTTP/1.1 {status_line}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .as_bytes(),
    );
}

// --- Weekform Web browser sign-in (Supabase OAuth + PKCE) ----------------

const CLOUD_OAUTH_PORT: u16 = 49321;
const CLOUD_OAUTH_CALLBACK_PATH: &str = "/cloud-auth/callback";
const CLOUD_OAUTH_TIMEOUT_SECS: u64 = 300;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudOAuthRequest {
    supabase_url: String,
    provider: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudOAuthCallback {
    auth_code: String,
    code_verifier: String,
}

fn build_cloud_oauth_authorize_url(
    supabase_url: &str,
    provider: &str,
    callback_url: &str,
    code_challenge: &str,
) -> Result<String, String> {
    if provider != "google" && provider != "github" {
        return Err("Choose Google or GitHub to continue.".to_string());
    }

    let mut url = reqwest::Url::parse(supabase_url)
        .map_err(|_| "Weekform Web is configured with an invalid URL.".to_string())?;
    let is_loopback_http =
        url.scheme() == "http" && matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"));
    if url.scheme() != "https" && !is_loopback_http {
        return Err("Weekform Web sign-in requires a secure service URL.".to_string());
    }

    url.set_path("/auth/v1/authorize");
    url.set_query(None);
    url.query_pairs_mut()
        .append_pair("provider", provider)
        .append_pair("redirect_to", callback_url)
        .append_pair("code_challenge", code_challenge)
        .append_pair("code_challenge_method", "s256");
    Ok(url.to_string())
}

fn parse_cloud_oauth_callback(target: &str, expected_state: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(&format!("http://127.0.0.1:{CLOUD_OAUTH_PORT}{target}"))
        .map_err(|_| "The browser sign-in response was malformed. Please try again.".to_string())?;
    if url.path() != CLOUD_OAUTH_CALLBACK_PATH {
        return Err("Not found.".to_string());
    }

    let mut code = None;
    let mut callback_state = None;
    let mut callback_error = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => callback_state = Some(value.into_owned()),
            "error" | "error_description" => callback_error = Some(value.into_owned()),
            _ => {}
        }
    }

    if let Some(error) = callback_error {
        return Err(format!(
            "Browser sign-in was not completed ({}).",
            error.chars().take(120).collect::<String>()
        ));
    }
    if callback_state.as_deref() != Some(expected_state) {
        return Err(
            "The browser sign-in response could not be verified. Please try again.".to_string(),
        );
    }
    let code = code.filter(|value| !value.is_empty()).ok_or_else(|| {
        "The browser sign-in response did not include a verification code. Please try again."
            .to_string()
    })?;
    Ok(code)
}

fn wait_for_cloud_oauth_callback(
    listener: std::net::TcpListener,
    expected_state: &str,
) -> Result<String, String> {
    use std::io::Read;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Could not prepare Weekform Web sign-in: {error}"))?;
    let deadline = std::time::Instant::now() + Duration::from_secs(CLOUD_OAUTH_TIMEOUT_SECS);

    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let mut buf = [0u8; 4096];
                let read = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..read]);
                let target = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("");

                if !target.starts_with(CLOUD_OAUTH_CALLBACK_PATH) {
                    oauth_html_response(&mut stream, 404, "Not found.");
                    continue;
                }

                match parse_cloud_oauth_callback(target, expected_state) {
                    Ok(code) => {
                        oauth_html_response(
                            &mut stream,
                            200,
                            "You're signed in to Weekform Web. Close this tab and return to Weekform.",
                        );
                        return Ok(code);
                    }
                    Err(error) => {
                        oauth_html_response(
                            &mut stream,
                            200,
                            "This sign-in response could not be verified. Return to Weekform and try again.",
                        );
                        return Err(error);
                    }
                }
            }
            Err(ref error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() > deadline {
                    return Err(
                        "Timed out waiting for browser sign-in. Try again from Weekform."
                            .to_string(),
                    );
                }
                thread::sleep(Duration::from_millis(120));
            }
            Err(error) => return Err(format!("The Weekform Web sign-in listener failed: {error}")),
        }
    }
}

#[tauri::command]
async fn start_cloud_oauth(request: CloudOAuthRequest) -> Result<CloudOAuthCallback, String> {
    use sha2::{Digest, Sha256};

    let verifier = random_urlsafe(64);
    let challenge = general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_urlsafe(32);
    let listener = std::net::TcpListener::bind(("127.0.0.1", CLOUD_OAUTH_PORT)).map_err(|_| {
        format!(
            "Port {CLOUD_OAUTH_PORT} is busy. Close another Weekform sign-in window and try again."
        )
    })?;
    let callback_url =
        format!("http://127.0.0.1:{CLOUD_OAUTH_PORT}{CLOUD_OAUTH_CALLBACK_PATH}?state={state}");
    let authorize_url = build_cloud_oauth_authorize_url(
        &request.supabase_url,
        &request.provider,
        &callback_url,
        &challenge,
    )?;
    tauri_plugin_opener::open_url(&authorize_url, None::<&str>)
        .map_err(|error| format!("Could not open your browser for sign-in: {error}"))?;

    let expected_state = state.clone();
    let auth_code = tauri::async_runtime::spawn_blocking(move || {
        wait_for_cloud_oauth_callback(listener, &expected_state)
    })
    .await
    .map_err(|error| format!("The Weekform Web sign-in listener failed: {error}"))??;

    Ok(CloudOAuthCallback {
        auth_code,
        code_verifier: verifier,
    })
}

fn get_ai_credentials(config: Option<&AIConfigRequest>) -> Result<(String, String), String> {
    let provider = config
        .and_then(|c| c.provider.as_deref())
        .unwrap_or("openai");
    let provider_key_name = match provider {
        "grok" => "XAI_API_KEY",
        "deepseek" => "DEEPSEEK_API_KEY",
        _ => "OPENAI_API_KEY",
    };
    let api_key = config
        .and_then(|c| c.api_key.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            env::var(provider_key_name)
                .ok()
                .filter(|v| !v.trim().is_empty())
        })
        .or_else(|| {
            if provider == "grok" {
                env::var("GROK_API_KEY")
                    .ok()
                    .filter(|v| !v.trim().is_empty())
            } else {
                None
            }
        })
        .ok_or_else(|| {
            format!(
                "No API key for provider {}. Set in settings or env.",
                provider
            )
        })?;

    let base_url = config
        .and_then(|c| c.base_url.as_deref())
        .map(|s| s.trim_end_matches('/').to_string())
        .unwrap_or_else(|| match provider {
            "grok" => "https://api.x.ai/v1".to_string(),
            "deepseek" => "https://api.deepseek.com".to_string(),
            "custom" => "https://api.openai.com/v1".to_string(),
            _ => "https://api.openai.com/v1".to_string(),
        });

    Ok((api_key, base_url))
}

fn extract_provider_error(value: &Value) -> Option<&str> {
    value
        .get("error")
        .and_then(|error| {
            error
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| error.as_str())
        })
        .or_else(|| value.get("message").and_then(Value::as_str))
        .or_else(|| value.get("detail").and_then(Value::as_str))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestAIConnectionRequest {
    ai_config: AIConfigRequest,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TestAIConnectionResponse {
    provider: String,
    model: String,
    message: String,
}

#[tauri::command]
async fn test_ai_connection(
    app: AppHandle,
    request: TestAIConnectionRequest,
) -> Result<TestAIConnectionResponse, String> {
    let config = &request.ai_config;
    let provider = config.provider.as_deref().unwrap_or("openai");
    let model = config
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Enter a model before testing the connection.".to_string())?;
    if uses_codex_app_server(Some(config)) {
        let preferred_model = model.to_string();
        let (codex_home, workspace) = codex_data_paths(&app)?;
        let selected_model = tauri::async_runtime::spawn_blocking(move || {
            let mut server = CodexAppServer::start(&codex_home, &workspace)?;
            let account = codex_account(&mut server, true)?;
            if account.pointer("/account/type").and_then(Value::as_str) != Some("chatgpt") {
                return Err("The Weekform Codex connection is no longer signed in.".to_string());
            }
            let catalog = codex_model_catalog(&mut server)?;
            select_codex_model(Some(&preferred_model), &catalog)
                .ok_or_else(|| "Your ChatGPT workspace did not return an available Codex model.".to_string())
        })
        .await
        .map_err(|error| format!("Codex connection test stopped unexpectedly: {error}"))??;
        return Ok(TestAIConnectionResponse {
            provider: "openai".to_string(),
            model: selected_model.clone(),
            message: format!(
                "Connected through your ChatGPT/Codex plan. Model “{selected_model}” is available."
            ),
        });
    }
    let (api_key, base_url) = get_ai_credentials(Some(config))?;
    let client = reqwest::Client::new();
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let request_builder = client.get(url).bearer_auth(api_key);

    let response = request_builder
        .send()
        .await
        .map_err(|error| format!("Could not reach the provider: {error}"))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Provider response could not be read: {error}"))?;
    let value = serde_json::from_str::<Value>(&response_text).unwrap_or(Value::Null);

    if !status.is_success() {
        let message =
            extract_provider_error(&value).unwrap_or("The provider rejected the connection.");
        return Err(format!("{message} ({status})"));
    }

    let models = value
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| value.get("models").and_then(Value::as_array));
    if let Some(models) = models {
        let model_available = models.iter().any(|item| {
            item.get("id")
                .or_else(|| item.get("name"))
                .and_then(Value::as_str)
                .is_some_and(|id| id == model)
        });
        if !model_available {
            return Err(format!(
                "Connected to the provider, but model “{model}” is not available to this API key."
            ));
        }
    }

    Ok(TestAIConnectionResponse {
        provider: provider.to_string(),
        model: model.to_string(),
        message: format!("Connected to {provider}. Model “{model}” is available."),
    })
}

#[tauri::command]
async fn generate_weekly_narrative_with_openai(
    app: AppHandle,
    request: NarrativeGenerationRequest,
) -> Result<NarrativeGenerationResponse, String> {
    let codex_connection = uses_codex_app_server(request.ai_config.as_ref());
    let model = request
        .model
        .or_else(|| request.ai_config.as_ref().and_then(|c| c.model.clone()))
        .or_else(|| env::var("OPENAI_MODEL").ok())
        .unwrap_or_else(|| "gpt-4o".to_string());
    let schema = json!({
      "type": "object",
      "additionalProperties": false,
      "required": ["week_id", "headline", "summary_text", "key_drivers", "manager_ready_summary"],
      "properties": {
        "week_id": { "type": "string" },
        "headline": { "type": "string" },
        "summary_text": { "type": "string" },
        "key_drivers": {
          "type": "array",
          "minItems": 3,
          "maxItems": 6,
          "items": { "type": "string" }
        },
        "manager_ready_summary": { "type": "string" }
      }
    });
    const INSTRUCTIONS: &str = "You generate Weekform weekly workload narratives from structured local work context. Keep summary_text and key_drivers concrete, explainable, and careful not to overstate certainty. Write manager_ready_summary as a polished first-person update in the user's own voice, focused on projects, tasks, progress, interruptions, blockers, and next steps. The manager-ready text must never mention confidence, evidence, tracking, classification, sessions, work blocks, models, estimates, app mechanics, review status, or technical capacity terminology. Return only JSON matching the requested schema. Adapt to any model capabilities.";
    if codex_connection {
        let (output_text, model) = complete_with_codex_async(
            app,
            Some(model),
            INSTRUCTIONS.to_string(),
            request.prompt,
            json!({ "type": "json_schema", "schema": schema }),
            None,
        )
        .await?;
        let narrative = serde_json::from_str::<GeneratedWeeklyNarrative>(&output_text)
            .map_err(|error| format!("AI narrative JSON could not be parsed: {error}"))?;
        return Ok(NarrativeGenerationResponse { narrative, model });
    }
    let (api_key, base_url) = get_ai_credentials(request.ai_config.as_ref())?;
    let mut body = json!({
      "model": model,
      "store": false,
      "instructions": INSTRUCTIONS,
      "input": request.prompt,
      "text": {
        "format": {
          "type": "json_schema",
          "name": "weekform_weekly_narrative",
          "strict": true,
          "schema": schema
        }
      }
    });
    with_reasoning_effort_if_supported(&mut body, &model);

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/responses", base_url))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("AI request failed: {error}"))?;
    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("AI response could not be read: {error}"))?;

    if !status.is_success() {
        let message = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("AI provider returned an error.");
        return Err(format!("{message} ({status})"));
    }

    let output_text = extract_response_text(&value)
        .ok_or_else(|| "AI response did not include generated text.".to_string())?;
    let narrative = serde_json::from_str::<GeneratedWeeklyNarrative>(&output_text)
        .map_err(|error| format!("AI narrative JSON could not be parsed: {error}"))?;

    Ok(NarrativeGenerationResponse { narrative, model })
}

#[tauri::command]
async fn classify_active_window_sessions_with_openai(
    app: AppHandle,
    request: WorkBlockClassificationRequest,
) -> Result<WorkBlockClassificationResponse, String> {
    let codex_connection = uses_codex_app_server(request.ai_config.as_ref());
    let model = request
        .model
        .or_else(|| request.ai_config.as_ref().and_then(|c| c.model.clone()))
        .or_else(|| env::var("OPENAI_MODEL").ok())
        .unwrap_or_else(|| "gpt-4o".to_string());
    let schema = json!({
      "type": "object",
      "additionalProperties": false,
      "required": ["work_blocks"],
      "properties": {
        "work_blocks": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "session_ids",
              "start_time",
              "end_time",
              "category",
              "mode",
              "planned_status",
              "project_name",
              "stakeholder_group",
              "evidence",
              "confidence",
              "blocker_flag",
              "notes"
            ],
            "properties": {
              "session_ids": {
                "type": "array",
                "minItems": 1,
                "items": { "type": "string" }
              },
              "start_time": { "type": "string" },
              "end_time": { "type": "string" },
              "category": {
                "type": "string",
                "enum": [
                  "Planned analysis / project work",
                  "Ad hoc stakeholder requests",
                  "Recurring reporting",
                  "Dashboard development / edits",
                  "SQL / data modeling / query work",
                  "QA / data validation",
                  "Debugging / issue investigation",
                  "Documentation / requirement clarification",
                  "Meetings / stakeholder syncs",
                  "Admin / coordination",
                  "Blocked / waiting / dependency delay"
                ]
              },
              "mode": {
                "type": "string",
                "enum": ["Deep work", "Reactive", "Collaborative", "Fragmented", "Blocked"]
              },
              "planned_status": {
                "type": "string",
                "enum": ["planned", "unplanned", "fixed", "blocked"]
              },
              "project_name": { "type": "string" },
              "stakeholder_group": { "type": "string" },
              "evidence": {
                "type": "array",
                "minItems": 2,
                "maxItems": 5,
                "items": { "type": "string" }
              },
              "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "blocker_flag": { "type": "boolean" },
              "notes": {
                "type": ["string", "null"]
              }
            }
          }
        }
      }
    });
    const INSTRUCTIONS: &str = "You classify local macOS active-window sessions into Weekform draft work blocks. Be conservative, evidence-based, prefer high-confidence only when signals are clear. Return only JSON matching the requested schema.";
    if codex_connection {
        let (output_text, model) = complete_with_codex_async(
            app,
            Some(model),
            INSTRUCTIONS.to_string(),
            request.prompt,
            json!({ "type": "json_schema", "schema": schema }),
            None,
        )
        .await?;
        let result = serde_json::from_str::<WorkBlockClassificationResult>(&output_text)
            .map_err(|error| format!("AI classification JSON could not be parsed: {error}"))?;
        return Ok(WorkBlockClassificationResponse { result, model });
    }
    let (api_key, base_url) = get_ai_credentials(request.ai_config.as_ref())?;
    let mut body = json!({
      "model": model,
      "store": false,
      "instructions": INSTRUCTIONS,
      "input": request.prompt,
      "text": {
        "format": {
          "type": "json_schema",
          "name": "weekform_work_block_classification",
          "strict": true,
          "schema": schema
        }
      }
    });
    with_reasoning_effort_if_supported(&mut body, &model);

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/responses", base_url))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("AI request failed: {error}"))?;
    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("AI response could not be read: {error}"))?;

    if !status.is_success() {
        let message = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("AI provider returned an error.");
        return Err(format!("{message} ({status})"));
    }

    let output_text = extract_response_text(&value)
        .ok_or_else(|| "AI response did not include generated text.".to_string())?;
    let result = serde_json::from_str::<WorkBlockClassificationResult>(&output_text)
        .map_err(|error| format!("AI classification JSON could not be parsed: {error}"))?;

    Ok(WorkBlockClassificationResponse { result, model })
}

#[tauri::command]
async fn generate_review_copilot_suggestions_with_openai(
    app: AppHandle,
    request: ReviewCopilotRequest,
) -> Result<ReviewCopilotResponse, String> {
    let codex_connection = uses_codex_app_server(request.ai_config.as_ref());
    let model = request
        .model
        .or_else(|| request.ai_config.as_ref().and_then(|c| c.model.clone()))
        .or_else(|| env::var("OPENAI_MODEL").ok())
        .unwrap_or_else(|| "gpt-4o".to_string());
    let nullable_taxonomy = |values: Vec<&str>| {
        json!({
          "anyOf": [
            { "type": "string", "enum": values },
            { "type": "null" }
          ]
        })
    };
    let schema = json!({
      "type": "object",
      "additionalProperties": false,
      "required": ["suggestions"],
      "properties": {
        "suggestions": {
          "type": "array",
          "maxItems": 8,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "action",
              "work_block_ids",
              "title",
              "rationale",
              "confidence",
              "proposed_category",
              "proposed_mode",
              "proposed_planned_status",
              "proposed_project_name",
              "proposed_stakeholder_group",
              "proposed_blocker_flag",
              "proposed_notes"
            ],
            "properties": {
              "action": {
                "type": "string",
                "enum": ["confirm", "relabel", "exclude", "merge", "split", "note"]
              },
              "work_block_ids": {
                "type": "array",
                "minItems": 1,
                "items": { "type": "string" }
              },
              "title": { "type": "string" },
              "rationale": { "type": "string" },
              "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "proposed_category": nullable_taxonomy(vec![
                "Planned analysis / project work",
                "Ad hoc stakeholder requests",
                "Recurring reporting",
                "Dashboard development / edits",
                "SQL / data modeling / query work",
                "QA / data validation",
                "Debugging / issue investigation",
                "Documentation / requirement clarification",
                "Meetings / stakeholder syncs",
                "Admin / coordination",
                "Blocked / waiting / dependency delay"
              ]),
              "proposed_mode": nullable_taxonomy(vec![
                "Deep work",
                "Reactive",
                "Collaborative",
                "Fragmented",
                "Blocked"
              ]),
              "proposed_planned_status": nullable_taxonomy(vec![
                "planned",
                "unplanned",
                "fixed",
                "blocked"
              ]),
              "proposed_project_name": {
                "type": ["string", "null"]
              },
              "proposed_stakeholder_group": {
                "type": ["string", "null"]
              },
              "proposed_blocker_flag": {
                "type": ["boolean", "null"]
              },
              "proposed_notes": {
                "type": ["string", "null"]
              }
            }
          }
        }
      }
    });
    const INSTRUCTIONS: &str = "You generate Weekform Daily Review Copilot suggestions. Be conservative, actionable, and return only JSON matching the requested schema.";
    if codex_connection {
        let (output_text, model) = complete_with_codex_async(
            app,
            Some(model),
            INSTRUCTIONS.to_string(),
            request.prompt,
            json!({ "type": "json_schema", "schema": schema }),
            None,
        )
        .await?;
        let result = serde_json::from_str::<ReviewCopilotResult>(&output_text)
            .map_err(|error| format!("AI review suggestions JSON could not be parsed: {error}"))?;
        return Ok(ReviewCopilotResponse { result, model });
    }
    let (api_key, base_url) = get_ai_credentials(request.ai_config.as_ref())?;
    let mut body = json!({
      "model": model,
      "store": false,
      "instructions": INSTRUCTIONS,
      "input": request.prompt,
      "text": {
        "format": {
          "type": "json_schema",
          "name": "weekform_review_copilot_suggestions",
          "strict": true,
          "schema": schema
        }
      }
    });
    with_reasoning_effort_if_supported(&mut body, &model);

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/responses", base_url))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("AI request failed: {error}"))?;
    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("AI response could not be read: {error}"))?;

    if !status.is_success() {
        let message = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("AI provider returned an error.");
        return Err(format!("{message} ({status})"));
    }

    let output_text = extract_response_text(&value)
        .ok_or_else(|| "AI response did not include generated text.".to_string())?;
    let result = serde_json::from_str::<ReviewCopilotResult>(&output_text)
        .map_err(|error| format!("AI review suggestions JSON could not be parsed: {error}"))?;

    Ok(ReviewCopilotResponse { result, model })
}

#[tauri::command]
async fn generate_forecast_agent_with_openai(
    app: AppHandle,
    request: ForecastAgentRequest,
) -> Result<ForecastAgentResponse, String> {
    let codex_connection = uses_codex_app_server(request.ai_config.as_ref());
    let model = request
        .model
        .or_else(|| request.ai_config.as_ref().and_then(|c| c.model.clone()))
        .or_else(|| env::var("OPENAI_MODEL").ok())
        .unwrap_or_else(|| "gpt-4o".to_string());
    let string_array = || {
        json!({
          "type": "array",
          "minItems": 2,
          "maxItems": 6,
          "items": { "type": "string" }
        })
    };
    let pct_number = || {
        json!({
          "type": "number",
          "minimum": 0,
          "maximum": 40
        })
    };
    let schema = json!({
      "type": "object",
      "additionalProperties": false,
      "required": [
        "forecast_week_label",
        "reliable_new_work_capacity_pct",
        "confidence",
        "headline",
        "summary_text",
        "key_constraints",
        "risk_flags",
        "recommended_actions",
        "assumptions",
        "optimistic_capacity_pct",
        "likely_capacity_pct",
        "conservative_capacity_pct"
      ],
      "properties": {
        "forecast_week_label": { "type": "string" },
        "reliable_new_work_capacity_pct": pct_number(),
        "confidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "headline": { "type": "string" },
        "summary_text": { "type": "string" },
        "key_constraints": string_array(),
        "risk_flags": string_array(),
        "recommended_actions": string_array(),
        "assumptions": string_array(),
        "optimistic_capacity_pct": pct_number(),
        "likely_capacity_pct": pct_number(),
        "conservative_capacity_pct": pct_number()
      }
    });
    const INSTRUCTIONS: &str = "You generate Weekform next-week capacity forecasts. Be conservative, explainable, planning-oriented, and return only JSON matching the requested schema.";
    if codex_connection {
        let (output_text, model) = complete_with_codex_async(
            app,
            Some(model),
            INSTRUCTIONS.to_string(),
            request.prompt,
            json!({ "type": "json_schema", "schema": schema }),
            None,
        )
        .await?;
        let forecast = serde_json::from_str::<ForecastAgentResult>(&output_text)
            .map_err(|error| format!("AI forecast JSON could not be parsed: {error}"))?;
        return Ok(ForecastAgentResponse { forecast, model });
    }
    let (api_key, base_url) = get_ai_credentials(request.ai_config.as_ref())?;
    let mut body = json!({
      "model": model,
      "store": false,
      "instructions": INSTRUCTIONS,
      "input": request.prompt,
      "text": {
        "format": {
          "type": "json_schema",
          "name": "weekform_forecast_agent",
          "strict": true,
          "schema": schema
        }
      }
    });
    with_reasoning_effort_if_supported(&mut body, &model);

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/responses", base_url))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("AI request failed: {error}"))?;
    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("AI response could not be read: {error}"))?;

    if !status.is_success() {
        let message = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("AI provider returned an error.");
        return Err(format!("{message} ({status})"));
    }

    let output_text = extract_response_text(&value)
        .ok_or_else(|| "AI response did not include generated text.".to_string())?;
    let forecast = serde_json::from_str::<ForecastAgentResult>(&output_text)
        .map_err(|error| format!("AI forecast JSON could not be parsed: {error}"))?;

    Ok(ForecastAgentResponse { forecast, model })
}

#[tauri::command]
async fn capture_visual_context_with_openai(
    app: AppHandle,
    request: VisualContextRequest,
) -> Result<VisualContextResponse, String> {
    let codex_connection = uses_codex_app_server(request.ai_config.as_ref());
    let model = request
        .model
        .or_else(|| {
            request
                .ai_config
                .as_ref()
                .and_then(|c| c.vision_model.clone())
        })
        .or_else(|| request.ai_config.as_ref().and_then(|c| c.model.clone()))
        .or_else(|| env::var("OPENAI_VISION_MODEL").ok())
        .or_else(|| env::var("OPENAI_MODEL").ok())
        .unwrap_or_else(|| "gpt-4o".to_string());
    let captured_at_ms = now_ms();
    let image_base64 = capture_screen_png_base64()?;
    let data_url = format!("data:image/png;base64,{image_base64}");
    let nullable_taxonomy = |values: Vec<&str>| {
        json!({
          "anyOf": [
            { "type": "string", "enum": values },
            { "type": "null" }
          ]
        })
    };
    let schema = json!({
      "type": "object",
      "additionalProperties": false,
      "required": [
        "activity_summary",
        "visible_tool",
        "likely_work_category",
        "likely_mode",
        "project_hint",
        "sensitive_content_detected",
        "confidence",
        "evidence"
      ],
      "properties": {
        "activity_summary": { "type": "string" },
        "visible_tool": { "type": ["string", "null"] },
        "likely_work_category": nullable_taxonomy(vec![
          "Planned analysis / project work",
          "Ad hoc stakeholder requests",
          "Recurring reporting",
          "Dashboard development / edits",
          "SQL / data modeling / query work",
          "QA / data validation",
          "Debugging / issue investigation",
          "Documentation / requirement clarification",
          "Meetings / stakeholder syncs",
          "Admin / coordination",
          "Blocked / waiting / dependency delay"
        ]),
        "likely_mode": nullable_taxonomy(vec![
          "Deep work",
          "Reactive",
          "Collaborative",
          "Fragmented",
          "Blocked"
        ]),
        "project_hint": { "type": ["string", "null"] },
        "sensitive_content_detected": { "type": "boolean" },
        "confidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "evidence": {
          "type": "array",
          "minItems": 2,
          "maxItems": 5,
          "items": { "type": "string" }
        }
      }
    });
    const INSTRUCTIONS: &str = "You generate privacy-conscious Weekform Visual Context insights from consented screenshots. Avoid transcribing sensitive details and return only JSON matching the requested schema.";
    if codex_connection {
        let (output_text, model) = complete_with_codex_async(
            app,
            Some(model),
            INSTRUCTIONS.to_string(),
            request.prompt,
            json!({ "type": "json_schema", "schema": schema }),
            Some(data_url),
        )
        .await?;
        let insight = serde_json::from_str::<VisualContextInsightOutput>(&output_text)
            .map_err(|error| format!("AI visual context JSON could not be parsed: {error}"))?;
        return Ok(VisualContextResponse {
            insight,
            model,
            captured_at_ms,
            app_name: request.app_name,
            window_title: request.window_title,
            session_id: request.session_id,
            raw_screenshot_retained: false,
        });
    }
    let (api_key, base_url) = get_ai_credentials(request.ai_config.as_ref())?;
    let mut body = json!({
      "model": model,
      "store": false,
      "instructions": INSTRUCTIONS,
      "input": [{
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": request.prompt
          },
          {
            "type": "input_image",
            "image_url": data_url,
            "detail": "low"
          }
        ]
      }],
      "text": {
        "format": {
          "type": "json_schema",
          "name": "weekform_visual_context",
          "strict": true,
          "schema": schema
        }
      }
    });
    with_reasoning_effort_if_supported(&mut body, &model);

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/responses", base_url))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("AI request failed: {error}"))?;
    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("AI response could not be read: {error}"))?;

    if !status.is_success() {
        let message = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("AI provider returned an error.");
        return Err(format!("{message} ({status})"));
    }

    let output_text = extract_response_text(&value)
        .ok_or_else(|| "AI response did not include generated text.".to_string())?;
    let insight = serde_json::from_str::<VisualContextInsightOutput>(&output_text)
        .map_err(|error| format!("AI visual context JSON could not be parsed: {error}"))?;

    Ok(VisualContextResponse {
        insight,
        model,
        captured_at_ms,
        app_name: request.app_name,
        window_title: request.window_title,
        session_id: request.session_id,
        raw_screenshot_retained: false,
    })
}

#[tauri::command]
async fn chat_with_agent(
    app: AppHandle,
    request: AgentChatRequest,
) -> Result<AgentChatResponse, String> {
    let codex_connection = uses_codex_app_server(request.ai_config.as_ref());
    let model = request
        .ai_config
        .as_ref()
        .and_then(|c| c.model.clone())
        .or_else(|| env::var("OPENAI_MODEL").ok())
        .unwrap_or_else(|| "gpt-4o".to_string());
    const INSTRUCTIONS: &str = "You are the Weekform Agent. Your focus is helping the user understand and explain their tracked capacity (reliable new-work %), current day/week workload (blocks, sessions, calendar, corrections), and primary focus/projects. Use only provided context and tool results. Be factual, concise, reference specific numbers/projects/times. If insufficient data say so.";
    if codex_connection {
        let (response, model) = complete_with_codex_async(
            app,
            Some(model),
            INSTRUCTIONS.to_string(),
            request.prompt,
            json!({ "type": "text" }),
            None,
        )
        .await?;
        return Ok(AgentChatResponse { response, model });
    }
    let (api_key, base_url) = get_ai_credentials(request.ai_config.as_ref())?;

    // Use text format for conversational agent (no json_schema).
    let body = json!({
      "model": model,
      "store": false,
      "instructions": INSTRUCTIONS,
      "input": request.prompt,
      "text": {
        "format": { "type": "text" }
      }
    });

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/responses", base_url))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("AI request failed: {error}"))?;
    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("AI response could not be read: {error}"))?;

    if !status.is_success() {
        let message = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("AI provider returned an error.");
        return Err(format!("{message} ({status})"));
    }

    let output_text = extract_response_text(&value)
        .ok_or_else(|| "AI response did not include generated text.".to_string())?;

    Ok(AgentChatResponse {
        response: output_text,
        model,
    })
}

/// Generic transport for every AI operation. Replaces the per-operation
/// *_with_openai commands: the frontend supplies instructions, the response
/// format/schema, and any sampling overrides, so prompt and schema tuning live
/// entirely in TypeScript (the improvement loop's safe scope).
#[tauri::command]
async fn ai_complete(
    app: AppHandle,
    request: AiCompleteRequest,
) -> Result<AiCompleteResponse, String> {
    let codex_connection = uses_codex_app_server(request.ai_config.as_ref());
    let vision_fallback = request.vision_model_fallback.unwrap_or(false);
    let model = request
        .model
        .or_else(|| request.ai_config.as_ref().and_then(|c| c.model.clone()))
        .or_else(|| {
            if vision_fallback {
                env::var("OPENAI_VISION_MODEL").ok()
            } else {
                None
            }
        })
        .or_else(|| env::var("OPENAI_MODEL").ok())
        .unwrap_or_else(|| "gpt-4o".to_string());

    let mut captured_at_ms: Option<u64> = None;
    let mut raw_screenshot_retained: Option<bool> = None;
    let mut image_data_url: Option<String> = None;
    let codex_prompt = request.prompt.clone();

    let input = if request.capture_screen.unwrap_or(false) {
        let timestamp = now_ms();
        let image_base64 = capture_screen_png_base64()?;
        let data_url = format!("data:image/png;base64,{image_base64}");
        image_data_url = Some(data_url.clone());
        captured_at_ms = Some(timestamp);
        raw_screenshot_retained = Some(false);
        json!([{
            "role": "user",
            "content": [
                { "type": "input_text", "text": request.prompt },
                { "type": "input_image", "image_url": data_url, "detail": "low" }
            ]
        }])
    } else {
        json!(request.prompt)
    };

    if codex_connection {
        let (output_text, model) = complete_with_codex_async(
            app,
            Some(model),
            request.instructions,
            codex_prompt,
            request.response_format,
            image_data_url,
        )
        .await?;
        return Ok(AiCompleteResponse {
            output_text,
            model,
            captured_at_ms,
            raw_screenshot_retained,
        });
    }
    let (api_key, base_url) = get_ai_credentials(request.ai_config.as_ref())?;

    let mut body = json!({
        "model": model,
        "store": false,
        "instructions": request.instructions,
        "input": input,
        "text": { "format": request.response_format }
    });

    if let Some(temperature) = request.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(top_p) = request.top_p {
        body["top_p"] = json!(top_p);
    }
    match request.reasoning_effort.as_deref() {
        Some(effort) => body["reasoning"] = json!({ "effort": effort }),
        None => with_reasoning_effort_if_supported(&mut body, &model),
    }

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/responses", base_url))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("AI request failed: {error}"))?;
    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("AI response could not be read: {error}"))?;

    if !status.is_success() {
        let message = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("AI provider returned an error.");
        return Err(format!("{message} ({status})"));
    }

    let output_text = extract_response_text(&value)
        .ok_or_else(|| "AI response did not include generated text.".to_string())?;

    Ok(AiCompleteResponse {
        output_text,
        model,
        captured_at_ms,
        raw_screenshot_retained,
    })
}

fn configure_tray(app: &tauri::App) -> tauri::Result<()> {
    let open_dashboard =
        MenuItem::with_id(app, "open-dashboard", "Open Dashboard", true, None::<&str>)?;
    let live_ledger =
        MenuItem::with_id(app, "live-ledger", "Live Work Ledger", true, None::<&str>)?;
    let daily_review = MenuItem::with_id(app, "daily-review", "Daily Review", true, None::<&str>)?;
    let weekly_capacity = MenuItem::with_id(
        app,
        "weekly-capacity",
        "Weekly Capacity",
        true,
        None::<&str>,
    )?;
    let manager_summary = MenuItem::with_id(
        app,
        "manager-summary",
        "Manager Summary",
        true,
        None::<&str>,
    )?;
    let audit_log = MenuItem::with_id(app, "audit-log", "Audit Log", true, None::<&str>)?;
    let copy_manager_summary = MenuItem::with_id(
        app,
        "copy-manager-summary",
        "Copy Manager Summary",
        true,
        None::<&str>,
    )?;
    let pause_tracking =
        MenuItem::with_id(app, "pause-tracking", "Pause Tracking", true, None::<&str>)?;
    let preferences = MenuItem::with_id(app, "preferences", "Settings", true, None::<&str>)?;
    let reset_review = MenuItem::with_id(
        app,
        "reset-review",
        "Reset Prototype Data",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit Weekform", true, None::<&str>)?;
    let separator_one = PredefinedMenuItem::separator(app)?;
    let separator_two = PredefinedMenuItem::separator(app)?;
    let separator_three = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open_dashboard,
            &live_ledger,
            &daily_review,
            &weekly_capacity,
            &manager_summary,
            &audit_log,
            &separator_one,
            &copy_manager_summary,
            &pause_tracking,
            &separator_two,
            &preferences,
            &reset_review,
            &separator_three,
            &quit,
        ],
    )?;
    let icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
    let pause_tracking_for_menu = pause_tracking.clone();
    app.manage(PauseMenuItem(pause_tracking.clone()));

    let tray = TrayIconBuilder::new()
        .tooltip("Weekform")
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if app.state::<DefaultOpenState>().compact.load(Ordering::SeqCst) {
                    show_quick_view(app);
                } else {
                    show_large_dashboard(app);
                }
            }
        })
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open-dashboard" => show_large_dashboard(app),
            "live-ledger" => navigate(app, "ledger"),
            "daily-review" => navigate(app, "daily"),
            "weekly-capacity" => navigate(app, "weekly"),
            "manager-summary" => navigate(app, "narrative"),
            "audit-log" => navigate(app, "audit"),
            "copy-manager-summary" => {
                dispatch_to_main_window(
                    app,
                    "window.dispatchEvent(new CustomEvent('clear-capacity:copy-manager-summary'))",
                );
            }
            "pause-tracking" => {
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = window.eval(
                        "window.dispatchEvent(new CustomEvent('clear-capacity:toggle-pause'))",
                    );
                }
                let current_text = pause_tracking_for_menu
                    .text()
                    .unwrap_or_else(|_| "Pause Tracking".to_string());
                let next_text = if current_text == "Pause Tracking" {
                    "Resume Tracking"
                } else {
                    "Pause Tracking"
                };
                let _ = pause_tracking_for_menu.set_text(next_text);
            }
            "preferences" => navigate(app, "setup"),
            "reset-review" => {
                dispatch_to_main_window(
                    app,
                    "window.dispatchEvent(new CustomEvent('clear-capacity:reset-local-data'))",
                );
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    app.manage(TrayHandle(tray));

    Ok(())
}

#[cfg(test)]
mod cloud_oauth_tests {
    use super::{build_cloud_oauth_authorize_url, parse_cloud_oauth_callback};

    #[test]
    fn authorize_url_is_scoped_to_supported_providers_and_pkce() {
        let url = build_cloud_oauth_authorize_url(
            "https://project.example.test",
            "google",
            "http://127.0.0.1:49321/cloud-auth/callback?state=state-1",
            "challenge-1",
        )
        .expect("valid authorize URL");

        assert!(url.starts_with("https://project.example.test/auth/v1/authorize?"));
        assert!(url.contains("provider=google"));
        assert!(url.contains("code_challenge=challenge-1"));
        assert!(url.contains("code_challenge_method=s256"));
        assert!(build_cloud_oauth_authorize_url(
            "https://project.example.test",
            "gitlab",
            "http://127.0.0.1:49321/cloud-auth/callback?state=state-1",
            "challenge-1",
        )
        .is_err());
    }

    #[test]
    fn callback_requires_the_exact_loopback_path_state_and_code() {
        assert_eq!(
            parse_cloud_oauth_callback(
                "/cloud-auth/callback?state=state-1&code=auth-code",
                "state-1",
            )
            .expect("valid callback"),
            "auth-code",
        );
        assert!(parse_cloud_oauth_callback(
            "/cloud-auth/callback?state=wrong&code=auth-code",
            "state-1",
        )
        .is_err());
        assert!(
            parse_cloud_oauth_callback("/other?state=state-1&code=auth-code", "state-1").is_err()
        );
    }
}

#[cfg(test)]
mod codex_app_server_tests {
    use super::{
        codex_output_schema, codex_thread_start_params, codex_turn_start_params,
        select_codex_model,
    };
    use serde_json::json;
    use std::path::Path;

    #[test]
    fn extracts_only_responses_json_schemas_for_codex_turns() {
        let schema = json!({
            "type": "json_schema",
            "name": "weekform_result",
            "strict": true,
            "schema": {
                "type": "object",
                "required": ["answer"],
                "properties": { "answer": { "type": "string" } }
            }
        });

        assert_eq!(
            codex_output_schema(&schema),
            Some(schema["schema"].clone())
        );
        assert_eq!(codex_output_schema(&json!({ "type": "text" })), None);
    }

    #[test]
    fn codex_threads_are_ephemeral_and_cannot_write_or_request_approval() {
        let params = codex_thread_start_params(
            "gpt-5.6-sol",
            Path::new("/tmp/weekform-codex-workspace"),
            "Return a bounded Weekform result.",
        );

        assert_eq!(params["ephemeral"], true);
        assert_eq!(params["approvalPolicy"], "never");
        assert_eq!(params["sandbox"], "read-only");
        assert_eq!(params["model"], "gpt-5.6-sol");
        assert_eq!(params["serviceName"], "weekform");
        assert!(params["baseInstructions"]
            .as_str()
            .expect("base instructions")
            .contains("Do not use tools"));
    }

    #[test]
    fn codex_turns_receive_the_existing_schema_and_optional_in_memory_image() {
        let params = codex_turn_start_params(
            "thread-1",
            "Summarize only this supplied context.",
            Some(json!({ "type": "object" })),
            Some("data:image/png;base64,c3ludGhldGlj"),
        );

        assert_eq!(params["threadId"], "thread-1");
        assert_eq!(params["outputSchema"], json!({ "type": "object" }));
        assert_eq!(params["input"][0]["type"], "text");
        assert_eq!(params["input"][1]["type"], "image");
        assert_eq!(
            params["input"][1]["url"],
            "data:image/png;base64,c3ludGhldGlj"
        );
    }

    #[test]
    fn model_selection_prefers_the_saved_model_then_the_catalog_default() {
        let models = json!({
            "data": [
                { "id": "gpt-5.4", "isDefault": false },
                { "id": "gpt-5.6-sol", "isDefault": true }
            ]
        });

        assert_eq!(
            select_codex_model(Some("gpt-5.4"), &models).expect("saved model"),
            "gpt-5.4"
        );
        assert_eq!(
            select_codex_model(Some("retired-model"), &models).expect("default model"),
            "gpt-5.6-sol"
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load local development configuration without overriding exported variables.
    let _ = dotenvy::dotenv();

    // Default to no collection until the frontend restores an explicit user choice.
    let activity_capture_paused = Arc::new(AtomicBool::new(true));

    tauri::Builder::default()
        .manage(ActivityCaptureState {
            paused: activity_capture_paused.clone(),
        })
        .manage(DefaultOpenState {
            compact: AtomicBool::new(false),
        })
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            set_pause_menu_label,
            set_tray_tooltip,
            set_activity_capture_paused,
            keychain_get_secret,
            keychain_set_secret,
            keychain_delete_secret,
            capture_journal_status,
            read_capture_journal,
            import_capture_journal_samples,
            prune_capture_journal,
            clear_capture_journal,
            generate_weekly_narrative_with_openai,
            classify_active_window_sessions_with_openai,
            generate_review_copilot_suggestions_with_openai,
            generate_forecast_agent_with_openai,
            capture_visual_context_with_openai,
            set_clear_capacity_window_mode,
            set_default_window_mode,
            get_env_ai_key_status,
            connect_codex_via_chatgpt,
            disconnect_codex,
            start_cloud_oauth,
            calendar_sources::calendar_source_statuses,
            calendar_sources::connect_calendar_source,
            calendar_sources::sync_calendar_source,
            calendar_sources::disconnect_calendar_source,
            present_main_window,
            chat_with_agent,
            ai_complete,
            test_ai_connection
        ])
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            configure_tray(app)?;
            start_activity_capture(app.handle().clone(), activity_capture_paused.clone());

            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.hide();
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Weekform");
}
