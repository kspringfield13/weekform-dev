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
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
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
    request: NarrativeGenerationRequest,
) -> Result<NarrativeGenerationResponse, String> {
    let (api_key, base_url) = get_ai_credentials(request.ai_config.as_ref())?;
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
    let mut body = json!({
      "model": model,
      "store": false,
      "instructions": "You generate Weekform weekly workload narratives from structured local work context. Keep summary_text and key_drivers concrete, explainable, and careful not to overstate certainty. Write manager_ready_summary as a polished first-person update in the user's own voice, focused on projects, tasks, progress, interruptions, blockers, and next steps. The manager-ready text must never mention confidence, evidence, tracking, classification, sessions, work blocks, models, estimates, app mechanics, review status, or technical capacity terminology. Return only JSON matching the requested schema. Adapt to any model capabilities.",
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
    request: WorkBlockClassificationRequest,
) -> Result<WorkBlockClassificationResponse, String> {
    let (api_key, base_url) = get_ai_credentials(request.ai_config.as_ref())?;
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
    let mut body = json!({
      "model": model,
      "store": false,
      "instructions": "You classify local macOS active-window sessions into Weekform draft work blocks. Be conservative, evidence-based, prefer high-confidence only when signals are clear. Return only JSON matching the requested schema.",
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
    request: ReviewCopilotRequest,
) -> Result<ReviewCopilotResponse, String> {
    let (api_key, base_url) = get_ai_credentials(request.ai_config.as_ref())?;
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
    let mut body = json!({
      "model": model,
      "store": false,
      "instructions": "You generate Weekform Daily Review Copilot suggestions. Be conservative, actionable, and return only JSON matching the requested schema.",
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
    request: ForecastAgentRequest,
) -> Result<ForecastAgentResponse, String> {
    let (api_key, base_url) = get_ai_credentials(request.ai_config.as_ref())?;
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
    let mut body = json!({
      "model": model,
      "store": false,
      "instructions": "You generate Weekform next-week capacity forecasts. Be conservative, explainable, planning-oriented, and return only JSON matching the requested schema.",
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
    request: VisualContextRequest,
) -> Result<VisualContextResponse, String> {
    let (api_key, base_url) = get_ai_credentials(request.ai_config.as_ref())?;
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
    let mut body = json!({
      "model": model,
      "store": false,
      "instructions": "You generate privacy-conscious Weekform Visual Context insights from consented screenshots. Avoid transcribing sensitive details and return only JSON matching the requested schema.",
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
async fn chat_with_agent(request: AgentChatRequest) -> Result<AgentChatResponse, String> {
    let (api_key, base_url) = get_ai_credentials(request.ai_config.as_ref())?;
    let model = request
        .ai_config
        .as_ref()
        .and_then(|c| c.model.clone())
        .or_else(|| env::var("OPENAI_MODEL").ok())
        .unwrap_or_else(|| "gpt-4o".to_string());

    // Use text format for conversational agent (no json_schema).
    let body = json!({
      "model": model,
      "store": false,
      "instructions": "You are the Weekform Agent. Your focus is helping the user understand and explain their tracked capacity (reliable new-work %), current day/week workload (blocks, sessions, calendar, corrections), and primary focus/projects. Use only provided context and tool results. Be factual, concise, reference specific numbers/projects/times. If insufficient data say so.",
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
async fn ai_complete(request: AiCompleteRequest) -> Result<AiCompleteResponse, String> {
    let (api_key, base_url) = get_ai_credentials(request.ai_config.as_ref())?;
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

    let input = if request.capture_screen.unwrap_or(false) {
        let timestamp = now_ms();
        let image_base64 = capture_screen_png_base64()?;
        let data_url = format!("data:image/png;base64,{image_base64}");
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
                show_quick_view(tray.app_handle());
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
