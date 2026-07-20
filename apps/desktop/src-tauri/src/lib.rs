use aes_gcm::{
    aead::{rand_core::RngCore, Aead, OsRng, Payload},
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
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
        Arc, Mutex,
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
use tauri_plugin_deep_link::DeepLinkExt;

mod calendar_sources;
mod chat_sources;

#[cfg(target_os = "macos")]
extern "C" {
    fn weekform_activate_app();
}

const MAIN_WINDOW_LABEL: &str = "main";
const COMPACT_WINDOW_WIDTH: u32 = 620;
const COMPACT_WINDOW_HEIGHT: u32 = 850;
const COMPACT_WINDOW_RIGHT_MARGIN: i32 = 16;
const COMPACT_WINDOW_TOP_OFFSET: i32 = 44;
const KEYCHAIN_SERVICE: &str = "com.weekform.desktop";
const CLOUD_SESSION_KEYCHAIN_ACCOUNT: &str = "weekform:cloud-session:v1";
const LEGACY_AI_PROVIDER_KEYCHAIN_ACCOUNT: &str = "weekform:ai-provider-api-key:v1";
const AI_PROVIDER_KEYCHAIN_ACCOUNT_PREFIX: &str = "weekform:ai-provider-api-key:v2:";
const CAPTURE_JOURNAL_KEY_ACCOUNT: &str = "weekform:capture-journal-key:v1";
const CAPTURE_JOURNAL_FILE: &str = "capture-journal-v1.jsonl";
const CAPTURE_JOURNAL_VERSION_V1: u8 = 1;
const CAPTURE_JOURNAL_VERSION_V2: u8 = 2;
const CAPTURE_JOURNAL_MAX_READ_LIMIT: usize = 10_000;
const CAPTURE_JOURNAL_TAIL_CHUNK_BYTES: u64 = 64 * 1024;
const CAPTURE_JOURNAL_MAX_RECORD_BYTES: usize = 1024 * 1024;
const CAPTURE_JOURNAL_SESSION_GAP_MS: u64 = 90_000;
const CAPTURE_JOURNAL_MAX_SESSION_LIMIT: usize = 10_000;
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
const AI_HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
// Finish the native provider request before the frontend's 60-second timeout.
// Tauri invoke promises do not provide transport cancellation, so this ordering
// is the hard guarantee that an abandoned UI promise cannot leave a paid HTTP
// request running while the user retries. The per-feature guards below provide
// a second, process-wide overlap boundary.
const AI_HTTP_READ_TIMEOUT: Duration = Duration::from_secs(50);
const AI_HTTP_TOTAL_TIMEOUT: Duration = Duration::from_secs(55);

static TEST_AI_CONNECTION_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static NARRATIVE_AI_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static CLASSIFICATION_AI_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static REVIEW_COPILOT_AI_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static FORECAST_AI_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static VISUAL_CONTEXT_AI_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static AGENT_CHAT_AI_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static AI_COMPLETE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

struct AiOperationGuard {
    flag: &'static AtomicBool,
}

impl Drop for AiOperationGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Release);
    }
}

fn start_ai_operation(
    flag: &'static AtomicBool,
    feature_label: &str,
) -> Result<AiOperationGuard, String> {
    flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| {
            format!(
                "{feature_label} is already running. Wait for that request to finish before trying again."
            )
        })?;
    Ok(AiOperationGuard { flag })
}

#[derive(Default)]
struct CaptureJournalOwner {
    operation_lock: Mutex<()>,
}

impl CaptureJournalOwner {
    fn with_operation<T>(
        &self,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let _guard = self.operation_lock.lock().map_err(|_| {
            "The capture journal is unavailable after an earlier operation failed.".to_string()
        })?;
        operation()
    }
}

static CAPTURE_JOURNAL_OWNER: CaptureJournalOwner = CaptureJournalOwner {
    operation_lock: Mutex::new(()),
};

fn build_ai_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(AI_HTTP_CONNECT_TIMEOUT)
        .read_timeout(AI_HTTP_READ_TIMEOUT)
        .timeout(AI_HTTP_TOTAL_TIMEOUT)
        .build()
        .map_err(|error| format!("Could not prepare the AI provider connection: {error}"))
}

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

#[derive(Clone, Deserialize, Serialize)]
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

#[derive(Debug, Serialize)]
struct ActivitySessionPayload {
    session_id: String,
    start_time: String,
    end_time: String,
    app_name: String,
    window_title: Option<String>,
    duration_minutes: u64,
    sample_count: usize,
    evidence: Vec<String>,
}

#[derive(Serialize)]
struct FullBackupExportResult {
    file_name: String,
    journal_record_count: usize,
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

#[cfg(target_os = "macos")]
fn activate_desktop_app() {
    // The app intentionally uses Accessory activation policy for its menu-bar
    // experience. Explicit activation is therefore required when a web deep
    // link asks an already-running instance to present its main window.
    unsafe { weekform_activate_app() };
}

#[cfg(not(target_os = "macos"))]
fn activate_desktop_app() {}

fn show_dashboard(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        activate_desktop_app();
        let _ = window.set_focus();
        return;
    }

    if let Ok(window) = WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::default())
        .title("Weekform")
        .inner_size(1280.0, 860.0)
        .min_inner_size(1024.0, 720.0)
        .visible(true)
        .build()
    {
        activate_desktop_app();
        let _ = window.set_focus();
    }
}

fn is_weekform_open_url(raw_url: &str) -> bool {
    raw_url == "weekform://open"
        || raw_url.starts_with("weekform://open?")
        || raw_url.starts_with("weekform://open/")
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

fn capture_journal_key_locked() -> Result<Vec<u8>, String> {
    match get_generic_password(KEYCHAIN_SERVICE, CAPTURE_JOURNAL_KEY_ACCOUNT) {
        Ok(key) if key.len() == 32 => Ok(key),
        Ok(_) => Err("Capture journal key has an invalid length.".to_string()),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => {
            let mut key = vec![0_u8; 32];
            OsRng.fill_bytes(&mut key);
            set_generic_password(KEYCHAIN_SERVICE, CAPTURE_JOURNAL_KEY_ACCOUNT, &key).map_err(
                |error| {
                    format!("Could not store the capture journal key in macOS Keychain: {error}")
                },
            )?;
            Ok(key)
        }
        Err(error) => Err(format!(
            "Could not read the capture journal key from macOS Keychain: {error}"
        )),
    }
}

fn existing_capture_journal_key_locked() -> Result<Vec<u8>, String> {
    match get_generic_password(KEYCHAIN_SERVICE, CAPTURE_JOURNAL_KEY_ACCOUNT) {
        Ok(key) if key.len() == 32 => Ok(key),
        Ok(_) => Err("Capture journal key has an invalid length.".to_string()),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Err(
            "The capture journal key is missing; existing encrypted history was left unchanged."
                .to_string(),
        ),
        Err(error) => Err(format!(
            "Could not unlock the encrypted capture journal: {error}"
        )),
    }
}

fn capture_journal_key_for_write_locked(path: &Path) -> Result<Vec<u8>, String> {
    if path.exists()
        && fs::metadata(path)
            .map_err(|error| format!("Could not inspect the capture journal: {error}"))?
            .len()
            > 0
    {
        existing_capture_journal_key_locked()
    } else {
        capture_journal_key_locked()
    }
}

fn encrypt_capture_payload_with_key(
    payload: &ActiveWindowPayload,
    key: &[u8],
    nonce_bytes: [u8; 12],
) -> Result<EncryptedJournalEntry, String> {
    encrypt_capture_payload_with_version(payload, key, nonce_bytes, CAPTURE_JOURNAL_VERSION_V2)
}

fn capture_journal_aad(version: u8, timestamp_ms: u64) -> Vec<u8> {
    let mut aad = b"weekform:capture-journal-entry".to_vec();
    aad.push(version);
    aad.extend_from_slice(&timestamp_ms.to_be_bytes());
    aad
}

fn encrypt_capture_payload_with_version(
    payload: &ActiveWindowPayload,
    key: &[u8],
    nonce_bytes: [u8; 12],
    version: u8,
) -> Result<EncryptedJournalEntry, String> {
    if !matches!(
        version,
        CAPTURE_JOURNAL_VERSION_V1 | CAPTURE_JOURNAL_VERSION_V2
    ) {
        return Err("Unsupported capture journal version.".to_string());
    }
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Could not initialize capture journal encryption.".to_string())?;
    let plaintext = serde_json::to_vec(payload)
        .map_err(|error| format!("Could not encode the capture journal entry: {error}"))?;
    let ciphertext = match version {
        CAPTURE_JOURNAL_VERSION_V1 => {
            cipher.encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_ref())
        }
        CAPTURE_JOURNAL_VERSION_V2 => {
            let aad = capture_journal_aad(version, payload.timestamp_ms);
            cipher.encrypt(
                Nonce::from_slice(&nonce_bytes),
                Payload {
                    msg: &plaintext,
                    aad: &aad,
                },
            )
        }
        _ => unreachable!("capture journal version was validated"),
    }
    .map_err(|_| "Could not encrypt the capture journal entry.".to_string())?;
    Ok(EncryptedJournalEntry {
        version,
        timestamp_ms: payload.timestamp_ms,
        nonce: general_purpose::STANDARD.encode(nonce_bytes),
        ciphertext: general_purpose::STANDARD.encode(ciphertext),
    })
}

fn decrypt_capture_payload(
    entry: &EncryptedJournalEntry,
    key: &[u8],
) -> Result<ActiveWindowPayload, String> {
    if !matches!(
        entry.version,
        CAPTURE_JOURNAL_VERSION_V1 | CAPTURE_JOURNAL_VERSION_V2
    ) {
        return Err("Unsupported capture journal version.".to_string());
    }
    let nonce = general_purpose::STANDARD
        .decode(&entry.nonce)
        .map_err(|_| "Capture journal nonce is invalid.".to_string())?;
    let ciphertext = general_purpose::STANDARD
        .decode(&entry.ciphertext)
        .map_err(|_| "Capture journal ciphertext is invalid.".to_string())?;
    if nonce.len() != 12 {
        return Err("Capture journal nonce has an invalid length.".to_string());
    }
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Could not initialize capture journal decryption.".to_string())?;
    let plaintext = match entry.version {
        CAPTURE_JOURNAL_VERSION_V1 => {
            cipher.decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        }
        CAPTURE_JOURNAL_VERSION_V2 => {
            let aad = capture_journal_aad(entry.version, entry.timestamp_ms);
            cipher.decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: &aad,
                },
            )
        }
        _ => unreachable!("capture journal version was validated"),
    }
    .map_err(|_| "Capture journal authentication failed; no entries were returned.".to_string())?;
    let payload: ActiveWindowPayload = serde_json::from_slice(&plaintext)
        .map_err(|_| "Capture journal entry could not be decoded.".to_string())?;
    if payload.timestamp_ms != entry.timestamp_ms {
        return Err(
            "Capture journal timestamp metadata does not match its authenticated payload."
                .to_string(),
        );
    }
    Ok(payload)
}

fn decode_capture_journal_record(
    record: &[u8],
    key: &[u8],
) -> Result<(EncryptedJournalEntry, ActiveWindowPayload), String> {
    let entry: EncryptedJournalEntry = serde_json::from_slice(record).map_err(|_| {
        "The encrypted capture journal is corrupt; no partial history was loaded.".to_string()
    })?;
    let payload = decrypt_capture_payload(&entry, key)?;
    Ok((entry, payload))
}

fn decrypt_capture_journal_record(
    record: &[u8],
    key: &[u8],
) -> Result<ActiveWindowPayload, String> {
    decode_capture_journal_record(record, key).map(|(_, payload)| payload)
}

fn rollback_capture_journal_append(
    file: &mut fs::File,
    original_len: u64,
    write_error: &std::io::Error,
) -> Result<(), String> {
    match file
        .set_len(original_len)
        .and_then(|_| file.sync_data())
    {
        Ok(()) => Err(format!(
            "Could not write the encrypted capture journal: {write_error}. The partial append was rolled back."
        )),
        Err(rollback_error) => Err(format!(
            "Could not write the encrypted capture journal: {write_error}. Rolling back the partial append also failed: {rollback_error}"
        )),
    }
}

fn durable_append_capture_journal_bytes(
    path: &Path,
    bytes: &[u8],
    injected_failure_after: Option<usize>,
) -> Result<(), String> {
    if bytes.is_empty() {
        return Ok(());
    }

    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("Could not open the encrypted capture journal: {error}"))?;
    let original_len = file
        .metadata()
        .map_err(|error| format!("Could not inspect the capture journal before append: {error}"))?
        .len();
    file.seek(SeekFrom::End(0))
        .map_err(|error| format!("Could not seek to the capture journal append point: {error}"))?;

    let write_result = (|| -> std::io::Result<()> {
        if let Some(failure_after) = injected_failure_after {
            let partial_len = failure_after.min(bytes.len());
            file.write_all(&bytes[..partial_len])?;
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "injected capture journal append failure",
            ));
        }
        file.write_all(bytes)?;
        file.flush()?;
        file.sync_data()
    })();

    match write_result {
        Ok(()) => Ok(()),
        Err(error) => rollback_capture_journal_append(&mut file, original_len, &error),
    }
}

fn recover_capture_journal_tail_locked(path: &Path, key: &[u8]) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let file_len = fs::metadata(path)
        .map_err(|error| format!("Could not inspect the capture journal tail: {error}"))?
        .len();
    if file_len == 0 {
        return Ok(());
    }

    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("Could not open the capture journal for recovery: {error}"))?;
    file.seek(SeekFrom::End(-1))
        .map_err(|error| format!("Could not inspect the final capture journal byte: {error}"))?;
    let mut final_byte = [0_u8; 1];
    file.read_exact(&mut final_byte)
        .map_err(|error| format!("Could not read the final capture journal byte: {error}"))?;
    if final_byte[0] == b'\n' {
        let mut tail = fs::File::open(path)
            .map_err(|error| format!("Could not validate the capture journal tail: {error}"))?;
        let final_records = read_capture_journal_tail_lines(&mut tail, 1)?;
        let final_record = final_records
            .last()
            .ok_or_else(|| "The capture journal contains an empty committed record.".to_string())?;
        if final_record.len() > CAPTURE_JOURNAL_MAX_RECORD_BYTES {
            return Err("A capture journal record exceeds the safe size limit.".to_string());
        }
        decrypt_capture_journal_record(final_record.as_bytes(), key)?;
        return Ok(());
    }

    // A missing newline means the last record was not durably committed. Validate
    // every complete record before it so recovery can never hide earlier damage.
    let mut reader =
        BufReader::new(file.try_clone().map_err(|error| {
            format!("Could not inspect the capture journal for recovery: {error}")
        })?);
    reader.seek(SeekFrom::Start(0)).map_err(|error| {
        format!("Could not seek through the capture journal for recovery: {error}")
    })?;
    let mut record = Vec::new();
    let mut complete_prefix_len = 0_u64;
    loop {
        record.clear();
        let bytes_read = reader
            .read_until(b'\n', &mut record)
            .map_err(|error| format!("Could not read the capture journal for recovery: {error}"))?;
        if bytes_read == 0 {
            break;
        }
        if record.last() == Some(&b'\n') {
            if record.len() - 1 > CAPTURE_JOURNAL_MAX_RECORD_BYTES {
                return Err("A capture journal record exceeds the safe size limit.".to_string());
            }
            decrypt_capture_journal_record(&record[..record.len() - 1], key)?;
            complete_prefix_len += bytes_read as u64;
            continue;
        }

        if record.len() <= CAPTURE_JOURNAL_MAX_RECORD_BYTES
            && decrypt_capture_journal_record(&record, key).is_ok()
        {
            durable_append_capture_journal_bytes(path, b"\n", None)?;
        } else {
            file.set_len(complete_prefix_len)
                .and_then(|_| file.sync_data())
                .map_err(|error| {
                    format!("Could not discard an incomplete final capture journal record: {error}")
                })?;
        }
        break;
    }
    Ok(())
}

fn append_capture_journal_payloads_locked(
    path: &Path,
    payloads: &[ActiveWindowPayload],
    key: &[u8],
) -> Result<(), String> {
    if payloads.is_empty() {
        return Ok(());
    }

    let mut encoded = String::new();
    for payload in payloads {
        let mut nonce_bytes = [0_u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let encrypted = encrypt_capture_payload_with_key(payload, key, nonce_bytes)?;
        let line = serde_json::to_string(&encrypted)
            .map_err(|error| format!("Could not encode the encrypted capture entry: {error}"))?;
        encoded.push_str(&line);
        encoded.push('\n');
    }

    durable_append_capture_journal_bytes(path, encoded.as_bytes(), None)
}

fn append_capture_journal(app: &AppHandle, payload: &ActiveWindowPayload) -> Result<(), String> {
    CAPTURE_JOURNAL_OWNER.with_operation(|| {
        let path = capture_journal_path(app)?;
        let key = capture_journal_key_for_write_locked(&path)?;
        recover_capture_journal_tail_locked(&path, &key)?;
        append_capture_journal_payloads_locked(&path, std::slice::from_ref(payload), &key)
    })
}

fn read_capture_journal_tail_lines<R: Read + Seek>(
    reader: &mut R,
    limit: usize,
) -> Result<Vec<String>, String> {
    if limit == 0 {
        return Ok(Vec::new());
    }

    let mut position = reader
        .seek(SeekFrom::End(0))
        .map_err(|error| format!("Could not inspect the capture journal tail: {error}"))?;
    if position == 0 {
        return Ok(Vec::new());
    }

    let mut chunks = Vec::new();
    let mut newline_count = 0_usize;
    while position > 0 && newline_count <= limit {
        let chunk_size = position.min(CAPTURE_JOURNAL_TAIL_CHUNK_BYTES) as usize;
        position -= chunk_size as u64;
        reader
            .seek(SeekFrom::Start(position))
            .map_err(|error| format!("Could not seek through the capture journal: {error}"))?;
        let mut chunk = vec![0_u8; chunk_size];
        reader
            .read_exact(&mut chunk)
            .map_err(|error| format!("Could not read the capture journal tail: {error}"))?;
        newline_count += chunk.iter().filter(|byte| **byte == b'\n').count();
        chunks.push(chunk);
    }

    chunks.reverse();
    let byte_count = chunks.iter().map(Vec::len).sum();
    let mut bytes = Vec::with_capacity(byte_count);
    for chunk in chunks {
        bytes.extend(chunk);
    }
    if position > 0 {
        let boundary = bytes
            .iter()
            .position(|byte| *byte == b'\n')
            .ok_or_else(|| "Could not locate a complete capture journal entry.".to_string())?;
        bytes.drain(..=boundary);
    }

    let text = String::from_utf8(bytes)
        .map_err(|_| "The encrypted capture journal contains invalid text.".to_string())?;
    let mut lines: Vec<String> = text.lines().rev().take(limit).map(str::to_string).collect();
    lines.reverse();
    Ok(lines)
}

fn decrypt_capture_journal_lines(
    lines: Vec<String>,
    key: &[u8],
) -> Result<Vec<ActiveWindowPayload>, String> {
    let mut samples = Vec::with_capacity(lines.len());
    for line in lines {
        samples.push(decrypt_capture_journal_record(line.as_bytes(), key)?);
    }
    Ok(samples)
}

fn visit_capture_journal_records(
    path: &Path,
    key: &[u8],
    mut visitor: impl FnMut(&str, &ActiveWindowPayload) -> Result<(), String>,
) -> Result<(), String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("Could not open the encrypted capture journal: {error}"))?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    loop {
        line.clear();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|error| format!("Could not read a capture journal entry: {error}"))?;
        if bytes_read == 0 {
            break;
        }
        if bytes_read > CAPTURE_JOURNAL_MAX_RECORD_BYTES {
            return Err("A capture journal record exceeds the safe size limit.".to_string());
        }
        if !line.ends_with('\n') {
            return Err(
                "The encrypted capture journal has an incomplete final record.".to_string(),
            );
        }
        let record = line.strip_suffix('\n').unwrap_or(&line);
        let payload = decrypt_capture_journal_record(record.as_bytes(), key)?;
        visitor(&line, &payload)?;
    }
    Ok(())
}

fn visit_capture_journal_records_reverse(
    path: &Path,
    key: &[u8],
    mut visitor: impl FnMut(&EncryptedJournalEntry, &ActiveWindowPayload) -> Result<bool, String>,
) -> Result<(), String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Could not open the encrypted capture journal: {error}"))?;
    let mut position = file
        .seek(SeekFrom::End(0))
        .map_err(|error| format!("Could not inspect the capture journal: {error}"))?;
    let mut carry = Vec::new();
    let mut first_chunk = true;

    while position > 0 {
        let chunk_size = position.min(CAPTURE_JOURNAL_TAIL_CHUNK_BYTES) as usize;
        position -= chunk_size as u64;
        file.seek(SeekFrom::Start(position))
            .map_err(|error| format!("Could not seek through the capture journal: {error}"))?;
        let mut combined = vec![0_u8; chunk_size];
        file.read_exact(&mut combined)
            .map_err(|error| format!("Could not read the capture journal: {error}"))?;
        combined.extend_from_slice(&carry);
        if combined.len()
            > CAPTURE_JOURNAL_TAIL_CHUNK_BYTES as usize + CAPTURE_JOURNAL_MAX_RECORD_BYTES
        {
            return Err("A capture journal record exceeds the safe size limit.".to_string());
        }

        let segments: Vec<&[u8]> = combined.split(|byte| *byte == b'\n').collect();
        let process_start = usize::from(position > 0);
        let next_carry = if position > 0 {
            segments.first().copied().unwrap_or_default().to_vec()
        } else {
            Vec::new()
        };

        for index in (process_start..segments.len()).rev() {
            let record = segments[index];
            if record.is_empty() && first_chunk && index == segments.len() - 1 {
                continue;
            }
            if record.is_empty() {
                return Err("The encrypted capture journal contains an empty record.".to_string());
            }
            if record.len() > CAPTURE_JOURNAL_MAX_RECORD_BYTES {
                return Err("A capture journal record exceeds the safe size limit.".to_string());
            }
            let (entry, payload) = decode_capture_journal_record(record, key)?;
            if !visitor(&entry, &payload)? {
                return Ok(());
            }
        }

        carry = next_carry;
        first_chunk = false;
    }
    Ok(())
}

fn capture_timestamp_iso(timestamp_ms: u64) -> Result<String, String> {
    let seconds = i64::try_from(timestamp_ms / 1_000)
        .map_err(|_| "Capture journal timestamp is outside the supported range.".to_string())?;
    let timestamp = time::OffsetDateTime::from_unix_timestamp(seconds)
        .map_err(|_| "Capture journal timestamp is outside the supported range.".to_string())?;
    let format = time::format_description::parse_borrowed::<3>(
        "[year]-[month]-[day]T[hour]:[minute]:[second]",
    )
    .map_err(|_| "Could not prepare the capture journal timestamp format.".to_string())?;
    let base = timestamp
        .format(&format)
        .map_err(|_| "Could not format a capture journal timestamp.".to_string())?;
    Ok(format!("{base}.{:03}Z", timestamp_ms % 1_000))
}

fn stable_session_hash(value: &str) -> String {
    let hash = value.encode_utf16().fold(5_381_u32, |hash, code_unit| {
        hash.wrapping_mul(33) ^ u32::from(code_unit)
    });
    let mut value = hash;
    let mut encoded = Vec::new();
    loop {
        let digit = (value % 36) as u8;
        encoded.push(if digit < 10 {
            b'0' + digit
        } else {
            b'a' + digit - 10
        });
        value /= 36;
        if value == 0 {
            break;
        }
    }
    encoded.reverse();
    String::from_utf8(encoded).expect("base36 hash is ASCII")
}

struct ActivitySessionAccumulator {
    start_ms: u64,
    end_ms: u64,
    app_name: String,
    window_title: Option<String>,
    sample_count: usize,
}

impl ActivitySessionAccumulator {
    fn from_sample(sample: &ActiveWindowPayload) -> Option<Self> {
        if sample.capture_error.is_some() || sample.app_name.is_none() {
            return None;
        }
        Some(Self {
            start_ms: sample.timestamp_ms,
            end_ms: sample.timestamp_ms,
            app_name: sample.app_name.clone().expect("app name was checked"),
            window_title: sample.window_title.clone(),
            sample_count: 1,
        })
    }

    fn can_prepend(&self, sample: &ActiveWindowPayload) -> bool {
        self.app_name == sample.app_name.as_deref().unwrap_or_default()
            && self.window_title.as_deref().unwrap_or_default()
                == sample.window_title.as_deref().unwrap_or_default()
            && self.start_ms.saturating_sub(sample.timestamp_ms) <= CAPTURE_JOURNAL_SESSION_GAP_MS
    }

    fn prepend(&mut self, sample: &ActiveWindowPayload) {
        self.start_ms = sample.timestamp_ms;
        self.sample_count += 1;
    }

    fn finish(self) -> Result<ActivitySessionPayload, String> {
        let start_time = capture_timestamp_iso(self.start_ms)?;
        let end_time = capture_timestamp_iso(self.end_ms)?;
        let title = self.window_title.clone().unwrap_or_default();
        let seed = format!("{}-{}-{start_time}", self.app_name, title);
        let duration_minutes =
            ((self.end_ms.saturating_sub(self.start_ms) + 30_000) / 60_000).max(1);
        let evidence = vec![
            format!("Observed {} as the active app", self.app_name),
            self.window_title
                .as_ref()
                .map(|title| format!("Front window title: {title}"))
                .unwrap_or_else(|| "Window title unavailable or redacted".to_string()),
            format!(
                "{} active-window samples grouped locally",
                self.sample_count
            ),
        ];
        Ok(ActivitySessionPayload {
            session_id: format!("session-{}", stable_session_hash(&seed)),
            start_time,
            end_time,
            app_name: self.app_name,
            window_title: self.window_title,
            duration_minutes,
            sample_count: self.sample_count,
            evidence,
        })
    }
}

fn read_capture_journal_sessions_from_path(
    path: &Path,
    key: &[u8],
    since_ms: u64,
    until_ms: u64,
    max_sessions: usize,
) -> Result<Vec<ActivitySessionPayload>, String> {
    if since_ms > until_ms {
        return Err("The capture journal session range is invalid.".to_string());
    }
    if max_sessions == 0 {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();
    let mut current: Option<ActivitySessionAccumulator> = None;
    let mut newer_timestamp: Option<u64> = None;
    visit_capture_journal_records_reverse(path, key, |_, sample| {
        if newer_timestamp.is_some_and(|newer| sample.timestamp_ms > newer) {
            return Err(
                "The capture journal is not in chronological order; bounded session reconstruction stopped."
                    .to_string(),
            );
        }
        newer_timestamp = Some(sample.timestamp_ms);

        if sample.timestamp_ms > until_ms {
            return Ok(true);
        }
        if sample.timestamp_ms < since_ms {
            return Ok(false);
        }
        let Some(next) = ActivitySessionAccumulator::from_sample(sample) else {
            return Ok(true);
        };
        if let Some(active) = current.as_mut() {
            if active.can_prepend(sample) {
                active.prepend(sample);
                return Ok(true);
            }
            let finished = current.take().expect("active session exists").finish()?;
            sessions.push(finished);
            if sessions.len() >= max_sessions {
                return Ok(false);
            }
        }
        current = Some(next);
        Ok(true)
    })?;

    if sessions.len() < max_sessions {
        if let Some(active) = current {
            sessions.push(active.finish()?);
        }
    }
    Ok(sessions)
}

fn read_capture_journal_locked(
    app: &AppHandle,
    limit: usize,
) -> Result<Vec<ActiveWindowPayload>, String> {
    let path = capture_journal_path(app)?;
    if !path.exists()
        || fs::metadata(&path)
            .map_err(|error| format!("Could not inspect the capture journal: {error}"))?
            .len()
            == 0
    {
        return Ok(Vec::new());
    }

    let key = existing_capture_journal_key_locked()?;
    recover_capture_journal_tail_locked(&path, &key)?;
    if limit == 0 {
        return Ok(Vec::new());
    }
    let mut file = fs::File::open(&path)
        .map_err(|error| format!("Could not open the encrypted capture journal: {error}"))?;
    let lines = read_capture_journal_tail_lines(&mut file, limit)?;
    decrypt_capture_journal_lines(lines, &key)
}

fn sync_capture_journal_directory(path: &Path) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "Could not resolve the capture journal directory.".to_string())?;
    fs::File::open(directory)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Could not sync the capture journal directory: {error}"))
}

fn prune_capture_journal_path_locked(
    path: &Path,
    key: &[u8],
    cutoff_ms: u64,
) -> Result<usize, String> {
    let replacement = path.with_extension("jsonl.next");
    let result = (|| {
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&replacement)
            .map_err(|error| format!("Could not prepare the retained capture journal: {error}"))?;
        let mut removed = 0_usize;
        visit_capture_journal_records(path, key, |line, payload| {
            if payload.timestamp_ms >= cutoff_ms {
                file.write_all(line.as_bytes()).map_err(|error| {
                    format!("Could not write retained capture entries: {error}")
                })?;
            } else {
                removed += 1;
            }
            Ok(())
        })?;
        file.flush()
            .map_err(|error| format!("Could not flush retained capture entries: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Could not sync retained capture entries: {error}"))?;
        drop(file);
        fs::rename(&replacement, path).map_err(|error| {
            format!("Could not replace the capture journal after retention: {error}")
        })?;
        sync_capture_journal_directory(path)?;
        Ok(removed)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&replacement);
    }
    result
}

fn valid_full_backup_file_name(file_name: &str) -> bool {
    const PREFIX: &str = "weekform-full-backup-";
    const SUFFIX: &str = ".json";
    let Some(stamp) = file_name
        .strip_prefix(PREFIX)
        .and_then(|value| value.strip_suffix(SUFFIX))
    else {
        return false;
    };
    if stamp.len() != 19 {
        return false;
    }
    stamp.bytes().enumerate().all(|(index, byte)| {
        if matches!(index, 4 | 7 | 10 | 13 | 16) {
            byte == b'-'
        } else {
            byte.is_ascii_digit()
        }
    }) && Path::new(file_name)
        .file_name()
        .is_some_and(|basename| basename == file_name)
}

fn backup_contains_secret_key(value: &Value) -> bool {
    const SECRET_KEYS: &[&str] = &[
        "apiKey",
        "api_key",
        "accessToken",
        "access_token",
        "refreshToken",
        "refresh_token",
        "authToken",
        "auth_token",
        "sessionToken",
        "session_token",
        "password",
        "secret",
    ];
    match value {
        Value::Array(values) => values.iter().any(backup_contains_secret_key),
        Value::Object(values) => values.iter().any(|(key, value)| {
            SECRET_KEYS.contains(&key.as_str()) || backup_contains_secret_key(value)
        }),
        _ => false,
    }
}

fn validate_native_backup_payload(backup: &Value) -> Result<(), String> {
    let object = backup
        .as_object()
        .ok_or_else(|| "The full backup payload must be a JSON object.".to_string())?;
    if object.contains_key("aiConfig") || object.contains_key("activeWindowSamples") {
        return Err(
            "The native full backup payload contains a field that must be exported separately."
                .to_string(),
        );
    }
    if backup_contains_secret_key(backup) {
        return Err("The full backup payload contains credential material.".to_string());
    }
    Ok(())
}

fn write_full_backup_with_journal(
    output_path: &Path,
    backup: &Value,
    journal: Option<(&Path, &[u8])>,
    exported_at: &str,
) -> Result<usize, String> {
    validate_native_backup_payload(backup)?;
    if output_path.exists() {
        return Err("A full backup with this name already exists.".to_string());
    }
    let file_name = output_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The full backup file name is invalid.".to_string())?;
    let partial = output_path.with_file_name(format!(".{file_name}.partial"));
    if partial.exists() {
        fs::remove_file(&partial)
            .map_err(|error| format!("Could not clear a stale partial backup: {error}"))?;
    }

    let mut renamed = false;
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&partial)
            .map_err(|error| format!("Could not prepare the full backup file: {error}"))?;
        file.write_all(b"{\"app\":\"Weekform\",\"kind\":\"full_backup\",\"exported_at\":")
            .map_err(|error| format!("Could not write the full backup: {error}"))?;
        serde_json::to_writer(&mut file, exported_at)
            .map_err(|error| format!("Could not encode the full backup timestamp: {error}"))?;
        file.write_all(b",\"data\":")
            .map_err(|error| format!("Could not write the full backup: {error}"))?;
        serde_json::to_writer(&mut file, backup)
            .map_err(|error| format!("Could not encode the full backup data: {error}"))?;
        file.write_all(b",\"activity_journal\":[")
            .map_err(|error| format!("Could not write the full backup: {error}"))?;

        let mut record_count = 0_usize;
        if let Some((journal_path, key)) = journal {
            visit_capture_journal_records(journal_path, key, |_, payload| {
                if record_count > 0 {
                    file.write_all(b",")
                        .map_err(|error| format!("Could not write the activity backup: {error}"))?;
                }
                serde_json::to_writer(&mut file, payload).map_err(|error| {
                    format!("Could not encode an activity backup record: {error}")
                })?;
                record_count += 1;
                Ok(())
            })?;
        }
        file.write_all(b"]}\n")
            .map_err(|error| format!("Could not finish the full backup: {error}"))?;
        file.flush()
            .map_err(|error| format!("Could not flush the full backup: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Could not sync the full backup: {error}"))?;
        drop(file);
        if output_path.exists() {
            return Err("A full backup with this name already exists.".to_string());
        }
        fs::rename(&partial, output_path)
            .map_err(|error| format!("Could not finalize the full backup: {error}"))?;
        renamed = true;
        let directory = output_path
            .parent()
            .ok_or_else(|| "Could not resolve the full backup directory.".to_string())?;
        fs::File::open(directory)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("Could not sync the full backup directory: {error}"))?;
        Ok(record_count)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&partial);
        if renamed {
            let _ = fs::remove_file(output_path);
            if let Some(directory) = output_path.parent() {
                let _ = fs::File::open(directory).and_then(|directory| directory.sync_all());
            }
        }
    }
    result
}

fn is_canonical_credential_binding(value: &str) -> bool {
    if value.len() != 36 {
        return false;
    }
    let bytes = value.as_bytes();
    for (index, byte) in bytes.iter().copied().enumerate() {
        if matches!(index, 8 | 13 | 18 | 23) {
            if byte != b'-' {
                return false;
            }
        } else if !(byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) {
            return false;
        }
    }
    matches!(bytes[14], b'1'..=b'8') && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
}

fn validate_webview_keychain_account(key: &str) -> Result<(), String> {
    let allowed = key == CLOUD_SESSION_KEYCHAIN_ACCOUNT
        || key == LEGACY_AI_PROVIDER_KEYCHAIN_ACCOUNT
        || key
            .strip_prefix(AI_PROVIDER_KEYCHAIN_ACCOUNT_PREFIX)
            .is_some_and(is_canonical_credential_binding);
    if allowed {
        Ok(())
    } else {
        Err("That Keychain account is not available to the Weekform webview.".to_string())
    }
}

#[tauri::command]
fn keychain_get_secret(key: String) -> Result<Option<String>, String> {
    validate_webview_keychain_account(&key)?;
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
    validate_webview_keychain_account(&key)?;
    set_generic_password(KEYCHAIN_SERVICE, &key, value.as_bytes())
        .map_err(|error| format!("Could not write to macOS Keychain: {error}"))
}

#[tauri::command]
fn keychain_delete_secret(key: String) -> Result<(), String> {
    validate_webview_keychain_account(&key)?;
    match delete_generic_password(KEYCHAIN_SERVICE, &key) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
        Err(error) => Err(format!("Could not delete from macOS Keychain: {error}")),
    }
}

#[tauri::command]
fn capture_journal_status(app: AppHandle) -> Result<CaptureJournalStatus, String> {
    CAPTURE_JOURNAL_OWNER.with_operation(|| {
        let path = capture_journal_path(&app)?;
        if !path.exists() {
            return Ok(CaptureJournalStatus {
                encrypted: true,
                entry_count: 0,
                byte_count: 0,
            });
        }
        if fs::metadata(&path)
            .map_err(|error| format!("Could not inspect the capture journal: {error}"))?
            .len()
            == 0
        {
            return Ok(CaptureJournalStatus {
                encrypted: true,
                entry_count: 0,
                byte_count: 0,
            });
        }
        let key = existing_capture_journal_key_locked()?;
        recover_capture_journal_tail_locked(&path, &key)?;
        let mut entry_count = 0_usize;
        visit_capture_journal_records(&path, &key, |_, _| {
            entry_count += 1;
            Ok(())
        })?;
        let byte_count = fs::metadata(&path)
            .map_err(|error| format!("Could not inspect the capture journal size: {error}"))?
            .len();
        Ok(CaptureJournalStatus {
            encrypted: true,
            entry_count,
            byte_count,
        })
    })
}

#[tauri::command]
fn read_capture_journal(app: AppHandle, limit: usize) -> Result<Vec<ActiveWindowPayload>, String> {
    CAPTURE_JOURNAL_OWNER.with_operation(|| {
        read_capture_journal_locked(&app, limit.min(CAPTURE_JOURNAL_MAX_READ_LIMIT))
    })
}

#[tauri::command]
fn read_capture_journal_sessions(
    app: AppHandle,
    since_ms: u64,
    until_ms: u64,
    max_sessions: usize,
) -> Result<Vec<ActivitySessionPayload>, String> {
    CAPTURE_JOURNAL_OWNER.with_operation(|| {
        let path = capture_journal_path(&app)?;
        if !path.exists()
            || fs::metadata(&path)
                .map_err(|error| format!("Could not inspect the capture journal: {error}"))?
                .len()
                == 0
        {
            return Ok(Vec::new());
        }
        let key = existing_capture_journal_key_locked()?;
        recover_capture_journal_tail_locked(&path, &key)?;
        read_capture_journal_sessions_from_path(
            &path,
            &key,
            since_ms,
            until_ms,
            max_sessions.min(CAPTURE_JOURNAL_MAX_SESSION_LIMIT),
        )
    })
}

#[tauri::command]
fn export_full_backup_with_journal(
    app: AppHandle,
    backup: Value,
    file_name: String,
) -> Result<FullBackupExportResult, String> {
    CAPTURE_JOURNAL_OWNER.with_operation(|| {
        if !valid_full_backup_file_name(&file_name) {
            return Err("The generated full backup file name is invalid.".to_string());
        }
        let output_path = app
            .path()
            .download_dir()
            .map_err(|error| format!("Could not resolve the Downloads directory: {error}"))?
            .join(&file_name);
        let journal_path = capture_journal_path(&app)?;
        let journal_key = if journal_path.exists()
            && fs::metadata(&journal_path)
                .map_err(|error| format!("Could not inspect the capture journal: {error}"))?
                .len()
                > 0
        {
            let key = existing_capture_journal_key_locked()?;
            recover_capture_journal_tail_locked(&journal_path, &key)?;
            Some(key)
        } else {
            None
        };
        let exported_at = capture_timestamp_iso(now_ms())?;
        let journal_record_count = write_full_backup_with_journal(
            &output_path,
            &backup,
            journal_key
                .as_deref()
                .map(|key| (journal_path.as_path(), key)),
            &exported_at,
        )?;
        Ok(FullBackupExportResult {
            file_name,
            journal_record_count,
        })
    })
}

#[tauri::command]
fn import_capture_journal_samples(
    app: AppHandle,
    samples: Vec<ActiveWindowPayload>,
) -> Result<usize, String> {
    CAPTURE_JOURNAL_OWNER.with_operation(|| {
        let path = capture_journal_path(&app)?;
        let existing_key = if path.exists()
            && fs::metadata(&path)
                .map_err(|error| format!("Could not inspect the capture journal: {error}"))?
                .len()
                > 0
        {
            Some(existing_capture_journal_key_locked()?)
        } else {
            None
        };
        let mut existing = HashSet::new();
        if let Some(key) = existing_key.as_deref() {
            recover_capture_journal_tail_locked(&path, key)?;
            visit_capture_journal_records(&path, key, |_, payload| {
                existing.insert(payload.sample_id.clone());
                Ok(())
            })?;
        }

        let mut accepted = Vec::new();
        for sample in samples {
            if sample.capture_error.is_some()
                || sample.app_name.is_none()
                || !existing.insert(sample.sample_id.clone())
            {
                continue;
            }
            accepted.push(sample);
        }
        if accepted.is_empty() {
            return Ok(0);
        }

        let key = match existing_key {
            Some(key) => key,
            None => capture_journal_key_for_write_locked(&path)?,
        };
        append_capture_journal_payloads_locked(&path, &accepted, &key)?;
        Ok(accepted.len())
    })
}

#[tauri::command]
fn prune_capture_journal(app: AppHandle, cutoff_ms: u64) -> Result<usize, String> {
    CAPTURE_JOURNAL_OWNER.with_operation(|| {
        let path = capture_journal_path(&app)?;
        if !path.exists() {
            return Ok(0);
        }
        if fs::metadata(&path)
            .map_err(|error| format!("Could not inspect the capture journal: {error}"))?
            .len()
            == 0
        {
            return Ok(0);
        }
        let key = existing_capture_journal_key_locked()?;
        recover_capture_journal_tail_locked(&path, &key)?;
        prune_capture_journal_path_locked(&path, &key, cutoff_ms)
    })
}

#[tauri::command]
fn clear_capture_journal(app: AppHandle) -> Result<(), String> {
    CAPTURE_JOURNAL_OWNER.with_operation(|| {
        let path = capture_journal_path(&app)?;
        let replacement = path.with_extension("jsonl.next");
        let mut removed_file = false;
        for candidate in [&path, &replacement] {
            if candidate.exists() {
                fs::remove_file(candidate)
                    .map_err(|error| format!("Could not clear the capture journal: {error}"))?;
                removed_file = true;
            }
        }
        if removed_file {
            sync_capture_journal_directory(&path)?;
        }
        match delete_generic_password(KEYCHAIN_SERVICE, CAPTURE_JOURNAL_KEY_ACCOUNT) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
            Err(error) => Err(format!(
                "Capture data was removed, but its Keychain key could not be removed: {error}"
            )),
        }
    })
}

#[cfg(test)]
mod capture_journal_tests {
    use super::*;
    use std::{
        io::Cursor,
        sync::{mpsc, Arc},
        time::Duration,
    };

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
        let entry = encrypt_capture_payload_with_key(&payload, &key, [9_u8; 12]).expect("encrypts");
        assert_eq!(entry.version, CAPTURE_JOURNAL_VERSION_V2);
        let serialized = serde_json::to_string(&entry).expect("serializes");
        assert!(!serialized.contains("Sensitive App"));
        assert!(!serialized.contains("Customer Alpha"));
        let decoded = decrypt_capture_payload(&entry, &key).expect("decrypts");
        assert_eq!(decoded.sample_id, payload.sample_id);
        assert_eq!(decoded.app_name, payload.app_name);
        assert_eq!(decoded.window_title, payload.window_title);
    }

    #[test]
    fn version_one_capture_entry_remains_readable_and_checks_inner_timestamp() {
        let payload = ActiveWindowPayload {
            sample_id: "sample-test".to_string(),
            timestamp_ms: 42,
            app_name: Some("App".to_string()),
            window_title: None,
            capture_error: None,
        };
        let key = [1_u8; 32];
        let mut entry = encrypt_capture_payload_with_version(
            &payload,
            &key,
            [2_u8; 12],
            CAPTURE_JOURNAL_VERSION_V1,
        )
        .expect("encrypts v1");

        assert_eq!(
            decrypt_capture_payload(&entry, &key)
                .expect("decrypts v1")
                .timestamp_ms,
            42
        );
        entry.timestamp_ms += 1;
        assert!(decrypt_capture_payload(&entry, &key).is_err());
    }

    #[test]
    fn version_two_authenticates_version_timestamp_and_ciphertext() {
        let payload = ActiveWindowPayload {
            sample_id: "sample-test".to_string(),
            timestamp_ms: 42,
            app_name: Some("App".to_string()),
            window_title: None,
            capture_error: None,
        };
        let key = [1_u8; 32];
        let entry =
            encrypt_capture_payload_with_key(&payload, &key, [2_u8; 12]).expect("encrypts v2");

        let mut timestamp_tamper = entry.clone();
        timestamp_tamper.timestamp_ms += 1;
        assert!(decrypt_capture_payload(&timestamp_tamper, &key).is_err());

        let mut version_tamper = entry.clone();
        version_tamper.version = CAPTURE_JOURNAL_VERSION_V1;
        assert!(decrypt_capture_payload(&version_tamper, &key).is_err());

        let mut ciphertext_tamper = entry;
        ciphertext_tamper.ciphertext.push('A');
        assert!(decrypt_capture_payload(&ciphertext_tamper, &key).is_err());
    }

    #[test]
    fn bounded_tail_reader_returns_only_the_newest_entries_in_order() {
        let mut journal = Cursor::new(b"first\nsecond\nthird\nfourth\n".to_vec());

        let lines = read_capture_journal_tail_lines(&mut journal, 2).expect("reads tail");

        assert_eq!(lines, vec!["third".to_string(), "fourth".to_string()]);
    }

    #[test]
    fn bounded_tail_reader_handles_zero_and_unterminated_final_lines() {
        let mut journal = Cursor::new(b"first\nsecond\nthird".to_vec());
        assert!(read_capture_journal_tail_lines(&mut journal, 0)
            .expect("reads empty tail")
            .is_empty());

        journal.set_position(0);
        let lines = read_capture_journal_tail_lines(&mut journal, 2).expect("reads tail");
        assert_eq!(lines, vec!["second".to_string(), "third".to_string()]);
    }

    #[test]
    fn bounded_tail_reader_seeks_across_chunk_boundaries() {
        let entries: Vec<String> = (0..4_000)
            .map(|index| format!("entry-{index:04}-{}", "x".repeat(24)))
            .collect();
        let mut journal = Cursor::new(format!("{}\n", entries.join("\n")).into_bytes());

        let lines = read_capture_journal_tail_lines(&mut journal, 3).expect("reads bounded tail");

        assert_eq!(lines, entries[entries.len() - 3..]);
    }

    #[test]
    fn capture_journal_owner_serializes_parallel_operations() {
        let owner = Arc::new(CaptureJournalOwner::default());
        let (first_entered_tx, first_entered_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let first_owner = Arc::clone(&owner);
        let first = thread::spawn(move || {
            first_owner
                .with_operation(|| {
                    first_entered_tx.send(()).expect("signals first entry");
                    release_first_rx.recv().expect("receives release");
                    Ok(())
                })
                .expect("first operation succeeds");
        });
        first_entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("first operation enters");

        let (second_entered_tx, second_entered_rx) = mpsc::channel();
        let second_owner = Arc::clone(&owner);
        let second = thread::spawn(move || {
            second_owner
                .with_operation(|| {
                    second_entered_tx.send(()).expect("signals second entry");
                    Ok(())
                })
                .expect("second operation succeeds");
        });

        assert!(second_entered_rx
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        release_first_tx.send(()).expect("releases first operation");
        second_entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("second operation enters after release");
        first.join().expect("first operation joins");
        second.join().expect("second operation joins");
    }

    fn temp_journal_path(label: &str) -> (PathBuf, PathBuf) {
        let mut random = [0_u8; 8];
        OsRng.fill_bytes(&mut random);
        let directory = env::temp_dir().join(format!(
            "weekform-capture-journal-test-{label}-{}-{}",
            std::process::id(),
            u64::from_be_bytes(random)
        ));
        fs::create_dir_all(&directory).expect("creates test directory");
        let path = directory.join("capture-journal-v1.jsonl");
        (directory, path)
    }

    fn encrypted_test_line(
        sample_id: &str,
        timestamp_ms: u64,
        key: &[u8],
        nonce_seed: u8,
    ) -> String {
        let payload = ActiveWindowPayload {
            sample_id: sample_id.to_string(),
            timestamp_ms,
            app_name: Some("Synthetic App".to_string()),
            window_title: Some("Synthetic title".to_string()),
            capture_error: None,
        };
        serde_json::to_string(
            &encrypt_capture_payload_with_key(&payload, key, [nonce_seed; 12])
                .expect("encrypts test entry"),
        )
        .expect("encodes test entry")
    }

    #[test]
    fn recovery_commits_a_valid_unterminated_final_record() {
        let (directory, path) = temp_journal_path("valid-tail");
        let key = [3_u8; 32];
        let line = encrypted_test_line("valid", 10, &key, 1);
        fs::write(&path, &line).expect("writes unterminated record");

        recover_capture_journal_tail_locked(&path, &key).expect("recovers valid tail");

        assert_eq!(
            fs::read_to_string(&path).expect("reads journal"),
            format!("{line}\n")
        );
        fs::remove_dir_all(directory).expect("removes test directory");
    }

    #[test]
    fn recovery_truncates_only_a_torn_final_record() {
        let (directory, path) = temp_journal_path("torn-tail");
        let key = [4_u8; 32];
        let valid = encrypted_test_line("valid", 10, &key, 1);
        let original = format!("{valid}\n{{\"version\":2,\"timestamp_ms\":11");
        fs::write(&path, original).expect("writes torn tail");

        recover_capture_journal_tail_locked(&path, &key).expect("truncates torn tail");

        assert_eq!(
            fs::read_to_string(&path).expect("reads journal"),
            format!("{valid}\n")
        );
        fs::remove_dir_all(directory).expect("removes test directory");
    }

    #[test]
    fn recovery_fails_closed_when_corruption_precedes_the_final_record() {
        let (directory, path) = temp_journal_path("interior-corruption");
        let key = [5_u8; 32];
        let valid = encrypted_test_line("valid", 10, &key, 1);
        let original = format!("{valid}\nnot-json\n{{\"torn\":true");
        fs::write(&path, &original).expect("writes corrupt journal");

        assert!(recover_capture_journal_tail_locked(&path, &key).is_err());
        assert_eq!(fs::read_to_string(&path).expect("reads journal"), original);
        fs::remove_dir_all(directory).expect("removes test directory");
    }

    #[test]
    fn append_failure_rolls_back_to_the_prior_file_length() {
        let (directory, path) = temp_journal_path("append-rollback");
        fs::write(&path, "existing\n").expect("writes existing journal");

        let error = durable_append_capture_journal_bytes(&path, b"new-record\n", Some(4))
            .expect_err("injected append fails");

        assert!(error.contains("rolled back"));
        assert_eq!(
            fs::read_to_string(&path).expect("reads journal"),
            "existing\n"
        );
        fs::remove_dir_all(directory).expect("removes test directory");
    }

    #[test]
    fn retention_streams_validated_records_and_uses_authenticated_timestamps() {
        let (directory, path) = temp_journal_path("streaming-prune");
        let key = [6_u8; 32];
        let mut file = fs::File::create(&path).expect("creates journal");
        for index in 0..2_000_u64 {
            let line =
                encrypted_test_line(&format!("sample-{index}"), index, &key, (index % 251) as u8);
            writeln!(file, "{line}").expect("writes test entry");
        }
        file.flush().expect("flushes journal");

        let removed =
            prune_capture_journal_path_locked(&path, &key, 1_500).expect("prunes journal");

        assert_eq!(removed, 1_500);
        let mut retained = Vec::new();
        visit_capture_journal_records(&path, &key, |_, payload| {
            retained.push(payload.timestamp_ms);
            Ok(())
        })
        .expect("validates retained records");
        assert_eq!(retained.len(), 500);
        assert_eq!(retained.first(), Some(&1_500));
        assert_eq!(retained.last(), Some(&1_999));
        assert!(!path.with_extension("jsonl.next").exists());
        fs::remove_dir_all(directory).expect("removes test directory");
    }

    #[test]
    fn retention_rejects_unknown_versions_without_rewriting_the_journal() {
        let (directory, path) = temp_journal_path("unknown-version");
        let key = [7_u8; 32];
        let line = encrypted_test_line("unknown", 10, &key, 1);
        let mut entry: EncryptedJournalEntry = serde_json::from_str(&line).expect("decodes entry");
        entry.version = 99;
        let original = format!(
            "{}\n",
            serde_json::to_string(&entry).expect("encodes entry")
        );
        fs::write(&path, &original).expect("writes unknown record");

        assert!(prune_capture_journal_path_locked(&path, &key, 0).is_err());

        assert_eq!(fs::read_to_string(&path).expect("reads journal"), original);
        assert!(!path.with_extension("jsonl.next").exists());
        fs::remove_dir_all(directory).expect("removes test directory");
    }

    #[test]
    fn native_session_window_matches_typescript_grouping_and_stable_id() {
        let (directory, path) = temp_journal_path("native-sessions");
        let key = [8_u8; 32];
        let lines = [
            encrypted_test_line("one", 1_000, &key, 1),
            encrypted_test_line("two", 61_000, &key, 2),
            encrypted_test_line("three", 151_001, &key, 3),
        ];
        fs::write(&path, format!("{}\n", lines.join("\n"))).expect("writes journal");

        let sessions = read_capture_journal_sessions_from_path(&path, &key, 0, 200_000, 10)
            .expect("reconstructs sessions");

        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].sample_count, 1);
        assert_eq!(sessions[1].session_id, "session-v99fx6");
        assert_eq!(sessions[1].start_time, "1970-01-01T00:00:01.000Z");
        assert_eq!(sessions[1].end_time, "1970-01-01T00:01:01.000Z");
        assert_eq!(sessions[1].duration_minutes, 1);
        assert_eq!(sessions[1].sample_count, 2);
        assert_eq!(
            sessions[1].evidence.last().map(String::as_str),
            Some("2 active-window samples grouped locally")
        );
        fs::remove_dir_all(directory).expect("removes test directory");
    }

    #[test]
    fn native_session_window_rejects_out_of_order_records() {
        let (directory, path) = temp_journal_path("out-of-order-sessions");
        let key = [9_u8; 32];
        let lines = [
            encrypted_test_line("one", 100, &key, 1),
            encrypted_test_line("two", 300, &key, 2),
            encrypted_test_line("three", 200, &key, 3),
        ];
        fs::write(&path, format!("{}\n", lines.join("\n"))).expect("writes journal");

        assert!(read_capture_journal_sessions_from_path(&path, &key, 0, 1_000, 10).is_err());
        fs::remove_dir_all(directory).expect("removes test directory");
    }

    #[test]
    fn full_backup_file_name_validation_rejects_paths_and_non_generated_names() {
        assert!(valid_full_backup_file_name(
            "weekform-full-backup-2026-07-20-12-34-56.json"
        ));
        assert!(!valid_full_backup_file_name(
            "../weekform-full-backup-2026-07-20-12-34-56.json"
        ));
        assert!(!valid_full_backup_file_name(
            "weekform-full-backup-today.json"
        ));
        assert!(!valid_full_backup_file_name(
            "weekform-full-backup-2026-07-20-12-34-56.json/extra"
        ));
    }

    #[test]
    fn full_backup_streams_the_complete_decrypted_journal_into_one_envelope() {
        let (directory, journal_path) = temp_journal_path("full-backup");
        let key = [10_u8; 32];
        let lines = [
            encrypted_test_line("one", 100, &key, 1),
            encrypted_test_line("two", 200, &key, 2),
        ];
        fs::write(&journal_path, format!("{}\n", lines.join("\n"))).expect("writes journal");
        let output_path = directory.join("weekform-full-backup-2026-07-20-12-34-56.json");
        let backup = json!({ "blocks": [{ "work_block_id": "block-1" }] });

        let count = write_full_backup_with_journal(
            &output_path,
            &backup,
            Some((&journal_path, &key)),
            "2026-07-20T12:34:56.000Z",
        )
        .expect("writes full backup");

        assert_eq!(count, 2);
        let envelope: Value =
            serde_json::from_slice(&fs::read(&output_path).expect("reads completed backup"))
                .expect("backup is valid JSON");
        assert_eq!(envelope["app"], "Weekform");
        assert_eq!(envelope["kind"], "full_backup");
        assert_eq!(envelope["data"], backup);
        assert_eq!(
            envelope["activity_journal"]
                .as_array()
                .expect("journal array")
                .len(),
            2
        );
        assert_eq!(
            envelope["activity_journal"][1]["window_title"],
            "Synthetic title"
        );
        assert!(!directory
            .join(".weekform-full-backup-2026-07-20-12-34-56.json.partial")
            .exists());
        fs::remove_dir_all(directory).expect("removes test directory");
    }

    #[test]
    fn failed_full_backup_removes_partial_and_final_files() {
        let (directory, journal_path) = temp_journal_path("failed-backup");
        let key = [11_u8; 32];
        let valid = encrypted_test_line("one", 100, &key, 1);
        fs::write(&journal_path, format!("{valid}\nnot-json\n")).expect("writes corrupt journal");
        let output_path = directory.join("weekform-full-backup-2026-07-20-12-34-57.json");

        assert!(write_full_backup_with_journal(
            &output_path,
            &json!({ "blocks": [] }),
            Some((&journal_path, &key)),
            "2026-07-20T12:34:57.000Z",
        )
        .is_err());

        assert!(!output_path.exists());
        assert!(!directory
            .join(".weekform-full-backup-2026-07-20-12-34-57.json.partial")
            .exists());
        fs::remove_dir_all(directory).expect("removes test directory");
    }

    #[test]
    fn full_backup_rejects_credential_fields_before_creating_a_file() {
        let (directory, journal_path) = temp_journal_path("secret-backup");
        let output_path = directory.join("weekform-full-backup-2026-07-20-12-34-58.json");

        assert!(write_full_backup_with_journal(
            &output_path,
            &json!({ "cloud": { "accessToken": "must-not-export" } }),
            None,
            "2026-07-20T12:34:58.000Z",
        )
        .is_err());

        assert!(!output_path.exists());
        assert!(!journal_path.exists());
        fs::remove_dir_all(directory).expect("removes test directory");
    }

    #[test]
    fn ai_http_client_has_a_bounded_timeout_policy() {
        assert!(AI_HTTP_CONNECT_TIMEOUT > Duration::ZERO);
        assert!(AI_HTTP_READ_TIMEOUT >= AI_HTTP_CONNECT_TIMEOUT);
        assert!(AI_HTTP_TOTAL_TIMEOUT >= AI_HTTP_READ_TIMEOUT);
        build_ai_http_client().expect("builds bounded AI client");
    }

    #[test]
    fn ai_operation_guard_rejects_overlap_and_releases_on_drop() {
        static TEST_FLAG: AtomicBool = AtomicBool::new(false);
        let first = start_ai_operation(&TEST_FLAG, "Synthetic generation").expect("starts");
        assert!(start_ai_operation(&TEST_FLAG, "Synthetic generation").is_err());
        drop(first);
        start_ai_operation(&TEST_FLAG, "Synthetic generation").expect("restarts after drop");
    }

    #[test]
    fn native_ai_paths_do_not_construct_unbounded_clients() {
        let source = include_str!("lib.rs");
        let unbounded_constructor = ["reqwest::Client", "::new()"].concat();

        assert!(!source.contains(&unbounded_constructor));
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
    open_state
        .compact
        .store(mode == "compact", Ordering::SeqCst);
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
    config.and_then(|value| value.connection_mode.as_deref()) == Some("codex")
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
        .or_else(|| {
            models
                .iter()
                .find(|entry| entry.get("hidden").and_then(Value::as_bool) != Some(true))
        })
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
    if account.pointer("/account/type").and_then(Value::as_str) != Some("chatgpt") {
        return Err(
            "Connect your ChatGPT/Codex plan in Weekform Settings before using AI features."
                .to_string(),
        );
    }
    let catalog = codex_model_catalog(&mut server)?;
    let model = select_codex_model(preferred_model, &catalog).ok_or_else(|| {
        "Your ChatGPT workspace did not return an available Codex model.".to_string()
    })?;
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
                if message.get("method").and_then(Value::as_str) != Some("account/login/completed")
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
        let model = select_codex_model(None, &catalog).ok_or_else(|| {
            "Your ChatGPT workspace did not return an available Codex model.".to_string()
        })?;
        Ok(CodexPlanConnectResult {
            model,
            plan_type,
            message:
                "Connected through the Codex app-server. No Platform API key was created or copied."
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
            fs::remove_dir_all(&codex_home).map_err(|error| {
                format!("Codex signed out, but its local cache could not be cleared: {error}")
            })?;
        }
        if workspace.exists() {
            fs::remove_dir_all(&workspace).map_err(|error| {
                format!("Codex signed out, but its private workspace could not be cleared: {error}")
            })?;
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
    let status_line = if status == 200 {
        "200 OK"
    } else {
        "404 Not Found"
    };
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
    let _operation = start_ai_operation(&TEST_AI_CONNECTION_IN_FLIGHT, "The AI connection test")?;
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
            select_codex_model(Some(&preferred_model), &catalog).ok_or_else(|| {
                "Your ChatGPT workspace did not return an available Codex model.".to_string()
            })
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
    let client = build_ai_http_client()?;
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
    let _operation = start_ai_operation(&NARRATIVE_AI_IN_FLIGHT, "Narrative generation")?;
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

    let client = build_ai_http_client()?;
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
    let _operation = start_ai_operation(&CLASSIFICATION_AI_IN_FLIGHT, "Work-block classification")?;
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

    let client = build_ai_http_client()?;
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
    let _operation = start_ai_operation(&REVIEW_COPILOT_AI_IN_FLIGHT, "Review Copilot generation")?;
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

    let client = build_ai_http_client()?;
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
    let _operation = start_ai_operation(&FORECAST_AI_IN_FLIGHT, "Forecast generation")?;
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

    let client = build_ai_http_client()?;
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
    let _operation = start_ai_operation(&VISUAL_CONTEXT_AI_IN_FLIGHT, "Visual Context generation")?;
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

    let client = build_ai_http_client()?;
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
    let _operation = start_ai_operation(&AGENT_CHAT_AI_IN_FLIGHT, "Agent chat")?;
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

    let client = build_ai_http_client()?;
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
    let _operation = start_ai_operation(&AI_COMPLETE_IN_FLIGHT, "AI generation")?;
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

    let client = build_ai_http_client()?;
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
                if app
                    .state::<DefaultOpenState>()
                    .compact
                    .load(Ordering::SeqCst)
                {
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
mod keychain_account_tests {
    use super::{
        keychain_delete_secret, keychain_get_secret, keychain_set_secret,
        validate_webview_keychain_account,
    };

    #[test]
    fn webview_keychain_commands_allow_only_owned_account_shapes() {
        assert!(validate_webview_keychain_account("weekform:cloud-session:v1").is_ok());
        assert!(validate_webview_keychain_account("weekform:ai-provider-api-key:v1").is_ok());
        assert!(validate_webview_keychain_account(
            "weekform:ai-provider-api-key:v2:6f986ff5-9391-4bc5-8a15-c4f616482f20"
        )
        .is_ok());
    }

    #[test]
    fn webview_keychain_commands_reject_arbitrary_and_malformed_accounts() {
        for account in [
            "arbitrary-account",
            "weekform:capture-journal-key:v1",
            "weekform:ai-provider-api-key:v2:../../cloud-session:v1",
            "weekform:ai-provider-api-key:v2:6f986ff5-9391-0bc5-8a15-c4f616482f20",
            "weekform:ai-provider-api-key:v2:6F986FF5-9391-4BC5-8A15-C4F616482F20",
            "weekform:ai-provider-api-key:v2:6f986ff5-9391-4bc5-8a15-c4f616482f20:extra",
            "weekform:cloud-session:v1\nother",
        ] {
            assert!(
                validate_webview_keychain_account(account).is_err(),
                "unexpectedly allowed {account:?}"
            );
        }

        assert!(keychain_get_secret("arbitrary-account".to_string()).is_err());
        assert!(keychain_set_secret(
            "arbitrary-account".to_string(),
            "synthetic-secret".to_string()
        )
        .is_err());
        assert!(keychain_delete_secret("arbitrary-account".to_string()).is_err());
    }
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
        codex_output_schema, codex_thread_start_params, codex_turn_start_params, select_codex_model,
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

        assert_eq!(codex_output_schema(&schema), Some(schema["schema"].clone()));
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

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|arg| is_weekform_open_url(arg)) {
                show_large_dashboard(app);
            }
        }));
    }

    builder
        .manage(ActivityCaptureState {
            paused: activity_capture_paused.clone(),
        })
        .manage(DefaultOpenState {
            compact: AtomicBool::new(false),
        })
        .plugin(tauri_plugin_deep_link::init())
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
            read_capture_journal_sessions,
            export_full_backup_with_journal,
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
            chat_sources::chat_source_statuses,
            chat_sources::connect_chat_source,
            chat_sources::sync_chat_source,
            chat_sources::disconnect_chat_source,
            chat_sources::clear_chat_source_storage,
            present_main_window,
            chat_with_agent,
            ai_complete,
            test_ai_connection
        ])
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let opened_from_web = app
                .deep_link()
                .get_current()?
                .is_some_and(|urls| urls.iter().any(|url| is_weekform_open_url(url.as_str())));
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                if event
                    .urls()
                    .iter()
                    .any(|url| is_weekform_open_url(url.as_str()))
                {
                    show_large_dashboard(&app_handle);
                }
            });

            configure_tray(app)?;
            start_activity_capture(app.handle().clone(), activity_capture_paused.clone());

            if opened_from_web {
                show_large_dashboard(app.handle());
            } else if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
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
