use base64::{engine::general_purpose, Engine as _};
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    env,
    io::{Read, Write},
    net::TcpListener,
    time::{Duration, Instant},
};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

const KEYCHAIN_SERVICE: &str = "com.weekform.desktop";
const HASH_SALT_KEY: &str = "weekform:chat:hash-salt:v1";
const OAUTH_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_RANGE_DAYS: i64 = 90;
const MAX_SURFACES_PER_SYNC: usize = 12;
const MAX_MESSAGE_PAGES_PER_SURFACE: usize = 3;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatProvider {
    Slack,
    GoogleChat,
    Webex,
}

impl ChatProvider {
    fn label(self) -> &'static str {
        match self {
            Self::Slack => "Slack",
            Self::GoogleChat => "Google Chat",
            Self::Webex => "Webex",
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::Slack => "slack",
            Self::GoogleChat => "google_chat",
            Self::Webex => "webex",
        }
    }

    fn token_key(self) -> &'static str {
        match self {
            Self::Slack => "weekform:chat:slack:token:v1",
            Self::GoogleChat => "weekform:chat:google-chat:token:v1",
            Self::Webex => "weekform:chat:webex:token:v1",
        }
    }

    fn cursor_key(self) -> &'static str {
        match self {
            Self::Slack => "weekform:chat:slack:cursor:v1",
            Self::GoogleChat => "weekform:chat:google-chat:cursor:v1",
            Self::Webex => "weekform:chat:webex:cursor:v1",
        }
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRangeRequest {
    provider: ChatProvider,
    start: String,
    end_exclusive: String,
}

impl ChatRangeRequest {
    fn validate(&self) -> Result<(), String> {
        let start = OffsetDateTime::parse(&self.start, &Rfc3339)
            .map_err(|_| "The chat start date is invalid.".to_string())?;
        let end = OffsetDateTime::parse(&self.end_exclusive, &Rfc3339)
            .map_err(|_| "The chat end date is invalid.".to_string())?;
        let duration = end - start;
        if duration.is_negative() || duration.is_zero() {
            return Err("The chat end date must be after the start date.".to_string());
        }
        if duration.whole_seconds() > MAX_RANGE_DAYS * 24 * 60 * 60 {
            return Err("Chat ranges are limited to 90 days.".to_string());
        }
        Ok(())
    }
}

#[derive(Clone)]
struct ProviderConfig {
    client_id: String,
    redirect_uri: Option<String>,
    broker_url: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct StoredChatToken {
    refresh_token: String,
    self_id: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
struct StoredChatCursor {
    range_key: String,
    provider_page_token: Option<String>,
    item_offset: usize,
    active_surface_id: Option<String>,
    surface_page_token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatConnectionStatus {
    provider: ChatProvider,
    available: bool,
    connected: bool,
    requires_broker: bool,
    detail: String,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
enum ChatSurface {
    Channel,
    Space,
    Dm,
    GroupDm,
    Thread,
    Call,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ChatDirection {
    Inbound,
    Outbound,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
enum AttentionSignal {
    SelfSent,
    SelfReaction,
    DirectMention,
    DirectMessage,
    ReplyToSelf,
    CallJoined,
    Ambient,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum AttentionGrade {
    Observed,
    Directed,
    Ambient,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeChatEvidenceEvent {
    schema_version: u8,
    event_id: String,
    provider: ChatProvider,
    timestamp: String,
    surface: ChatSurface,
    direction: ChatDirection,
    attention_signal: AttentionSignal,
    attention_grade: AttentionGrade,
    correlation_key: String,
    conversation_key: String,
    thread_key: Option<String>,
    participant_count_bucket: Option<String>,
    silent: bool,
    tombstone: bool,
    revision: String,
    imported_at: String,
    local_only: bool,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum SyncCoverage {
    Complete,
    ScopeLimited,
    Partial,
    RateLimited,
    PermissionLimited,
}

impl SyncCoverage {
    fn merge(self, other: Self) -> Self {
        use SyncCoverage::{Complete, Partial, PermissionLimited, RateLimited, ScopeLimited};
        match (self, other) {
            (PermissionLimited, _) | (_, PermissionLimited) => PermissionLimited,
            (RateLimited, _) | (_, RateLimited) => RateLimited,
            (Partial, _) | (_, Partial) => Partial,
            (ScopeLimited, _) | (_, ScopeLimited) => ScopeLimited,
            _ => Complete,
        }
    }

    fn detail(self) -> &'static str {
        match self {
            Self::Complete => "The requested provider range was read completely.",
            Self::ScopeLimited => {
                "Slack's currently listed top-level conversation history was read for this range. Thread replies and inaccessible history are outside this scope."
            }
            Self::Partial => {
                "Provider pagination or the bounded sync budget left partial coverage; sync again to continue."
            }
            Self::RateLimited => {
                "The provider rate-limited this request; retained events are partial and safe to reconcile."
            }
            Self::PermissionLimited => {
                "The provider did not grant every read required for this range; no broader access was attempted."
            }
        }
    }
}

fn authoritative_receipt_coverage(coverage: SyncCoverage, resumed: bool) -> SyncCoverage {
    if resumed {
        coverage.merge(SyncCoverage::Partial)
    } else {
        coverage
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSyncRange {
    start: String,
    end_exclusive: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSyncReceipt {
    provider: ChatProvider,
    range: ChatSyncRange,
    fetched_count: usize,
    normalized_count: usize,
    dropped_count: usize,
    coverage: SyncCoverage,
    detail: String,
    retry_after_seconds: Option<u64>,
    checkpoint: Option<String>,
    resumed: bool,
    has_more: bool,
    authority_eligible: bool,
    model_eligible: bool,
    completed_at: String,
    content_handling: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSyncResponse {
    events: Vec<NativeChatEvidenceEvent>,
    receipt: ChatSyncReceipt,
}

struct ProviderFetch {
    events: Vec<NativeChatEvidenceEvent>,
    fetched_count: usize,
    dropped_count: usize,
    coverage: SyncCoverage,
    retry_after_seconds: Option<u64>,
    continuation: Option<StoredChatCursor>,
    authority_eligible: bool,
    model_eligible: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatReceiptSemantics {
    resumed: bool,
    has_more: bool,
    authority_eligible: bool,
    model_eligible: bool,
}

fn receipt_semantics(fetch: &ProviderFetch, resumed: bool) -> ChatReceiptSemantics {
    ChatReceiptSemantics {
        resumed,
        has_more: fetch.continuation.is_some(),
        authority_eligible: fetch.authority_eligible
            && !matches!(
                fetch.coverage,
                SyncCoverage::RateLimited | SyncCoverage::PermissionLimited
            ),
        model_eligible: fetch.model_eligible,
    }
}

fn slack_rate_limit_model_eligible(
    current_eligible: bool,
    had_resume_cursor: bool,
    completed_page: bool,
) -> bool {
    current_eligible && (had_resume_cursor || completed_page)
}

fn configured_env(name: &str) -> Option<String> {
    let value = env::var(name).ok().or_else(|| match name {
        "SLACK_CHAT_CLIENT_ID" => option_env!("SLACK_CHAT_CLIENT_ID").map(str::to_string),
        "GOOGLE_CHAT_CLIENT_ID" => option_env!("GOOGLE_CHAT_CLIENT_ID").map(str::to_string),
        "WEBEX_CHAT_CLIENT_ID" => option_env!("WEBEX_CHAT_CLIENT_ID").map(str::to_string),
        "WEBEX_CHAT_REDIRECT_URI" => option_env!("WEBEX_CHAT_REDIRECT_URI").map(str::to_string),
        "WEEKFORM_CHAT_OAUTH_BROKER_URL" => {
            option_env!("WEEKFORM_CHAT_OAUTH_BROKER_URL").map(str::to_string)
        }
        "WEBEX_CHAT_BROKER_SECURITY_VERIFIED" => {
            option_env!("WEBEX_CHAT_BROKER_SECURITY_VERIFIED").map(str::to_string)
        }
        _ => None,
    });
    if name == "WEBEX_CHAT_BROKER_SECURITY_VERIFIED" {
        return value.filter(|value| !value.is_empty());
    }
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn validate_redirect_uri(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value)
        .map_err(|_| "The Webex chat redirect URI is invalid.".to_string())?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"));
    if url.scheme() != "http"
        || !loopback
        || url.port().is_none()
        || url.path() != "/chat-auth/callback"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "WEBEX_CHAT_REDIRECT_URI must be an exact loopback HTTP callback with a port and /chat-auth/callback path."
                .to_string(),
        );
    }
    Ok(url)
}

fn validate_broker_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value)
        .map_err(|_| "The Weekform Webex token broker URL is invalid.".to_string())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "WEEKFORM_CHAT_OAUTH_BROKER_URL must be a credential-free HTTPS URL.".to_string(),
        );
    }
    Ok(url)
}

fn validate_provider_config(
    provider: ChatProvider,
    read: &dyn Fn(&str) -> Option<String>,
) -> Result<ProviderConfig, String> {
    let client_variable = match provider {
        ChatProvider::Slack => "SLACK_CHAT_CLIENT_ID",
        ChatProvider::GoogleChat => "GOOGLE_CHAT_CLIENT_ID",
        ChatProvider::Webex => "WEBEX_CHAT_CLIENT_ID",
    };
    let client_id = read(client_variable)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "{} live sync is not configured in this build (missing {client_variable}).",
                provider.label()
            )
        })?;
    if provider != ChatProvider::Webex {
        return Ok(ProviderConfig {
            client_id,
            redirect_uri: None,
            broker_url: None,
        });
    }
    let redirect_uri = read("WEBEX_CHAT_REDIRECT_URI")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Webex chat requires WEBEX_CHAT_REDIRECT_URI.".to_string())?;
    validate_redirect_uri(&redirect_uri)?;
    let broker_url = read("WEEKFORM_CHAT_OAUTH_BROKER_URL")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Webex chat requires WEEKFORM_CHAT_OAUTH_BROKER_URL.".to_string())?;
    validate_broker_url(&broker_url)?;
    let broker_security_verified =
        read("WEBEX_CHAT_BROKER_SECURITY_VERIFIED").as_deref() == Some("true");
    if !broker_security_verified {
        return Err(
            "Webex chat remains unavailable until WEBEX_CHAT_BROKER_SECURITY_VERIFIED=true confirms the token broker security review."
                .to_string(),
        );
    }
    Ok(ProviderConfig {
        client_id,
        redirect_uri: Some(redirect_uri),
        broker_url: Some(broker_url),
    })
}

fn provider_config(provider: ChatProvider) -> Result<ProviderConfig, String> {
    validate_provider_config(provider, &configured_env)
}

fn keychain_read_json<T: for<'de> Deserialize<'de>>(account: &str) -> Result<Option<T>, String> {
    match get_generic_password(KEYCHAIN_SERVICE, account) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "Saved chat connection data in Keychain is invalid.".to_string()),
        Err(error) if error.code() == -25300 => Ok(None),
        Err(_) => Err("Could not read chat connection data from macOS Keychain.".to_string()),
    }
}

fn keychain_write_json<T: Serialize>(account: &str, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(value)
        .map_err(|_| "Chat connection data could not be encoded.".to_string())?;
    set_generic_password(KEYCHAIN_SERVICE, account, &bytes)
        .map_err(|_| "Could not save chat connection data in macOS Keychain.".to_string())
}

fn keychain_delete(account: &str) -> Result<(), String> {
    match delete_generic_password(KEYCHAIN_SERVICE, account) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == -25300 => Ok(()),
        Err(_) => Err("Could not remove chat connection data from macOS Keychain.".to_string()),
    }
}

fn token_read(provider: ChatProvider) -> Result<Option<StoredChatToken>, String> {
    keychain_read_json(provider.token_key())
}

fn token_write(provider: ChatProvider, token: &StoredChatToken) -> Result<(), String> {
    keychain_write_json(provider.token_key(), token)
}

fn cursor_read(provider: ChatProvider) -> Result<Option<StoredChatCursor>, String> {
    keychain_read_json(provider.cursor_key())
}

fn cursor_write(provider: ChatProvider, cursor: &StoredChatCursor) -> Result<(), String> {
    keychain_write_json(provider.cursor_key(), cursor)
}

fn random_urlsafe(length: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; length];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn hash_salt() -> Result<Vec<u8>, String> {
    match get_generic_password(KEYCHAIN_SERVICE, HASH_SALT_KEY) {
        Ok(bytes) if bytes.len() >= 32 => Ok(bytes),
        Ok(_) => Err("Saved chat hashing material in Keychain is invalid.".to_string()),
        Err(error) if error.code() == -25300 => {
            use rand::RngCore;
            let mut bytes = vec![0u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut bytes);
            set_generic_password(KEYCHAIN_SERVICE, HASH_SALT_KEY, &bytes).map_err(|_| {
                "Could not save chat hashing material in macOS Keychain.".to_string()
            })?;
            Ok(bytes)
        }
        Err(_) => Err("Could not read chat hashing material from macOS Keychain.".to_string()),
    }
}

fn keyed_digest(salt: &[u8], provider: ChatProvider, namespace: &str, raw_value: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(salt);
    digest.update([0]);
    digest.update(provider.key().as_bytes());
    digest.update([0]);
    digest.update(namespace.as_bytes());
    digest.update([0]);
    digest.update(raw_value.as_bytes());
    format!("{:x}", digest.finalize())
}

fn imported_at() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn canonical_datetime(value: &str) -> Option<String> {
    OffsetDateTime::parse(value, &Rfc3339)
        .ok()
        .and_then(|timestamp| timestamp.format(&Rfc3339).ok())
}

fn slack_datetime(value: &str) -> Option<String> {
    let (seconds, fraction) = value.split_once('.').unwrap_or((value, "0"));
    let seconds = seconds.parse::<i128>().ok()?;
    let mut nanos_text = fraction.chars().take(9).collect::<String>();
    while nanos_text.len() < 9 {
        nanos_text.push('0');
    }
    let nanos = nanos_text.parse::<i128>().ok()?;
    let timestamp =
        OffsetDateTime::from_unix_timestamp_nanos(seconds * 1_000_000_000 + nanos).ok()?;
    timestamp.format(&Rfc3339).ok()
}

fn participant_bucket(count: Option<u64>) -> Option<String> {
    count.and_then(|count| {
        Some(
            match count {
                0 => return None,
                1 => "1",
                2..=5 => "2-5",
                6..=20 => "6-20",
                _ => "21+",
            }
            .to_string(),
        )
    })
}

fn event_revision(
    salt: &[u8],
    provider: ChatProvider,
    raw_id: &str,
    revision_marker: &str,
) -> String {
    keyed_digest(
        salt,
        provider,
        "revision",
        &format!("{raw_id}\0{revision_marker}"),
    )
}

fn evidence_correlation_keys(
    salt: &[u8],
    provider: ChatProvider,
    raw_conversation_id: &str,
    raw_thread_id: Option<&str>,
) -> (String, Option<String>, String) {
    let conversation_key = keyed_digest(salt, provider, "conversation", raw_conversation_id);
    let thread_key = raw_thread_id.map(|value| keyed_digest(salt, provider, "thread", value));
    let correlation_key = thread_key.as_ref().unwrap_or(&conversation_key).to_string();
    (conversation_key, thread_key, correlation_key)
}

#[derive(Default)]
struct ChatPageProjection {
    events: Vec<NativeChatEvidenceEvent>,
    fetched_count: usize,
    ignored_count: usize,
    malformed_count: usize,
    collection_valid: bool,
}

impl ChatPageProjection {
    fn authority_coverage(&self) -> SyncCoverage {
        if self.collection_valid && self.malformed_count == 0 {
            SyncCoverage::Complete
        } else {
            SyncCoverage::Partial
        }
    }

    fn dropped_count(&self) -> usize {
        self.ignored_count + self.malformed_count
    }
}

fn collection_authority_coverage(value: &Value, field: &str) -> SyncCoverage {
    if value.get(field).and_then(Value::as_array).is_some() {
        SyncCoverage::Complete
    } else {
        SyncCoverage::Partial
    }
}

fn slack_message_is_intentionally_ignored(message: &Value) -> bool {
    let subtype = message.get("subtype").and_then(Value::as_str).unwrap_or("");
    if message.get("bot_id").is_some()
        || matches!(
            subtype,
            "bot_message"
                | "channel_join"
                | "channel_leave"
                | "channel_name"
                | "channel_purpose"
                | "channel_topic"
        )
    {
        return true;
    }
    let projected = if subtype == "message_changed" {
        message.get("message").unwrap_or(message)
    } else {
        message
    };
    projected.get("bot_id").is_some()
        || projected.get("subtype").and_then(Value::as_str) == Some("bot_message")
}

fn google_message_is_intentionally_ignored(message: &Value) -> bool {
    message
        .get("sender")
        .and_then(|sender| sender.get("type"))
        .and_then(Value::as_str)
        == Some("BOT")
}

fn normalize_slack_messages_with_count(
    value: &Value,
    raw_conversation_id: &str,
    raw_surface: &str,
    self_id: &str,
    salt: &[u8],
    participant_count: Option<u64>,
) -> Vec<NativeChatEvidenceEvent> {
    value
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|message| {
            let subtype = message.get("subtype").and_then(Value::as_str).unwrap_or("");
            if slack_message_is_intentionally_ignored(message) {
                return None;
            }
            let projected = if subtype == "message_changed" {
                message.get("message").unwrap_or(message)
            } else {
                message
            };
            let raw_id = projected
                .get("ts")
                .or_else(|| message.get("deleted_ts"))
                .and_then(Value::as_str)?;
            let occurred_at = slack_datetime(raw_id)?;
            let sender = projected.get("user").and_then(Value::as_str).unwrap_or("");
            let text = projected.get("text").and_then(Value::as_str).unwrap_or("");
            let tombstone = subtype == "message_deleted";
            let surface = match raw_surface {
                "dm" => ChatSurface::Dm,
                "group_dm" => ChatSurface::GroupDm,
                _ => ChatSurface::Channel,
            };
            let outbound = !sender.is_empty() && sender == self_id;
            let directly_mentioned = !self_id.is_empty() && text.contains(&format!("<@{self_id}>"));
            let (direction, attention_signal, attention_grade) = if outbound {
                (
                    ChatDirection::Outbound,
                    AttentionSignal::SelfSent,
                    AttentionGrade::Observed,
                )
            } else if surface == ChatSurface::Dm {
                (
                    ChatDirection::Inbound,
                    AttentionSignal::DirectMessage,
                    AttentionGrade::Directed,
                )
            } else if directly_mentioned {
                (
                    ChatDirection::Inbound,
                    AttentionSignal::DirectMention,
                    AttentionGrade::Directed,
                )
            } else {
                (
                    ChatDirection::Inbound,
                    AttentionSignal::Ambient,
                    AttentionGrade::Ambient,
                )
            };
            let raw_thread_id = projected.get("thread_ts").and_then(Value::as_str);
            let (conversation_key, thread_key, correlation_key) = evidence_correlation_keys(
                salt,
                ChatProvider::Slack,
                raw_conversation_id,
                raw_thread_id,
            );
            let revision_marker = projected
                .get("edited")
                .and_then(|value| value.get("ts"))
                .and_then(Value::as_str)
                .unwrap_or(subtype);
            Some(NativeChatEvidenceEvent {
                schema_version: 1,
                event_id: keyed_digest(salt, ChatProvider::Slack, "event", raw_id),
                provider: ChatProvider::Slack,
                timestamp: occurred_at,
                surface,
                direction,
                attention_signal,
                attention_grade,
                correlation_key,
                conversation_key,
                thread_key,
                participant_count_bucket: participant_bucket(participant_count),
                silent: false,
                tombstone,
                revision: event_revision(salt, ChatProvider::Slack, raw_id, revision_marker),
                imported_at: imported_at(),
                local_only: true,
            })
        })
        .collect()
}

fn project_slack_messages_with_count(
    value: &Value,
    raw_conversation_id: &str,
    raw_surface: &str,
    self_id: &str,
    salt: &[u8],
    participant_count: Option<u64>,
) -> ChatPageProjection {
    let Some(messages) = value.get("messages").and_then(Value::as_array) else {
        return ChatPageProjection::default();
    };
    let provider_ignored_count = messages
        .iter()
        .filter(|message| slack_message_is_intentionally_ignored(message))
        .count();
    let mut events = normalize_slack_messages_with_count(
        value,
        raw_conversation_id,
        raw_surface,
        self_id,
        salt,
        participant_count,
    );
    let ambient_count = events
        .iter()
        .filter(|event| event.attention_grade == AttentionGrade::Ambient)
        .count();
    events.retain(|event| event.attention_grade != AttentionGrade::Ambient);
    let ignored_count = provider_ignored_count + ambient_count;
    ChatPageProjection {
        fetched_count: messages.len(),
        malformed_count: messages.len().saturating_sub(ignored_count + events.len()),
        ignored_count,
        events,
        collection_valid: true,
    }
}

fn slack_history_next_cursor(history: &Value) -> Result<Option<String>, String> {
    let cursor = history
        .get("response_metadata")
        .and_then(|metadata| metadata.get("next_cursor"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let has_more = history.get("has_more").and_then(Value::as_bool) == Some(true);
    if has_more && cursor.is_none() {
        return Err("Slack reported more history without a continuation cursor.".to_string());
    }
    Ok(cursor)
}

#[cfg(test)]
fn normalize_slack_messages(
    value: &Value,
    raw_conversation_id: &str,
    raw_surface: &str,
    self_id: &str,
    salt: &[u8],
) -> Vec<NativeChatEvidenceEvent> {
    normalize_slack_messages_with_count(
        value,
        raw_conversation_id,
        raw_surface,
        self_id,
        salt,
        None,
    )
}

fn normalize_google_messages(
    value: &Value,
    raw_space_id: &str,
    raw_space_type: &str,
    self_id: &str,
    salt: &[u8],
) -> Vec<NativeChatEvidenceEvent> {
    value
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|message| {
            if google_message_is_intentionally_ignored(message) {
                return None;
            }
            let raw_id = message.get("name").and_then(Value::as_str)?;
            let occurred_at = message
                .get("createTime")
                .and_then(Value::as_str)
                .and_then(canonical_datetime)?;
            let sender = message
                .get("sender")
                .and_then(|sender| sender.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let outbound = !sender.is_empty() && sender == self_id;
            let directly_mentioned = message
                .get("annotations")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .any(|annotation| {
                    annotation
                        .get("userMention")
                        .and_then(|mention| mention.get("user"))
                        .and_then(|user| user.get("name"))
                        .and_then(Value::as_str)
                        == Some(self_id)
                });
            let surface = match raw_space_type {
                "DIRECT_MESSAGE" => ChatSurface::Dm,
                "GROUP_CHAT" => ChatSurface::GroupDm,
                _ => ChatSurface::Space,
            };
            let (direction, attention_signal, attention_grade) = if outbound {
                (
                    ChatDirection::Outbound,
                    AttentionSignal::SelfSent,
                    AttentionGrade::Observed,
                )
            } else if surface == ChatSurface::Dm {
                (
                    ChatDirection::Inbound,
                    AttentionSignal::DirectMessage,
                    AttentionGrade::Directed,
                )
            } else if directly_mentioned {
                (
                    ChatDirection::Inbound,
                    AttentionSignal::DirectMention,
                    AttentionGrade::Directed,
                )
            } else {
                (
                    ChatDirection::Inbound,
                    AttentionSignal::Ambient,
                    AttentionGrade::Ambient,
                )
            };
            let raw_thread_id = message
                .get("thread")
                .and_then(|thread| thread.get("name"))
                .and_then(Value::as_str);
            let (conversation_key, thread_key, correlation_key) = evidence_correlation_keys(
                salt,
                ChatProvider::GoogleChat,
                raw_space_id,
                raw_thread_id,
            );
            let tombstone = message.get("deleteTime").is_some();
            let revision_marker = message
                .get("lastUpdateTime")
                .and_then(Value::as_str)
                .unwrap_or(if tombstone { "deleted" } else { "created" });
            Some(NativeChatEvidenceEvent {
                schema_version: 1,
                event_id: keyed_digest(salt, ChatProvider::GoogleChat, "event", raw_id),
                provider: ChatProvider::GoogleChat,
                timestamp: occurred_at,
                surface,
                direction,
                attention_signal,
                attention_grade,
                correlation_key,
                conversation_key,
                thread_key,
                participant_count_bucket: None,
                silent: message
                    .get("silent")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                tombstone,
                revision: event_revision(salt, ChatProvider::GoogleChat, raw_id, revision_marker),
                imported_at: imported_at(),
                local_only: true,
            })
        })
        .collect()
}

fn project_google_messages(
    value: &Value,
    raw_space_id: &str,
    raw_space_type: &str,
    self_id: &str,
    salt: &[u8],
) -> ChatPageProjection {
    let Some(response) = value.as_object() else {
        return ChatPageProjection::default();
    };
    let messages = match response.get("messages") {
        Some(Value::Array(messages)) => messages,
        Some(_) => return ChatPageProjection::default(),
        None => {
            return ChatPageProjection {
                collection_valid: true,
                ..ChatPageProjection::default()
            };
        }
    };
    let provider_ignored_count = messages
        .iter()
        .filter(|message| google_message_is_intentionally_ignored(message))
        .count();
    let mut events = normalize_google_messages(value, raw_space_id, raw_space_type, self_id, salt);
    let ambient_count = events
        .iter()
        .filter(|event| event.attention_grade == AttentionGrade::Ambient)
        .count();
    events.retain(|event| event.attention_grade != AttentionGrade::Ambient);
    let ignored_count = provider_ignored_count + ambient_count;
    ChatPageProjection {
        fetched_count: messages.len(),
        malformed_count: messages.len().saturating_sub(ignored_count + events.len()),
        ignored_count,
        events,
        collection_valid: true,
    }
}

fn normalize_webex_messages(
    value: &Value,
    raw_room_id: &str,
    raw_room_type: &str,
    self_id: &str,
    salt: &[u8],
) -> Vec<NativeChatEvidenceEvent> {
    value
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|message| {
            let raw_id = message.get("id").and_then(Value::as_str)?;
            let occurred_at = message
                .get("created")
                .and_then(Value::as_str)
                .and_then(canonical_datetime)?;
            let sender = message
                .get("personId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let outbound = !sender.is_empty() && sender == self_id;
            let directly_mentioned = message
                .get("mentionedPeople")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .any(|person| person == self_id || person == "me");
            let surface = if raw_room_type == "direct" {
                ChatSurface::Dm
            } else {
                ChatSurface::Space
            };
            let (direction, attention_signal, attention_grade) = if outbound {
                (
                    ChatDirection::Outbound,
                    AttentionSignal::SelfSent,
                    AttentionGrade::Observed,
                )
            } else if surface == ChatSurface::Dm {
                (
                    ChatDirection::Inbound,
                    AttentionSignal::DirectMessage,
                    AttentionGrade::Directed,
                )
            } else if directly_mentioned {
                (
                    ChatDirection::Inbound,
                    AttentionSignal::DirectMention,
                    AttentionGrade::Directed,
                )
            } else {
                (
                    ChatDirection::Inbound,
                    AttentionSignal::Ambient,
                    AttentionGrade::Ambient,
                )
            };
            let raw_thread_id = message.get("parentId").and_then(Value::as_str);
            let (conversation_key, thread_key, correlation_key) =
                evidence_correlation_keys(salt, ChatProvider::Webex, raw_room_id, raw_thread_id);
            Some(NativeChatEvidenceEvent {
                schema_version: 1,
                event_id: keyed_digest(salt, ChatProvider::Webex, "event", raw_id),
                provider: ChatProvider::Webex,
                timestamp: occurred_at,
                surface,
                direction,
                attention_signal,
                attention_grade,
                correlation_key,
                conversation_key,
                thread_key,
                participant_count_bucket: None,
                silent: false,
                tombstone: false,
                revision: event_revision(salt, ChatProvider::Webex, raw_id, "created"),
                imported_at: imported_at(),
                local_only: true,
            })
        })
        .collect()
}

fn project_webex_messages(
    value: &Value,
    raw_room_id: &str,
    raw_room_type: &str,
    self_id: &str,
    salt: &[u8],
) -> ChatPageProjection {
    let Some(messages) = value.get("items").and_then(Value::as_array) else {
        return ChatPageProjection::default();
    };
    let mut events = normalize_webex_messages(value, raw_room_id, raw_room_type, self_id, salt);
    let ignored_count = events
        .iter()
        .filter(|event| event.attention_grade == AttentionGrade::Ambient)
        .count();
    events.retain(|event| event.attention_grade != AttentionGrade::Ambient);
    ChatPageProjection {
        fetched_count: messages.len(),
        malformed_count: messages.len().saturating_sub(ignored_count + events.len()),
        ignored_count,
        events,
        collection_valid: true,
    }
}

fn oauth_reply(stream: &mut std::net::TcpStream, message: &str) {
    let body = format!("<!doctype html><meta charset=utf-8><title>Weekform</title><body style='display:grid;place-items:center;height:100vh;font:16px -apple-system;margin:0;background:#151514;color:#f4f3ef'><p>{message}</p></body>");
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
}

fn wait_for_callback(
    listener: TcpListener,
    expected_state: &str,
    expected_path: &str,
) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|_| "Could not prepare chat sign-in.".to_string())?;
    let deadline = Instant::now() + OAUTH_TIMEOUT;
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let mut buffer = [0u8; 8192];
                let size = stream.read(&mut buffer).unwrap_or(0);
                let request = String::from_utf8_lossy(&buffer[..size]);
                let target = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("");
                let url = reqwest::Url::parse(&format!("http://127.0.0.1{target}"))
                    .map_err(|_| "The chat sign-in response was malformed.".to_string())?;
                if url.path() != expected_path {
                    oauth_reply(&mut stream, "This is not a Weekform chat callback.");
                    continue;
                }
                let mut code = None;
                let mut state = None;
                let mut denied = false;
                for (key, value) in url.query_pairs() {
                    match key.as_ref() {
                        "code" => code = Some(value.into_owned()),
                        "state" => state = Some(value.into_owned()),
                        "error" | "error_description" => denied = true,
                        _ => {}
                    }
                }
                if state.as_deref() != Some(expected_state) {
                    oauth_reply(&mut stream, "This chat response could not be verified.");
                    // Another local process can probe a loopback listener. An
                    // unverified callback must not cancel the user's real flow.
                    continue;
                }
                if denied {
                    oauth_reply(
                        &mut stream,
                        "Chat access was not connected. Return to Weekform to try again.",
                    );
                    return Err("Chat access was not granted.".to_string());
                }
                let code = code.ok_or_else(|| {
                    "The chat sign-in response did not include an authorization code.".to_string()
                })?;
                oauth_reply(
                    &mut stream,
                    "Chat connected. Close this tab and return to Weekform.",
                );
                return Ok(code);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err(
                        "Timed out waiting for chat sign-in. Try Connect again.".to_string()
                    );
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(_) => return Err("The chat sign-in listener failed.".to_string()),
        }
    }
}

fn callback_listener(
    provider: ChatProvider,
    config: &ProviderConfig,
) -> Result<(TcpListener, String), String> {
    if provider == ChatProvider::Webex {
        let redirect = config
            .redirect_uri
            .as_deref()
            .ok_or_else(|| "The Webex redirect is not configured.".to_string())?;
        let url = validate_redirect_uri(redirect)?;
        let port = url
            .port()
            .ok_or_else(|| "The Webex redirect port is missing.".to_string())?;
        let listener = TcpListener::bind(("127.0.0.1", port))
            .map_err(|_| "Could not start the configured Webex sign-in callback.".to_string())?;
        return Ok((listener, redirect.to_string()));
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| "Could not start chat sign-in.".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "Could not inspect the chat sign-in listener.".to_string())?
        .port();
    let host = if provider == ChatProvider::Slack {
        "localhost"
    } else {
        "127.0.0.1"
    };
    Ok((listener, format!("http://{host}:{port}/chat-auth/callback")))
}

fn broker_endpoint(base: &str) -> Result<reqwest::Url, String> {
    let mut url = validate_broker_url(base)?;
    let path = format!("{}/oauth/webex/token", url.path().trim_end_matches('/'));
    url.set_path(&path);
    Ok(url)
}

fn jwt_subject(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = general_purpose::URL_SAFE_NO_PAD.decode(payload).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    value.get("sub").and_then(Value::as_str).map(str::to_string)
}

fn response_value(value: &Value, camel: &str, snake: &str) -> Option<String> {
    value
        .get(camel)
        .or_else(|| value.get(snake))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn provider_authorization_parameters(provider: ChatProvider) -> (&'static str, &'static str) {
    match provider {
        ChatProvider::Slack => (
            "https://slack.com/oauth/v2/authorize",
            "channels:read,groups:read,im:read,mpim:read,channels:history,groups:history,im:history,mpim:history",
        ),
        ChatProvider::GoogleChat => (
            "https://accounts.google.com/o/oauth2/v2/auth",
            "openid https://www.googleapis.com/auth/chat.spaces.readonly https://www.googleapis.com/auth/chat.messages.readonly",
        ),
        // Webex message resources are KMS-encrypted. Webex's Integration OAuth
        // contract requires the automatically registered spark:kms scope to be
        // included in a manually composed authorization request.
        ChatProvider::Webex => (
            "https://webexapis.com/v1/authorize",
            "spark:rooms_read spark:messages_read spark:people_read spark:kms",
        ),
    }
}

async fn connect_oauth(provider: ChatProvider) -> Result<(), String> {
    let config = provider_config(provider)?;
    let (listener, redirect_uri) = callback_listener(provider, &config)?;
    let verifier = random_urlsafe(64);
    let challenge = general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_urlsafe(32);
    let (authorize_endpoint, scope) = provider_authorization_parameters(provider);
    let mut authorize_url = reqwest::Url::parse(authorize_endpoint)
        .map_err(|_| "The chat authorization endpoint is invalid.".to_string())?;
    authorize_url
        .query_pairs_mut()
        .append_pair("client_id", &config.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    if provider == ChatProvider::Slack {
        authorize_url
            .query_pairs_mut()
            .append_pair("user_scope", scope);
    } else {
        authorize_url.query_pairs_mut().append_pair("scope", scope);
    }
    if provider == ChatProvider::GoogleChat {
        authorize_url
            .query_pairs_mut()
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");
    }
    tauri_plugin_opener::open_url(authorize_url.as_str(), None::<&str>)
        .map_err(|_| "Could not open the browser for chat sign-in.".to_string())?;
    let state_for_wait = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || {
        wait_for_callback(listener, &state_for_wait, "/chat-auth/callback")
    })
    .await
    .map_err(|_| "The chat sign-in listener stopped unexpectedly.".to_string())??;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Could not prepare the chat token request.".to_string())?;
    let value = match provider {
        ChatProvider::Slack => {
            let response = client
                .post("https://slack.com/api/oauth.v2.access")
                .form(&[
                    ("client_id", config.client_id.as_str()),
                    ("code", code.as_str()),
                    ("redirect_uri", redirect_uri.as_str()),
                    ("code_verifier", verifier.as_str()),
                ])
                .send()
                .await
                .map_err(|_| "Slack token exchange could not reach the provider.".to_string())?;
            if !response.status().is_success() {
                return Err("Slack rejected the token exchange.".to_string());
            }
            response
                .json::<Value>()
                .await
                .map_err(|_| "Slack returned an unreadable token response.".to_string())?
        }
        ChatProvider::GoogleChat => {
            let response = client
                .post("https://oauth2.googleapis.com/token")
                .form(&[
                    ("client_id", config.client_id.as_str()),
                    ("code", code.as_str()),
                    ("redirect_uri", redirect_uri.as_str()),
                    ("grant_type", "authorization_code"),
                    ("code_verifier", verifier.as_str()),
                ])
                .send()
                .await
                .map_err(|_| {
                    "Google Chat token exchange could not reach the provider.".to_string()
                })?;
            if !response.status().is_success() {
                return Err("Google Chat rejected the token exchange.".to_string());
            }
            response
                .json::<Value>()
                .await
                .map_err(|_| "Google Chat returned an unreadable token response.".to_string())?
        }
        ChatProvider::Webex => {
            let endpoint = broker_endpoint(
                config
                    .broker_url
                    .as_deref()
                    .ok_or_else(|| "The Webex token broker is not configured.".to_string())?,
            )?;
            let response = client
                .post(endpoint)
                .json(&json!({
                    "grantType": "authorization_code",
                    "clientId": config.client_id,
                    "code": code,
                    "redirectUri": redirect_uri,
                    "codeVerifier": verifier
                }))
                .send()
                .await
                .map_err(|_| "The Weekform Webex token broker could not be reached.".to_string())?;
            if !response.status().is_success() {
                return Err("The Weekform Webex token broker rejected the exchange.".to_string());
            }
            response.json::<Value>().await.map_err(|_| {
                "The Webex token broker returned an unreadable response.".to_string()
            })?
        }
    };

    let (access_token, refresh_token, mut self_id) = match provider {
        ChatProvider::Slack => {
            if value.get("ok").and_then(Value::as_bool) != Some(true) {
                return Err("Slack did not authorize the requested read-only access.".to_string());
            }
            let user = value
                .get("authed_user")
                .ok_or_else(|| "Slack did not return a user authorization.".to_string())?;
            (
                response_value(user, "access_token", "access_token")
                    .ok_or_else(|| "Slack did not return an access token.".to_string())?,
                response_value(user, "refresh_token", "refresh_token")
                    .ok_or_else(|| "Slack did not return rotating offline access.".to_string())?,
                response_value(user, "id", "id").ok_or_else(|| {
                    "Slack did not return the authorized user identity.".to_string()
                })?,
            )
        }
        ChatProvider::GoogleChat => {
            let access_token = response_value(&value, "accessToken", "access_token")
                .ok_or_else(|| "Google Chat did not return an access token.".to_string())?;
            let refresh_token = response_value(&value, "refreshToken", "refresh_token")
                .ok_or_else(|| "Google Chat did not return offline access.".to_string())?;
            let id_token = response_value(&value, "idToken", "id_token")
                .ok_or_else(|| "Google Chat did not return an identity token.".to_string())?;
            let subject = jwt_subject(&id_token)
                .ok_or_else(|| "Google Chat identity could not be read.".to_string())?;
            (access_token, refresh_token, format!("users/{subject}"))
        }
        ChatProvider::Webex => (
            response_value(&value, "accessToken", "access_token")
                .ok_or_else(|| "The Webex broker did not return an access token.".to_string())?,
            response_value(&value, "refreshToken", "refresh_token")
                .ok_or_else(|| "The Webex broker did not return offline access.".to_string())?,
            response_value(&value, "selfId", "self_id").unwrap_or_default(),
        ),
    };
    if provider == ChatProvider::Webex && self_id.is_empty() {
        let response = client
            .get("https://webexapis.com/v1/people/me")
            .bearer_auth(&access_token)
            .send()
            .await
            .map_err(|_| "Webex identity verification could not reach the provider.".to_string())?;
        if !response.status().is_success() {
            return Err("Webex could not verify the authorized account.".to_string());
        }
        let identity = response
            .json::<Value>()
            .await
            .map_err(|_| "Webex returned an unreadable identity response.".to_string())?;
        self_id = identity
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "Webex did not return the authorized account identity.".to_string())?;
    }
    drop(access_token);
    token_write(
        provider,
        &StoredChatToken {
            refresh_token,
            self_id,
        },
    )
}

async fn refresh_access_token(provider: ChatProvider) -> Result<(String, String), String> {
    let stored =
        token_read(provider)?.ok_or_else(|| format!("{} is not connected.", provider.label()))?;
    let config = provider_config(provider)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Could not prepare the chat refresh request.".to_string())?;
    let value = match provider {
        ChatProvider::Slack => {
            let response = client
                .post("https://slack.com/api/oauth.v2.access")
                .form(&[
                    ("grant_type", "refresh_token"),
                    ("client_id", config.client_id.as_str()),
                    ("refresh_token", stored.refresh_token.as_str()),
                ])
                .send()
                .await
                .map_err(|_| "Slack access refresh could not reach the provider.".to_string())?;
            if !response.status().is_success() {
                return Err("Slack access expired. Disconnect and connect again.".to_string());
            }
            response
                .json::<Value>()
                .await
                .map_err(|_| "Slack returned an unreadable refresh response.".to_string())?
        }
        ChatProvider::GoogleChat => {
            let response = client
                .post("https://oauth2.googleapis.com/token")
                .form(&[
                    ("client_id", config.client_id.as_str()),
                    ("refresh_token", stored.refresh_token.as_str()),
                    ("grant_type", "refresh_token"),
                ])
                .send()
                .await
                .map_err(|_| {
                    "Google Chat access refresh could not reach the provider.".to_string()
                })?;
            if !response.status().is_success() {
                return Err("Google Chat access expired. Disconnect and connect again.".to_string());
            }
            response
                .json::<Value>()
                .await
                .map_err(|_| "Google Chat returned an unreadable refresh response.".to_string())?
        }
        ChatProvider::Webex => {
            let endpoint = broker_endpoint(
                config
                    .broker_url
                    .as_deref()
                    .ok_or_else(|| "The Webex token broker is not configured.".to_string())?,
            )?;
            let response = client
                .post(endpoint)
                .json(&json!({
                    "grantType": "refresh_token",
                    "clientId": config.client_id,
                    "refreshToken": stored.refresh_token
                }))
                .send()
                .await
                .map_err(|_| "The Weekform Webex token broker could not be reached.".to_string())?;
            if !response.status().is_success() {
                return Err("Webex access expired. Disconnect and connect again.".to_string());
            }
            response.json::<Value>().await.map_err(|_| {
                "The Webex token broker returned an unreadable refresh response.".to_string()
            })?
        }
    };
    let (access_token, replacement_refresh) = match provider {
        ChatProvider::Slack => {
            if value.get("ok").and_then(Value::as_bool) != Some(true) {
                return Err("Slack access expired. Disconnect and connect again.".to_string());
            }
            let user = value.get("authed_user").unwrap_or(&value);
            (
                response_value(user, "accessToken", "access_token")
                    .ok_or_else(|| "Slack refresh did not return an access token.".to_string())?,
                response_value(user, "refreshToken", "refresh_token"),
            )
        }
        _ => (
            response_value(&value, "accessToken", "access_token").ok_or_else(|| {
                format!(
                    "{} refresh did not return an access token.",
                    provider.label()
                )
            })?,
            response_value(&value, "refreshToken", "refresh_token"),
        ),
    };
    if let Some(refresh_token) = replacement_refresh {
        token_write(
            provider,
            &StoredChatToken {
                refresh_token,
                self_id: stored.self_id.clone(),
            },
        )?;
    }
    Ok((access_token, stored.self_id))
}

fn range_unix_seconds(value: &str) -> Result<i64, String> {
    OffsetDateTime::parse(value, &Rfc3339)
        .map(|timestamp| timestamp.unix_timestamp())
        .map_err(|_| "The chat range could not be converted for the provider.".to_string())
}

// Slack and Google expose an exclusive lower-bound query. Widen it by one
// second, then enforce the exact [start, end) contract locally after native
// projection so an event precisely at midnight on the first requested day is
// never lost before reconciliation sees it.
fn exclusive_provider_lower_bound(value: &str) -> Result<String, String> {
    let timestamp = OffsetDateTime::parse(value, &Rfc3339)
        .map_err(|_| "The chat range start could not be converted for the provider.".to_string())?;
    (timestamp - time::Duration::seconds(1))
        .format(&Rfc3339)
        .map_err(|_| "The chat range start could not be formatted for the provider.".to_string())
}

fn retain_requested_events(
    events: Vec<NativeChatEvidenceEvent>,
    request: &ChatRangeRequest,
) -> Vec<NativeChatEvidenceEvent> {
    let Ok(start) = OffsetDateTime::parse(&request.start, &Rfc3339) else {
        return Vec::new();
    };
    let Ok(end) = OffsetDateTime::parse(&request.end_exclusive, &Rfc3339) else {
        return Vec::new();
    };
    events
        .into_iter()
        .filter(|event| {
            OffsetDateTime::parse(&event.timestamp, &Rfc3339)
                .map(|timestamp| timestamp >= start && timestamp < end)
                .unwrap_or(false)
        })
        .collect()
}

fn retry_after_seconds(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
}

fn safe_continuation_url(value: &str, expected_host: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(value).ok()?;
    if url.scheme() == "https"
        && url.host_str() == Some(expected_host)
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
    {
        Some(url)
    } else {
        None
    }
}

fn next_link(response: &reqwest::Response, expected_host: &str) -> Option<String> {
    let header = response
        .headers()
        .get(reqwest::header::LINK)?
        .to_str()
        .ok()?;
    header.split(',').find_map(|part| {
        let mut sections = part.trim().split(';');
        let target = sections
            .next()?
            .trim()
            .trim_start_matches('<')
            .trim_end_matches('>');
        let is_next = sections.any(|section| section.trim() == "rel=\"next\"");
        if is_next && safe_continuation_url(target, expected_host).is_some() {
            Some(target.to_string())
        } else {
            None
        }
    })
}

fn webex_page_reached_start(value: &Value, range_start: OffsetDateTime) -> bool {
    value
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|message| message.get("created").and_then(Value::as_str))
        .filter_map(|created| OffsetDateTime::parse(created, &Rfc3339).ok())
        .any(|created| created <= range_start)
}

async fn fetch_slack(
    token: &str,
    self_id: &str,
    request: &ChatRangeRequest,
    salt: &[u8],
    cursor: Option<StoredChatCursor>,
    range_key: &str,
) -> Result<ProviderFetch, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Could not prepare Slack sync.".to_string())?;
    let active = cursor.filter(|cursor| cursor.range_key == range_key);
    let page_cursor = active
        .as_ref()
        .and_then(|cursor| cursor.provider_page_token.clone());
    let item_offset = active
        .as_ref()
        .map(|cursor| cursor.item_offset)
        .unwrap_or(0);
    let resume_surface_id = active
        .as_ref()
        .and_then(|cursor| cursor.active_surface_id.clone());
    let resume_surface_page = active
        .as_ref()
        .and_then(|cursor| cursor.surface_page_token.clone());
    let mut url = reqwest::Url::parse("https://slack.com/api/users.conversations")
        .map_err(|_| "The Slack sync endpoint is invalid.".to_string())?;
    url.query_pairs_mut()
        .append_pair("types", "public_channel,private_channel,im,mpim")
        .append_pair("exclude_archived", "true")
        .append_pair("limit", "200");
    if let Some(cursor) = &page_cursor {
        url.query_pairs_mut().append_pair("cursor", cursor);
    }
    let response = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "Slack conversations could not be read.".to_string())?;
    let retry_after = retry_after_seconds(&response);
    if response.status().as_u16() == 429 {
        let model_eligible = slack_rate_limit_model_eligible(true, active.is_some(), false);
        return Ok(ProviderFetch {
            events: Vec::new(),
            fetched_count: 0,
            dropped_count: 0,
            coverage: SyncCoverage::RateLimited,
            retry_after_seconds: retry_after,
            continuation: active,
            authority_eligible: false,
            model_eligible,
        });
    }
    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        return Ok(ProviderFetch {
            events: Vec::new(),
            fetched_count: 0,
            dropped_count: 0,
            coverage: SyncCoverage::PermissionLimited,
            retry_after_seconds: None,
            continuation: None,
            authority_eligible: false,
            model_eligible: false,
        });
    }
    if !response.status().is_success() {
        return Err("Slack rejected the conversation sync.".to_string());
    }
    let value = response
        .json::<Value>()
        .await
        .map_err(|_| "Slack returned an unreadable conversation response.".to_string())?;
    if value.get("ok").and_then(Value::as_bool) != Some(true) {
        let coverage = match value.get("error").and_then(Value::as_str) {
            Some("missing_scope") | Some("not_allowed_token_type") => {
                SyncCoverage::PermissionLimited
            }
            Some("ratelimited") => SyncCoverage::RateLimited,
            _ => return Err("Slack could not read the authorized conversations.".to_string()),
        };
        let model_eligible = coverage == SyncCoverage::RateLimited
            && slack_rate_limit_model_eligible(true, active.is_some(), false);
        return Ok(ProviderFetch {
            events: Vec::new(),
            fetched_count: 0,
            dropped_count: 0,
            coverage,
            retry_after_seconds: retry_after,
            continuation: active,
            authority_eligible: false,
            model_eligible,
        });
    }
    let conversations_coverage = collection_authority_coverage(&value, "channels");
    let conversations = value
        .get("channels")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let next_page = value
        .get("response_metadata")
        .and_then(|metadata| metadata.get("next_cursor"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let oldest = range_unix_seconds(&exclusive_provider_lower_bound(&request.start)?)?.to_string();
    let latest = range_unix_seconds(&request.end_exclusive)?.to_string();
    let mut events = Vec::new();
    let mut fetched_count = 0usize;
    let mut dropped_count = 0usize;
    let mut coverage = if conversations_coverage == SyncCoverage::Complete {
        SyncCoverage::ScopeLimited
    } else {
        conversations_coverage
    };
    // `users.conversations` + `conversations.history` intentionally covers only
    // currently listed top-level history. It can support additive modeling after
    // an intact run, but never proves whole-range absence or deletion.
    let mut authority_eligible = false;
    let mut model_eligible = conversations_coverage == SyncCoverage::Complete;
    let mut completed_message_page = active.is_some();
    let mut retry = None;
    let mut surface_resume: Option<(String, Option<String>)> = None;
    let selected = conversations
        .iter()
        .skip(item_offset)
        .take(MAX_SURFACES_PER_SYNC)
        .collect::<Vec<_>>();
    let mut processed = 0usize;
    for conversation in selected {
        let Some(raw_conversation_id) = conversation.get("id").and_then(Value::as_str) else {
            coverage = coverage.merge(SyncCoverage::Partial);
            authority_eligible = false;
            model_eligible = false;
            processed += 1;
            continue;
        };
        let raw_surface = if conversation.get("is_im").and_then(Value::as_bool) == Some(true) {
            "dm"
        } else if conversation.get("is_mpim").and_then(Value::as_bool) == Some(true) {
            "group_dm"
        } else {
            "channel"
        };
        let participant_count = conversation.get("num_members").and_then(Value::as_u64);
        let mut message_cursor = if resume_surface_id.as_deref() == Some(raw_conversation_id) {
            resume_surface_page.clone()
        } else {
            None
        };
        for page in 0..MAX_MESSAGE_PAGES_PER_SURFACE {
            let requested_message_cursor = message_cursor.clone();
            let mut history_url =
                reqwest::Url::parse("https://slack.com/api/conversations.history")
                    .map_err(|_| "The Slack history endpoint is invalid.".to_string())?;
            history_url
                .query_pairs_mut()
                .append_pair("channel", raw_conversation_id)
                .append_pair("oldest", &oldest)
                .append_pair("latest", &latest)
                .append_pair("inclusive", "false")
                .append_pair("limit", "15");
            if let Some(cursor) = &message_cursor {
                history_url.query_pairs_mut().append_pair("cursor", cursor);
            }
            let response = client
                .get(history_url)
                .bearer_auth(token)
                .send()
                .await
                .map_err(|_| "Slack message history could not be read.".to_string())?;
            let response_retry = retry_after_seconds(&response);
            if response.status().as_u16() == 429 {
                coverage = coverage.merge(SyncCoverage::RateLimited);
                authority_eligible = false;
                model_eligible = slack_rate_limit_model_eligible(
                    model_eligible,
                    active.is_some(),
                    completed_message_page,
                );
                retry = response_retry;
                surface_resume = Some((raw_conversation_id.to_string(), requested_message_cursor));
                break;
            }
            if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
                coverage = coverage.merge(SyncCoverage::PermissionLimited);
                authority_eligible = false;
                model_eligible = false;
                break;
            }
            if !response.status().is_success() {
                return Err("Slack rejected a message-history request.".to_string());
            }
            let history = response
                .json::<Value>()
                .await
                .map_err(|_| "Slack returned unreadable message history.".to_string())?;
            if history.get("ok").and_then(Value::as_bool) != Some(true) {
                let page_coverage = match history.get("error").and_then(Value::as_str) {
                    Some("ratelimited") => SyncCoverage::RateLimited,
                    Some("missing_scope") | Some("not_in_channel") => {
                        SyncCoverage::PermissionLimited
                    }
                    _ => SyncCoverage::Partial,
                };
                coverage = coverage.merge(page_coverage);
                authority_eligible = false;
                if page_coverage == SyncCoverage::RateLimited {
                    model_eligible = slack_rate_limit_model_eligible(
                        model_eligible,
                        active.is_some(),
                        completed_message_page,
                    );
                    surface_resume =
                        Some((raw_conversation_id.to_string(), requested_message_cursor));
                } else {
                    model_eligible = false;
                }
                break;
            }
            let projected = project_slack_messages_with_count(
                &history,
                raw_conversation_id,
                raw_surface,
                self_id,
                salt,
                participant_count,
            );
            fetched_count += projected.fetched_count;
            dropped_count += projected.dropped_count();
            let projection_coverage = projected.authority_coverage();
            authority_eligible &= projection_coverage == SyncCoverage::Complete;
            model_eligible &= projection_coverage == SyncCoverage::Complete;
            coverage = coverage.merge(projection_coverage);
            events.extend(retain_requested_events(projected.events, request));
            completed_message_page = true;
            message_cursor = match slack_history_next_cursor(&history) {
                Ok(cursor) => cursor,
                Err(_) => {
                    coverage = coverage.merge(SyncCoverage::Partial);
                    authority_eligible = false;
                    model_eligible = false;
                    break;
                }
            };
            if message_cursor.is_none() {
                break;
            }
            if page + 1 == MAX_MESSAGE_PAGES_PER_SURFACE {
                coverage = coverage.merge(SyncCoverage::Partial);
                if message_cursor.is_some() {
                    surface_resume =
                        Some((raw_conversation_id.to_string(), message_cursor.clone()));
                }
            }
        }
        if surface_resume.is_some() {
            break;
        }
        processed += 1;
        if coverage == SyncCoverage::PermissionLimited {
            break;
        }
    }
    let next_offset = item_offset + processed;
    let continuation = if let Some((active_surface_id, surface_page_token)) = surface_resume {
        Some(StoredChatCursor {
            range_key: range_key.to_string(),
            provider_page_token: page_cursor,
            item_offset: next_offset,
            active_surface_id: Some(active_surface_id),
            surface_page_token,
        })
    } else if next_offset < conversations.len() {
        coverage = coverage.merge(SyncCoverage::Partial);
        Some(StoredChatCursor {
            range_key: range_key.to_string(),
            provider_page_token: page_cursor,
            item_offset: next_offset,
            active_surface_id: None,
            surface_page_token: None,
        })
    } else if let Some(next_page) = next_page {
        coverage = coverage.merge(SyncCoverage::Partial);
        Some(StoredChatCursor {
            range_key: range_key.to_string(),
            provider_page_token: Some(next_page),
            item_offset: 0,
            active_surface_id: None,
            surface_page_token: None,
        })
    } else {
        None
    };
    Ok(ProviderFetch {
        events,
        fetched_count,
        dropped_count,
        coverage,
        retry_after_seconds: retry,
        continuation,
        authority_eligible,
        model_eligible,
    })
}

async fn fetch_google_chat(
    token: &str,
    self_id: &str,
    request: &ChatRangeRequest,
    salt: &[u8],
    cursor: Option<StoredChatCursor>,
    range_key: &str,
) -> Result<ProviderFetch, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Could not prepare Google Chat sync.".to_string())?;
    let active = cursor.filter(|cursor| cursor.range_key == range_key);
    let page_token = active
        .as_ref()
        .and_then(|cursor| cursor.provider_page_token.clone());
    let item_offset = active
        .as_ref()
        .map(|cursor| cursor.item_offset)
        .unwrap_or(0);
    let resume_surface_id = active
        .as_ref()
        .and_then(|cursor| cursor.active_surface_id.clone());
    let resume_surface_page = active
        .as_ref()
        .and_then(|cursor| cursor.surface_page_token.clone());
    let mut spaces_url = reqwest::Url::parse("https://chat.googleapis.com/v1/spaces")
        .map_err(|_| "The Google Chat spaces endpoint is invalid.".to_string())?;
    spaces_url
        .query_pairs_mut()
        .append_pair("pageSize", "100")
        .append_pair("fields", "spaces(name,spaceType),nextPageToken");
    if let Some(token) = &page_token {
        spaces_url.query_pairs_mut().append_pair("pageToken", token);
    }
    let response = client
        .get(spaces_url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "Google Chat spaces could not be read.".to_string())?;
    let retry_after = retry_after_seconds(&response);
    if response.status().as_u16() == 429 {
        return Ok(ProviderFetch {
            events: Vec::new(),
            fetched_count: 0,
            dropped_count: 0,
            coverage: SyncCoverage::RateLimited,
            retry_after_seconds: retry_after,
            continuation: active,
            authority_eligible: false,
            model_eligible: false,
        });
    }
    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        return Ok(ProviderFetch {
            events: Vec::new(),
            fetched_count: 0,
            dropped_count: 0,
            coverage: SyncCoverage::PermissionLimited,
            retry_after_seconds: None,
            continuation: None,
            authority_eligible: false,
            model_eligible: false,
        });
    }
    if !response.status().is_success() {
        return Err("Google Chat rejected the spaces sync.".to_string());
    }
    let value = response
        .json::<Value>()
        .await
        .map_err(|_| "Google Chat returned an unreadable spaces response.".to_string())?;
    let spaces_coverage = collection_authority_coverage(&value, "spaces");
    let spaces = value
        .get("spaces")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let next_page = value
        .get("nextPageToken")
        .and_then(Value::as_str)
        .map(str::to_string);
    let selected = spaces
        .iter()
        .skip(item_offset)
        .take(MAX_SURFACES_PER_SYNC)
        .collect::<Vec<_>>();
    let mut events = Vec::new();
    let mut fetched_count = 0usize;
    let mut dropped_count = 0usize;
    let mut coverage = spaces_coverage;
    let mut authority_eligible = spaces_coverage == SyncCoverage::Complete;
    let mut retry = None;
    let mut surface_resume: Option<(String, Option<String>)> = None;
    let mut processed = 0usize;
    let query_start = exclusive_provider_lower_bound(&request.start)?;
    for space in selected {
        let Some(raw_space_id) = space.get("name").and_then(Value::as_str) else {
            coverage = coverage.merge(SyncCoverage::Partial);
            authority_eligible = false;
            processed += 1;
            continue;
        };
        if !raw_space_id.starts_with("spaces/") {
            coverage = coverage.merge(SyncCoverage::Partial);
            authority_eligible = false;
            processed += 1;
            continue;
        }
        let raw_space_type = space
            .get("spaceType")
            .and_then(Value::as_str)
            .unwrap_or("SPACE");
        let endpoint = format!("https://chat.googleapis.com/v1/{raw_space_id}/messages");
        let mut message_page = if resume_surface_id.as_deref() == Some(raw_space_id) {
            resume_surface_page.clone()
        } else {
            None
        };
        for page in 0..MAX_MESSAGE_PAGES_PER_SURFACE {
            let requested_message_page = message_page.clone();
            let mut messages_url = reqwest::Url::parse(&endpoint)
                .map_err(|_| "The Google Chat messages endpoint is invalid.".to_string())?;
            messages_url
                .query_pairs_mut()
                .append_pair("pageSize", "1000")
                .append_pair("showDeleted", "true")
                .append_pair(
                    "filter",
                    &format!(
                        "createTime > \"{}\" AND createTime < \"{}\"",
                        query_start, request.end_exclusive
                    ),
                )
                .append_pair(
                    "fields",
                    "messages(name,sender(name,type),createTime,lastUpdateTime,deleteTime,silent,thread(name),annotations(type,userMention(user(name),type))),nextPageToken",
                );
            if let Some(token) = &message_page {
                messages_url
                    .query_pairs_mut()
                    .append_pair("pageToken", token);
            }
            let response = client
                .get(messages_url)
                .bearer_auth(token)
                .send()
                .await
                .map_err(|_| "Google Chat messages could not be read.".to_string())?;
            let response_retry = retry_after_seconds(&response);
            if response.status().as_u16() == 429 {
                coverage = coverage.merge(SyncCoverage::RateLimited);
                authority_eligible = false;
                retry = response_retry;
                surface_resume = Some((raw_space_id.to_string(), requested_message_page));
                break;
            }
            if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
                coverage = coverage.merge(SyncCoverage::PermissionLimited);
                authority_eligible = false;
                break;
            }
            if !response.status().is_success() {
                return Err("Google Chat rejected a messages request.".to_string());
            }
            let page_value = response
                .json::<Value>()
                .await
                .map_err(|_| "Google Chat returned unreadable message metadata.".to_string())?;
            let projected =
                project_google_messages(&page_value, raw_space_id, raw_space_type, self_id, salt);
            fetched_count += projected.fetched_count;
            dropped_count += projected.dropped_count();
            let projection_coverage = projected.authority_coverage();
            authority_eligible &= projection_coverage == SyncCoverage::Complete;
            coverage = coverage.merge(projection_coverage);
            events.extend(retain_requested_events(projected.events, request));
            message_page = page_value
                .get("nextPageToken")
                .and_then(Value::as_str)
                .map(str::to_string);
            if message_page.is_none() {
                break;
            }
            if page + 1 == MAX_MESSAGE_PAGES_PER_SURFACE {
                coverage = coverage.merge(SyncCoverage::Partial);
                surface_resume = Some((raw_space_id.to_string(), message_page.clone()));
            }
        }
        if surface_resume.is_some() {
            break;
        }
        processed += 1;
        if coverage == SyncCoverage::PermissionLimited {
            break;
        }
    }
    let next_offset = item_offset + processed;
    let continuation = if let Some((active_surface_id, surface_page_token)) = surface_resume {
        Some(StoredChatCursor {
            range_key: range_key.to_string(),
            provider_page_token: page_token,
            item_offset: next_offset,
            active_surface_id: Some(active_surface_id),
            surface_page_token,
        })
    } else if next_offset < spaces.len() {
        coverage = coverage.merge(SyncCoverage::Partial);
        Some(StoredChatCursor {
            range_key: range_key.to_string(),
            provider_page_token: page_token,
            item_offset: next_offset,
            active_surface_id: None,
            surface_page_token: None,
        })
    } else if let Some(next_page) = next_page {
        coverage = coverage.merge(SyncCoverage::Partial);
        Some(StoredChatCursor {
            range_key: range_key.to_string(),
            provider_page_token: Some(next_page),
            item_offset: 0,
            active_surface_id: None,
            surface_page_token: None,
        })
    } else {
        None
    };
    Ok(ProviderFetch {
        events,
        fetched_count,
        dropped_count,
        coverage,
        retry_after_seconds: retry,
        continuation,
        authority_eligible,
        model_eligible: authority_eligible,
    })
}

async fn fetch_webex(
    token: &str,
    self_id: &str,
    request: &ChatRangeRequest,
    salt: &[u8],
    cursor: Option<StoredChatCursor>,
    range_key: &str,
) -> Result<ProviderFetch, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Could not prepare Webex sync.".to_string())?;
    let active = cursor.filter(|cursor| cursor.range_key == range_key);
    let page_url = active
        .as_ref()
        .and_then(|cursor| cursor.provider_page_token.as_deref())
        .and_then(|url| safe_continuation_url(url, "webexapis.com"))
        .unwrap_or_else(|| {
            reqwest::Url::parse("https://webexapis.com/v1/rooms?max=100")
                .expect("static Webex rooms URL is valid")
        });
    let item_offset = active
        .as_ref()
        .map(|cursor| cursor.item_offset)
        .unwrap_or(0);
    let resume_surface_id = active
        .as_ref()
        .and_then(|cursor| cursor.active_surface_id.clone());
    let resume_surface_page = active
        .as_ref()
        .and_then(|cursor| cursor.surface_page_token.as_deref())
        .and_then(|url| safe_continuation_url(url, "webexapis.com"));
    let response = client
        .get(page_url.clone())
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "Webex rooms could not be read.".to_string())?;
    let retry_after = retry_after_seconds(&response);
    let next_rooms_page = next_link(&response, "webexapis.com");
    if response.status().as_u16() == 429 {
        return Ok(ProviderFetch {
            events: Vec::new(),
            fetched_count: 0,
            dropped_count: 0,
            coverage: SyncCoverage::RateLimited,
            retry_after_seconds: retry_after,
            continuation: active,
            authority_eligible: false,
            model_eligible: false,
        });
    }
    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        return Ok(ProviderFetch {
            events: Vec::new(),
            fetched_count: 0,
            dropped_count: 0,
            coverage: SyncCoverage::PermissionLimited,
            retry_after_seconds: None,
            continuation: None,
            authority_eligible: false,
            model_eligible: false,
        });
    }
    if !response.status().is_success() {
        return Err("Webex rejected the rooms sync.".to_string());
    }
    let value = response
        .json::<Value>()
        .await
        .map_err(|_| "Webex returned an unreadable rooms response.".to_string())?;
    let rooms_coverage = collection_authority_coverage(&value, "items");
    let rooms = value
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let selected = rooms
        .iter()
        .skip(item_offset)
        .take(MAX_SURFACES_PER_SYNC)
        .collect::<Vec<_>>();
    let before = request.end_exclusive.clone();
    let range_start = OffsetDateTime::parse(&request.start, &Rfc3339)
        .map_err(|_| "The Webex range start is invalid.".to_string())?;
    let mut events = Vec::new();
    let mut fetched_count = 0usize;
    let mut dropped_count = 0usize;
    let mut coverage = rooms_coverage;
    let mut authority_eligible = rooms_coverage == SyncCoverage::Complete;
    let mut retry = None;
    let mut surface_resume: Option<(String, Option<String>)> = None;
    let mut processed = 0usize;
    for room in selected {
        let Some(raw_room_id) = room.get("id").and_then(Value::as_str) else {
            coverage = coverage.merge(SyncCoverage::Partial);
            authority_eligible = false;
            processed += 1;
            continue;
        };
        let raw_room_type = room.get("type").and_then(Value::as_str).unwrap_or("group");
        let initial_messages_url = {
            let mut url = reqwest::Url::parse("https://webexapis.com/v1/messages")
                .map_err(|_| "The Webex messages endpoint is invalid.".to_string())?;
            url.query_pairs_mut()
                .append_pair("roomId", raw_room_id)
                .append_pair("before", &before)
                .append_pair("max", "100");
            url
        };
        let mut messages_url = if resume_surface_id.as_deref() == Some(raw_room_id) {
            resume_surface_page.clone().unwrap_or(initial_messages_url)
        } else {
            initial_messages_url
        };
        for page in 0..MAX_MESSAGE_PAGES_PER_SURFACE {
            let requested_messages_url = messages_url.clone();
            let response = client
                .get(messages_url.clone())
                .bearer_auth(token)
                .send()
                .await
                .map_err(|_| "Webex messages could not be read.".to_string())?;
            let response_retry = retry_after_seconds(&response);
            let next_messages_page = next_link(&response, "webexapis.com");
            if response.status().as_u16() == 429 {
                coverage = coverage.merge(SyncCoverage::RateLimited);
                authority_eligible = false;
                retry = response_retry;
                surface_resume = Some((
                    raw_room_id.to_string(),
                    Some(requested_messages_url.to_string()),
                ));
                break;
            }
            if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
                coverage = coverage.merge(SyncCoverage::PermissionLimited);
                authority_eligible = false;
                break;
            }
            if !response.status().is_success() {
                return Err("Webex rejected a messages request.".to_string());
            }
            let page_value = response
                .json::<Value>()
                .await
                .map_err(|_| "Webex returned unreadable message metadata.".to_string())?;
            let projected =
                project_webex_messages(&page_value, raw_room_id, raw_room_type, self_id, salt);
            // Pagination follows the provider collection, not the retained
            // attention subset. Ambient rows are intentionally discarded, but
            // they can still prove that this descending page reached the lower
            // time boundary and prevent needless extra provider reads.
            let reached_start = webex_page_reached_start(&page_value, range_start);
            fetched_count += projected.fetched_count;
            dropped_count += projected.dropped_count();
            let projection_coverage = projected.authority_coverage();
            authority_eligible &= projection_coverage == SyncCoverage::Complete;
            coverage = coverage.merge(projection_coverage);
            events.extend(retain_requested_events(projected.events, request));
            if reached_start || next_messages_page.is_none() {
                break;
            }
            if page + 1 == MAX_MESSAGE_PAGES_PER_SURFACE {
                coverage = coverage.merge(SyncCoverage::Partial);
                surface_resume = Some((raw_room_id.to_string(), next_messages_page));
                break;
            }
            messages_url = safe_continuation_url(
                next_messages_page.as_deref().unwrap_or_default(),
                "webexapis.com",
            )
            .ok_or_else(|| "Webex returned an unsafe continuation.".to_string())?;
        }
        if surface_resume.is_some() {
            break;
        }
        processed += 1;
        if coverage == SyncCoverage::PermissionLimited {
            break;
        }
    }
    let next_offset = item_offset + processed;
    let continuation = if let Some((active_surface_id, surface_page_token)) = surface_resume {
        Some(StoredChatCursor {
            range_key: range_key.to_string(),
            provider_page_token: Some(page_url.to_string()),
            item_offset: next_offset,
            active_surface_id: Some(active_surface_id),
            surface_page_token,
        })
    } else if next_offset < rooms.len() {
        coverage = coverage.merge(SyncCoverage::Partial);
        Some(StoredChatCursor {
            range_key: range_key.to_string(),
            provider_page_token: Some(page_url.to_string()),
            item_offset: next_offset,
            active_surface_id: None,
            surface_page_token: None,
        })
    } else if let Some(next_page) = next_rooms_page {
        coverage = coverage.merge(SyncCoverage::Partial);
        Some(StoredChatCursor {
            range_key: range_key.to_string(),
            provider_page_token: Some(next_page),
            item_offset: 0,
            active_surface_id: None,
            surface_page_token: None,
        })
    } else {
        None
    };
    Ok(ProviderFetch {
        events,
        fetched_count,
        dropped_count,
        coverage,
        retry_after_seconds: retry,
        continuation,
        authority_eligible,
        model_eligible: authority_eligible,
    })
}

fn connection_status(provider: ChatProvider) -> Result<ChatConnectionStatus, String> {
    let config = provider_config(provider);
    let saved = token_read(provider)?.is_some();
    let available = config.is_ok();
    let connected = available && saved;
    let detail = if let Err(error) = config {
        if saved {
            format!("{error} A saved credential is present but cannot be used until configuration is restored.")
        } else {
            error
        }
    } else if connected {
        "Authorization is saved; Sync verifies current provider access. Credentials and provider cursors stay in macOS Keychain, and only pseudonymous evidence metadata crosses the native boundary."
            .to_string()
    } else if provider == ChatProvider::Webex {
        "Configured. Connect verifies Webex and the HTTPS Weekform token broker before any sync is marked connected."
            .to_string()
    } else {
        "Configured. Connect verifies provider authorization before any sync is marked connected."
            .to_string()
    };
    Ok(ChatConnectionStatus {
        provider,
        available,
        connected,
        requires_broker: provider == ChatProvider::Webex,
        detail,
    })
}

#[tauri::command]
pub fn chat_source_statuses() -> Result<Vec<ChatConnectionStatus>, String> {
    [
        ChatProvider::Slack,
        ChatProvider::GoogleChat,
        ChatProvider::Webex,
    ]
    .into_iter()
    .map(connection_status)
    .collect()
}

#[tauri::command]
pub async fn connect_chat_source(provider: ChatProvider) -> Result<(), String> {
    connect_oauth(provider).await
}

#[tauri::command]
pub async fn sync_chat_source(request: ChatRangeRequest) -> Result<ChatSyncResponse, String> {
    request.validate()?;
    let salt = hash_salt()?;
    let range_key = keyed_digest(
        &salt,
        request.provider,
        "range",
        &format!("{}\0{}", request.start, request.end_exclusive),
    );
    let cursor = cursor_read(request.provider)?;
    let resumed = cursor
        .as_ref()
        .map(|cursor| cursor.range_key == range_key)
        .unwrap_or(false);
    let (access_token, self_id) = refresh_access_token(request.provider).await?;
    let fetched = match request.provider {
        ChatProvider::Slack => {
            fetch_slack(&access_token, &self_id, &request, &salt, cursor, &range_key).await?
        }
        ChatProvider::GoogleChat => {
            fetch_google_chat(&access_token, &self_id, &request, &salt, cursor, &range_key).await?
        }
        ChatProvider::Webex => {
            fetch_webex(&access_token, &self_id, &request, &salt, cursor, &range_key).await?
        }
    };
    drop(access_token);
    if let Some(cursor) = &fetched.continuation {
        cursor_write(request.provider, cursor)?;
    } else {
        keychain_delete(request.provider.cursor_key())?;
    }
    let checkpoint = fetched.continuation.as_ref().map(|cursor| {
        keyed_digest(
            &salt,
            request.provider,
            "checkpoint",
            &format!(
                "{}\0{}\0{}\0{}",
                cursor.provider_page_token.as_deref().unwrap_or(""),
                cursor.item_offset,
                cursor.active_surface_id.as_deref().unwrap_or(""),
                cursor.surface_page_token.as_deref().unwrap_or("")
            ),
        )
    });
    let normalized_count = fetched.events.len();
    let receipt_time = imported_at();
    let receipt_coverage = authoritative_receipt_coverage(fetched.coverage, resumed);
    let semantics = receipt_semantics(&fetched, resumed);
    Ok(ChatSyncResponse {
        events: fetched.events,
        receipt: ChatSyncReceipt {
            provider: request.provider,
            range: ChatSyncRange {
                start: request.start,
                end_exclusive: request.end_exclusive,
            },
            fetched_count: fetched.fetched_count,
            normalized_count,
            dropped_count: fetched.dropped_count,
            coverage: receipt_coverage,
            detail: receipt_coverage.detail().to_string(),
            retry_after_seconds: fetched.retry_after_seconds,
            checkpoint,
            resumed: semantics.resumed,
            has_more: semantics.has_more,
            authority_eligible: semantics.authority_eligible,
            model_eligible: semantics.model_eligible,
            completed_at: receipt_time,
            content_handling: "Provider responses are projected in the native process; message content, names, emails, URLs, titles, and raw provider identifiers are discarded before this result crosses the native boundary."
                .to_string(),
        },
    })
}

#[tauri::command]
pub fn disconnect_chat_source(provider: ChatProvider) -> Result<(), String> {
    for key in disconnect_key_order(provider) {
        keychain_delete(key)?;
    }
    Ok(())
}

fn disconnect_key_order(provider: ChatProvider) -> [&'static str; 2] {
    // Remove resumable transfer state first. If authorization deletion then
    // fails, the account remains connected and retryable instead of leaving a
    // stale raw-provider cursor behind an apparently disconnected account.
    [provider.cursor_key(), provider.token_key()]
}

#[tauri::command]
pub fn clear_chat_source_storage() -> Result<(), String> {
    for provider in [
        ChatProvider::Slack,
        ChatProvider::GoogleChat,
        ChatProvider::Webex,
    ] {
        for key in disconnect_key_order(provider) {
            keychain_delete(key)?;
        }
    }
    keychain_delete(HASH_SALT_KEY)
}

#[cfg(test)]
mod tests {
    use super::{
        authoritative_receipt_coverage, collection_authority_coverage, disconnect_key_order,
        exclusive_provider_lower_bound, keyed_digest, normalize_google_messages,
        normalize_slack_messages, normalize_webex_messages, participant_bucket,
        project_google_messages, project_slack_messages_with_count, project_webex_messages,
        provider_authorization_parameters, receipt_semantics, retain_requested_events,
        slack_history_next_cursor, slack_rate_limit_model_eligible, validate_provider_config,
        validate_redirect_uri, wait_for_callback, webex_page_reached_start, ChatProvider,
        ChatRangeRequest, ProviderFetch, StoredChatCursor, SyncCoverage,
    };
    use serde_json::json;
    use std::{
        io::Write,
        net::{TcpListener, TcpStream},
        thread,
        time::Duration,
    };
    use time::{format_description::well_known::Rfc3339, OffsetDateTime};

    #[test]
    fn provider_contract_accepts_only_slack_google_chat_and_webex() {
        assert!(serde_json::from_str::<ChatProvider>("\"slack\"").is_ok());
        assert!(serde_json::from_str::<ChatProvider>("\"google_chat\"").is_ok());
        assert!(serde_json::from_str::<ChatProvider>("\"webex\"").is_ok());
        assert!(serde_json::from_str::<ChatProvider>("\"teams\"").is_err());
    }

    #[test]
    fn disconnect_removes_resume_state_before_the_authorization_record() {
        assert_eq!(
            disconnect_key_order(ChatProvider::Slack),
            [
                "weekform:chat:slack:cursor:v1",
                "weekform:chat:slack:token:v1"
            ],
        );
    }

    #[test]
    fn unverified_loopback_probe_cannot_cancel_the_real_oauth_callback() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let callback = thread::spawn(move || {
            wait_for_callback(listener, "expected-state", "/chat-auth/callback")
        });
        let send = |target: &str| {
            let mut stream = TcpStream::connect(address).unwrap();
            write!(
                stream,
                "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
        };

        send("/chat-auth/callback?error=access_denied&state=wrong-state");
        thread::sleep(Duration::from_millis(20));
        send("/chat-auth/callback?code=verified-code&state=expected-state");

        assert_eq!(callback.join().unwrap().unwrap(), "verified-code");
    }

    #[test]
    fn webex_authorization_requests_the_kms_scope_required_for_message_resources() {
        let (_, scope) = provider_authorization_parameters(ChatProvider::Webex);
        assert!(scope
            .split_ascii_whitespace()
            .any(|value| value == "spark:kms"));
    }

    #[test]
    fn provider_configuration_fails_closed() {
        let missing = |_name: &str| None;
        assert!(validate_provider_config(ChatProvider::Slack, &missing).is_err());
        assert!(validate_provider_config(ChatProvider::GoogleChat, &missing).is_err());
        assert!(validate_provider_config(ChatProvider::Webex, &missing).is_err());
    }

    #[test]
    fn webex_configuration_requires_https_broker_and_loopback_redirect() {
        let valid = |name: &str| match name {
            "WEBEX_CHAT_CLIENT_ID" => Some("synthetic-client".to_string()),
            "WEBEX_CHAT_REDIRECT_URI" => {
                Some("http://127.0.0.1:49323/chat-auth/callback".to_string())
            }
            "WEEKFORM_CHAT_OAUTH_BROKER_URL" => {
                Some("https://auth.example.test/weekform".to_string())
            }
            "WEBEX_CHAT_BROKER_SECURITY_VERIFIED" => Some("true".to_string()),
            _ => None,
        };
        assert!(validate_provider_config(ChatProvider::Webex, &valid).is_ok());

        let insecure = |name: &str| match name {
            "WEBEX_CHAT_CLIENT_ID" => Some("synthetic-client".to_string()),
            "WEBEX_CHAT_REDIRECT_URI" => {
                Some("http://127.0.0.1:49323/chat-auth/callback".to_string())
            }
            "WEEKFORM_CHAT_OAUTH_BROKER_URL" => {
                Some("http://auth.example.test/weekform".to_string())
            }
            "WEBEX_CHAT_BROKER_SECURITY_VERIFIED" => Some("true".to_string()),
            _ => None,
        };
        assert!(validate_provider_config(ChatProvider::Webex, &insecure).is_err());
    }

    #[test]
    fn webex_configuration_fails_closed_until_broker_security_is_verified() {
        let unverified = |name: &str| match name {
            "WEBEX_CHAT_CLIENT_ID" => Some("synthetic-client".to_string()),
            "WEBEX_CHAT_REDIRECT_URI" => {
                Some("http://127.0.0.1:49323/chat-auth/callback".to_string())
            }
            "WEEKFORM_CHAT_OAUTH_BROKER_URL" => {
                Some("https://auth.example.test/weekform".to_string())
            }
            _ => None,
        };
        let error = match validate_provider_config(ChatProvider::Webex, &unverified) {
            Ok(_) => panic!("unverified Webex broker configuration must remain unavailable"),
            Err(error) => error,
        };
        assert!(error.contains("WEBEX_CHAT_BROKER_SECURITY_VERIFIED=true"));

        let explicitly_unverified = |name: &str| match name {
            "WEBEX_CHAT_CLIENT_ID" => Some("synthetic-client".to_string()),
            "WEBEX_CHAT_REDIRECT_URI" => {
                Some("http://127.0.0.1:49323/chat-auth/callback".to_string())
            }
            "WEEKFORM_CHAT_OAUTH_BROKER_URL" => {
                Some("https://auth.example.test/weekform".to_string())
            }
            "WEBEX_CHAT_BROKER_SECURITY_VERIFIED" => Some("false".to_string()),
            _ => None,
        };
        assert!(validate_provider_config(ChatProvider::Webex, &explicitly_unverified).is_err());

        let padded_true = |name: &str| match name {
            "WEBEX_CHAT_CLIENT_ID" => Some("synthetic-client".to_string()),
            "WEBEX_CHAT_REDIRECT_URI" => {
                Some("http://127.0.0.1:49323/chat-auth/callback".to_string())
            }
            "WEEKFORM_CHAT_OAUTH_BROKER_URL" => {
                Some("https://auth.example.test/weekform".to_string())
            }
            "WEBEX_CHAT_BROKER_SECURITY_VERIFIED" => Some(" true ".to_string()),
            _ => None,
        };
        assert!(validate_provider_config(ChatProvider::Webex, &padded_true).is_err());
    }

    #[test]
    fn redirects_are_exact_loopback_callbacks() {
        assert!(validate_redirect_uri("http://127.0.0.1:49323/chat-auth/callback").is_ok());
        assert!(validate_redirect_uri("http://localhost:49323/chat-auth/callback").is_ok());
        assert!(validate_redirect_uri("https://example.test/chat-auth/callback").is_err());
        assert!(validate_redirect_uri("http://127.0.0.1:49323/other").is_err());
    }

    #[test]
    fn native_boundary_rejects_invalid_or_unbounded_chat_ranges() {
        let invalid = ChatRangeRequest {
            provider: ChatProvider::Slack,
            start: "2026-07-21T00:00:00Z".to_string(),
            end_exclusive: "2026-07-20T00:00:00Z".to_string(),
        };
        assert!(invalid.validate().is_err());

        let unbounded = ChatRangeRequest {
            provider: ChatProvider::GoogleChat,
            start: "2026-01-01T00:00:00Z".to_string(),
            end_exclusive: "2026-07-20T00:00:00Z".to_string(),
        };
        assert!(unbounded.validate().unwrap_err().contains("90 days"));
    }

    #[test]
    fn keyed_digests_are_stable_scoped_and_do_not_reveal_raw_ids() {
        let first = keyed_digest(b"synthetic-salt", ChatProvider::Slack, "message", "raw-123");
        let again = keyed_digest(b"synthetic-salt", ChatProvider::Slack, "message", "raw-123");
        let other_provider =
            keyed_digest(b"synthetic-salt", ChatProvider::Webex, "message", "raw-123");
        assert_eq!(first, again);
        assert_ne!(first, other_provider);
        assert!(!first.contains("raw-123"));
    }

    #[test]
    fn participant_counts_cross_the_boundary_only_as_coarse_contract_buckets() {
        assert_eq!(participant_bucket(None), None);
        assert_eq!(participant_bucket(Some(0)), None);
        assert_eq!(participant_bucket(Some(1)).as_deref(), Some("1"));
        assert_eq!(participant_bucket(Some(5)).as_deref(), Some("2-5"));
        assert_eq!(participant_bucket(Some(20)).as_deref(), Some("6-20"));
        assert_eq!(participant_bucket(Some(21)).as_deref(), Some("21+"));
    }

    #[test]
    fn keychain_cursor_schema_preserves_older_bounded_sync_checkpoints() {
        let cursor: StoredChatCursor = serde_json::from_value(json!({
            "range_key": "synthetic-range",
            "provider_page_token": "provider-secret-cursor",
            "item_offset": 4
        }))
        .unwrap();
        assert_eq!(cursor.item_offset, 4);
        assert!(cursor.active_surface_id.is_none());
        assert!(cursor.surface_page_token.is_none());
    }

    #[test]
    fn a_resumed_final_page_cannot_claim_complete_range_coverage() {
        assert_eq!(
            authoritative_receipt_coverage(SyncCoverage::Complete, true),
            SyncCoverage::Partial
        );
        assert_eq!(
            authoritative_receipt_coverage(SyncCoverage::Complete, false),
            SyncCoverage::Complete
        );
        assert_eq!(
            authoritative_receipt_coverage(SyncCoverage::RateLimited, true),
            SyncCoverage::RateLimited
        );
    }

    #[test]
    fn pagination_only_partial_pages_remain_authority_eligible() {
        let fetch = ProviderFetch {
            events: Vec::new(),
            fetched_count: 0,
            dropped_count: 0,
            coverage: SyncCoverage::Partial,
            retry_after_seconds: None,
            continuation: Some(StoredChatCursor {
                range_key: "synthetic-range".to_string(),
                provider_page_token: Some("next-page".to_string()),
                item_offset: 0,
                active_surface_id: None,
                surface_page_token: None,
            }),
            authority_eligible: true,
            model_eligible: true,
        };

        let semantics = receipt_semantics(&fetch, false);
        assert!(!semantics.resumed);
        assert!(semantics.has_more);
        assert!(semantics.authority_eligible);
        assert!(semantics.model_eligible);
        assert_eq!(
            serde_json::to_value(semantics).unwrap(),
            json!({
                "resumed": false,
                "hasMore": true,
                "authorityEligible": true,
                "modelEligible": true
            }),
        );
    }

    #[test]
    fn malformed_rate_limited_and_permission_limited_pages_are_never_authority_eligible() {
        let cases = [
            (SyncCoverage::Partial, false),
            (SyncCoverage::RateLimited, true),
            (SyncCoverage::PermissionLimited, true),
        ];
        for (coverage, page_flag) in cases {
            let fetch = ProviderFetch {
                events: Vec::new(),
                fetched_count: 0,
                dropped_count: 0,
                coverage,
                retry_after_seconds: None,
                continuation: None,
                authority_eligible: page_flag,
                model_eligible: page_flag,
            };
            assert!(!receipt_semantics(&fetch, true).authority_eligible);
        }
    }

    #[test]
    fn receipt_has_more_is_derived_only_from_a_saved_continuation() {
        let completed = ProviderFetch {
            events: Vec::new(),
            fetched_count: 0,
            dropped_count: 0,
            coverage: SyncCoverage::Complete,
            retry_after_seconds: None,
            continuation: None,
            authority_eligible: true,
            model_eligible: true,
        };
        let semantics = receipt_semantics(&completed, true);
        assert!(semantics.resumed);
        assert!(!semantics.has_more);
        assert!(semantics.authority_eligible);
    }

    #[test]
    fn slack_scope_limited_completion_is_model_eligible_but_never_authoritative() {
        let fetch = ProviderFetch {
            events: Vec::new(),
            fetched_count: 0,
            dropped_count: 0,
            coverage: SyncCoverage::ScopeLimited,
            retry_after_seconds: None,
            continuation: None,
            authority_eligible: false,
            model_eligible: true,
        };

        let semantics = receipt_semantics(&fetch, false);
        assert!(!semantics.authority_eligible);
        assert!(semantics.model_eligible);
    }

    #[test]
    fn slack_rate_limit_model_eligibility_requires_prior_resumable_progress() {
        assert!(!slack_rate_limit_model_eligible(true, false, false));
        assert!(slack_rate_limit_model_eligible(true, true, false));
        assert!(slack_rate_limit_model_eligible(true, false, true));
        assert!(!slack_rate_limit_model_eligible(false, true, true));
    }

    #[test]
    fn slack_history_never_treats_has_more_without_a_cursor_as_complete() {
        let malformed = json!({
            "ok": true,
            "messages": [],
            "has_more": true,
            "response_metadata": { "next_cursor": "" }
        });
        assert!(slack_history_next_cursor(&malformed).is_err());

        let complete = json!({ "ok": true, "messages": [], "has_more": false });
        assert_eq!(slack_history_next_cursor(&complete).unwrap(), None);

        let paginated = json!({
            "ok": true,
            "messages": [],
            "has_more": true,
            "response_metadata": { "next_cursor": "next-page" }
        });
        assert_eq!(
            slack_history_next_cursor(&paginated).unwrap().as_deref(),
            Some("next-page")
        );
    }

    #[test]
    fn google_empty_messages_object_is_a_valid_empty_page_and_keeps_run_eligible() {
        let projected = project_google_messages(
            &json!({}),
            "spaces/raw",
            "SPACE",
            "users/me",
            b"synthetic-salt",
        );
        let projection_coverage = projected.authority_coverage();

        assert_eq!(projected.fetched_count, 0);
        assert!(projected.events.is_empty());
        assert_eq!(projection_coverage, SyncCoverage::Complete);

        let dropped_count = projected.dropped_count();
        let fetch = ProviderFetch {
            events: projected.events,
            fetched_count: projected.fetched_count,
            dropped_count,
            coverage: SyncCoverage::Complete.merge(projection_coverage),
            retry_after_seconds: None,
            continuation: None,
            authority_eligible: projection_coverage == SyncCoverage::Complete,
            model_eligible: projection_coverage == SyncCoverage::Complete,
        };
        let semantics = receipt_semantics(&fetch, false);

        assert!(semantics.authority_eligible);
        assert!(semantics.model_eligible);
    }

    #[test]
    fn malformed_collection_shapes_cannot_claim_complete_coverage() {
        let slack = project_slack_messages_with_count(
            &json!({"ok": true}),
            "C-RAW",
            "channel",
            "U-ME",
            b"synthetic-salt",
            None,
        );
        let google = project_google_messages(
            &json!({"messages": {"not": "an array"}}),
            "spaces/raw",
            "SPACE",
            "users/me",
            b"synthetic-salt",
        );
        let webex = project_webex_messages(
            &json!({}),
            "room-raw",
            "group",
            "person-me",
            b"synthetic-salt",
        );

        assert_eq!(slack.authority_coverage(), SyncCoverage::Partial);
        assert_eq!(google.authority_coverage(), SyncCoverage::Partial);
        assert_eq!(webex.authority_coverage(), SyncCoverage::Partial);
    }

    #[test]
    fn malformed_outer_surface_collections_cannot_claim_complete_coverage() {
        assert_eq!(
            collection_authority_coverage(&json!({"ok": true}), "channels"),
            SyncCoverage::Partial,
        );
        assert_eq!(
            collection_authority_coverage(&json!({"spaces": {}}), "spaces"),
            SyncCoverage::Partial,
        );
        assert_eq!(
            collection_authority_coverage(&json!({}), "items"),
            SyncCoverage::Partial,
        );
        assert_eq!(
            collection_authority_coverage(&json!({"items": []}), "items"),
            SyncCoverage::Complete,
        );
    }

    #[test]
    fn malformed_non_ignored_items_cannot_claim_complete_coverage() {
        let slack = project_slack_messages_with_count(
            &json!({"messages": [{
                "user": "U-SOMEONE",
                "text": "A real user message without a timestamp"
            }]}),
            "C-RAW",
            "channel",
            "U-ME",
            b"synthetic-salt",
            None,
        );
        let google = project_google_messages(
            &json!({"messages": [{
                "name": "spaces/raw/messages/raw-message",
                "sender": {"name": "users/someone", "type": "HUMAN"}
            }]}),
            "spaces/raw",
            "SPACE",
            "users/me",
            b"synthetic-salt",
        );
        let webex = project_webex_messages(
            &json!({"items": [{
                "id": "message-raw",
                "personId": "person-other"
            }]}),
            "room-raw",
            "group",
            "person-me",
            b"synthetic-salt",
        );

        assert_eq!(slack.authority_coverage(), SyncCoverage::Partial);
        assert_eq!(google.authority_coverage(), SyncCoverage::Partial);
        assert_eq!(webex.authority_coverage(), SyncCoverage::Partial);
        assert_eq!(slack.malformed_count, 1);
        assert_eq!(google.malformed_count, 1);
        assert_eq!(webex.malformed_count, 1);
    }

    #[test]
    fn intentionally_ignored_items_do_not_make_a_valid_page_partial() {
        let slack = project_slack_messages_with_count(
            &json!({"messages": [{
                "subtype": "bot_message",
                "bot_id": "B-IGNORED",
                "text": "Automation output"
            }]}),
            "C-RAW",
            "channel",
            "U-ME",
            b"synthetic-salt",
            None,
        );
        let google = project_google_messages(
            &json!({"messages": [{
                "sender": {"type": "BOT"},
                "text": "Automation output"
            }]}),
            "spaces/raw",
            "SPACE",
            "users/me",
            b"synthetic-salt",
        );

        assert_eq!(slack.authority_coverage(), SyncCoverage::Complete);
        assert_eq!(google.authority_coverage(), SyncCoverage::Complete);
        assert_eq!(slack.ignored_count, 1);
        assert_eq!(google.ignored_count, 1);
    }

    #[test]
    fn ambient_messages_are_discarded_at_the_native_projection_boundary() {
        let slack = project_slack_messages_with_count(
            &json!({"messages": [{
                "ts": "1720000000.000100",
                "user": "U-SOMEONE",
                "text": "Ambient channel traffic"
            }]}),
            "C-RAW",
            "channel",
            "U-ME",
            b"synthetic-salt",
            None,
        );
        let google = project_google_messages(
            &json!({"messages": [{
                "name": "spaces/raw/messages/raw-message",
                "sender": {"name": "users/someone", "type": "HUMAN"},
                "createTime": "2026-07-20T15:00:00Z"
            }]}),
            "spaces/raw",
            "SPACE",
            "users/me",
            b"synthetic-salt",
        );
        let webex = project_webex_messages(
            &json!({"items": [{
                "id": "message-raw",
                "personId": "person-other",
                "created": "2026-07-20T15:00:00Z"
            }]}),
            "room-raw",
            "group",
            "person-me",
            b"synthetic-salt",
        );

        for projection in [slack, google, webex] {
            assert!(projection.events.is_empty());
            assert_eq!(projection.ignored_count, 1);
            assert_eq!(projection.malformed_count, 0);
            assert_eq!(projection.authority_coverage(), SyncCoverage::Complete);
        }
    }

    #[test]
    fn ambient_webex_rows_can_close_time_pagination_without_becoming_evidence() {
        let page = json!({"items": [{
            "id": "ambient-old-message",
            "personId": "person-other",
            "created": "2026-07-19T23:59:59Z",
            "text": "Private ambient body"
        }]});
        let start = OffsetDateTime::parse("2026-07-20T00:00:00Z", &Rfc3339).unwrap();
        let projected =
            project_webex_messages(&page, "room-raw", "group", "person-me", b"synthetic-salt");

        assert!(webex_page_reached_start(&page, start));
        assert!(projected.events.is_empty());
        assert_eq!(projected.ignored_count, 1);
    }

    #[test]
    fn every_provider_keeps_the_exact_start_and_excludes_the_end_boundary() {
        let request = ChatRangeRequest {
            provider: ChatProvider::Slack,
            start: "2026-07-20T00:00:00Z".to_string(),
            end_exclusive: "2026-07-21T00:00:00Z".to_string(),
        };
        let query_start = exclusive_provider_lower_bound(&request.start).unwrap();
        assert!(query_start < request.start);

        for provider in [
            ChatProvider::Slack,
            ChatProvider::GoogleChat,
            ChatProvider::Webex,
        ] {
            let start_event = super::NativeChatEvidenceEvent {
                schema_version: 1,
                event_id: format!("{}-start", provider.key()),
                provider,
                timestamp: request.start.clone(),
                surface: super::ChatSurface::Dm,
                direction: super::ChatDirection::Outbound,
                attention_signal: super::AttentionSignal::SelfSent,
                attention_grade: super::AttentionGrade::Observed,
                correlation_key: "correlation".to_string(),
                conversation_key: "conversation".to_string(),
                thread_key: None,
                participant_count_bucket: None,
                silent: false,
                tombstone: false,
                revision: "revision".to_string(),
                imported_at: "2026-07-20T00:00:00Z".to_string(),
                local_only: true,
            };
            let end_event = super::NativeChatEvidenceEvent {
                event_id: format!("{}-end", provider.key()),
                timestamp: request.end_exclusive.clone(),
                ..start_event.clone()
            };

            let retained = retain_requested_events(vec![start_event, end_event], &request);
            assert_eq!(retained.len(), 1, "{} range boundary", provider.label());
            assert_eq!(retained[0].timestamp, request.start);
        }
    }

    #[test]
    fn slack_projection_discards_message_content_and_identity_fields() {
        let events = normalize_slack_messages(
            &json!({"messages": [
                {
                    "ts": "1720000000.000100",
                    "user": "U-SOMEONE",
                    "text": "Confidential launch body <@U-ME>",
                    "user_profile": {"email": "person@example.test", "real_name": "Private Person"}
                },
                {
                    "subtype": "message_changed",
                    "message": {
                        "ts": "1720000100.000100",
                        "user": "U-ME",
                        "text": "Confidential edited body",
                        "edited": {"ts": "1720000200.000100"}
                    }
                }
            ]}),
            "C-RAW",
            "channel",
            "U-ME",
            b"synthetic-salt",
        );
        let encoded = serde_json::to_string(&events).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].correlation_key, events[0].conversation_key);
        assert!(!encoded.contains("Confidential launch body"));
        assert!(!encoded.contains("Confidential edited body"));
        assert!(!encoded.contains("person@example.test"));
        assert!(!encoded.contains("Private Person"));
        assert!(!encoded.contains("C-RAW"));
        assert!(!encoded.contains("U-SOMEONE"));
    }

    #[test]
    fn google_projection_uses_annotations_without_retaining_content() {
        let events = normalize_google_messages(
            &json!({"messages": [{
                "name": "spaces/raw/messages/raw-message",
                "sender": {"name": "users/someone", "displayName": "Private Person"},
                "createTime": "2026-07-20T15:00:00Z",
                "text": "Confidential body",
                "silent": true,
                "thread": {"name": "spaces/raw/threads/raw-thread"},
                "annotations": [{"userMention": {"user": {"name": "users/me"}}}]
            }]}),
            "spaces/raw",
            "SPACE",
            "users/me",
            b"synthetic-salt",
        );
        let encoded = serde_json::to_string(&events).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].thread_key.as_deref(),
            Some(events[0].correlation_key.as_str())
        );
        assert!(events[0].silent);
        assert!(!encoded.contains("Confidential body"));
        assert!(!encoded.contains("Private Person"));
        assert!(!encoded.contains("spaces/raw"));
        assert!(!encoded.contains("users/someone"));
    }

    #[test]
    fn webex_projection_discards_room_titles_emails_and_message_bodies() {
        let events = normalize_webex_messages(
            &json!({"items": [{
                "id": "message-raw",
                "roomId": "room-raw",
                "personId": "person-other",
                "personEmail": "person@example.test",
                "text": "Confidential body",
                "markdown": "**Confidential body**",
                "created": "2026-07-20T15:00:00Z",
                "mentionedPeople": ["person-me"]
            }]}),
            "room-raw",
            "group",
            "person-me",
            b"synthetic-salt",
        );
        let encoded = serde_json::to_string(&events).unwrap();
        assert_eq!(events.len(), 1);
        assert!(!encoded.contains("Confidential body"));
        assert!(!encoded.contains("person@example.test"));
        assert!(!encoded.contains("room-raw"));
        assert!(!encoded.contains("person-other"));
    }
}
