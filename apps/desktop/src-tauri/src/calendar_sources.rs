use base64::{engine::general_purpose, Engine as _};
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    env,
    ffi::{c_char, CStr},
    io::{Read, Write},
    net::TcpListener,
    time::{Duration, Instant},
};

const KEYCHAIN_SERVICE: &str = "com.weekform.desktop";
const OAUTH_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CalendarProvider {
    Outlook,
    Google,
    Apple,
}

impl CalendarProvider {
    fn label(self) -> &'static str {
        match self {
            Self::Outlook => "Outlook Calendar",
            Self::Google => "Google Calendar",
            Self::Apple => "Apple Calendar",
        }
    }

    fn source(self) -> &'static str {
        match self {
            Self::Outlook => "outlook_calendar",
            Self::Google => "google_calendar",
            Self::Apple => "apple_calendar",
        }
    }

    fn keychain_key(self) -> &'static str {
        match self {
            Self::Outlook => "weekform:calendar:outlook:v1",
            Self::Google => "weekform:calendar:google:v1",
            Self::Apple => "weekform:calendar:apple:v1",
        }
    }

    fn configured(self) -> bool {
        match self {
            Self::Outlook => configured_env("MICROSOFT_CALENDAR_CLIENT_ID").is_some(),
            Self::Google => configured_env("GOOGLE_CALENDAR_CLIENT_ID").is_some(),
            Self::Apple => cfg!(target_os = "macos"),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarRangeRequest {
    provider: CalendarProvider,
    start: String,
    end_exclusive: String,
}

impl CalendarRangeRequest {
    fn validate(&self) -> Result<(), String> {
        use time::{format_description::well_known::Rfc3339, OffsetDateTime};
        let start = OffsetDateTime::parse(&self.start, &Rfc3339)
            .map_err(|_| "The calendar start date is invalid.".to_string())?;
        let end = OffsetDateTime::parse(&self.end_exclusive, &Rfc3339)
            .map_err(|_| "The calendar end date is invalid.".to_string())?;
        let duration = end - start;
        if duration.is_negative() || duration.is_zero() {
            return Err("The calendar end date must be after the start date.".to_string());
        }
        if duration.whole_hours() > 367 * 24 {
            return Err("Calendar ranges are limited to 366 days.".to_string());
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarConnectionStatus {
    provider: CalendarProvider,
    available: bool,
    connected: bool,
    detail: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct StoredOAuthToken {
    refresh_token: String,
}

#[derive(Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NativeCalendarEvent {
    calendar_event_id: String,
    uid: String,
    title: String,
    start_time: String,
    end_time: String,
    location: Option<String>,
    organizer: Option<String>,
    attendee_count: usize,
    all_day: bool,
    recurrence_note: Option<String>,
    source: String,
    imported_at: String,
}

#[derive(Deserialize)]
struct EventKitEvent {
    provider_id: String,
    uid: String,
    title: String,
    start_time: String,
    end_time: String,
    location: Option<String>,
    organizer: Option<String>,
    attendee_count: usize,
    all_day: bool,
}

fn configured_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .or_else(|| match name {
            "GOOGLE_CALENDAR_CLIENT_ID" => {
                option_env!("GOOGLE_CALENDAR_CLIENT_ID").map(str::to_string)
            }
            "MICROSOFT_CALENDAR_CLIENT_ID" => {
                option_env!("MICROSOFT_CALENDAR_CLIENT_ID").map(str::to_string)
            }
            _ => None,
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn keychain_read(provider: CalendarProvider) -> Result<Option<StoredOAuthToken>, String> {
    match get_generic_password(KEYCHAIN_SERVICE, provider.keychain_key()) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|_| {
            format!(
                "{} connection data in Keychain is invalid.",
                provider.label()
            )
        }),
        Err(error) if error.code() == -25300 => Ok(None),
        Err(error) => Err(format!(
            "Could not read {} connection from macOS Keychain: {error}",
            provider.label()
        )),
    }
}

fn keychain_write(provider: CalendarProvider, token: &StoredOAuthToken) -> Result<(), String> {
    let encoded = serde_json::to_vec(token)
        .map_err(|_| "Calendar connection could not be encoded.".to_string())?;
    set_generic_password(KEYCHAIN_SERVICE, provider.keychain_key(), &encoded).map_err(|error| {
        format!(
            "Could not save {} connection in macOS Keychain: {error}",
            provider.label()
        )
    })
}

fn keychain_delete(provider: CalendarProvider) -> Result<(), String> {
    match delete_generic_password(KEYCHAIN_SERVICE, provider.keychain_key()) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == -25300 => Ok(()),
        Err(error) => Err(format!(
            "Could not remove {} connection from macOS Keychain: {error}",
            provider.label()
        )),
    }
}

fn random_urlsafe(length: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; length];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn oauth_reply(stream: &mut std::net::TcpStream, message: &str) {
    let body = format!("<!doctype html><meta charset=utf-8><title>Weekform</title><body style='display:grid;place-items:center;height:100vh;font:16px -apple-system;margin:0;background:#151514;color:#f4f3ef'><p>{message}</p></body>");
    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
}

fn wait_for_callback(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Could not prepare calendar sign-in: {error}"))?;
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
                    .map_err(|_| "The calendar sign-in response was malformed.".to_string())?;
                if url.path() != "/calendar-auth/callback" {
                    oauth_reply(&mut stream, "This is not a Weekform calendar callback.");
                    continue;
                }
                let mut code = None;
                let mut state = None;
                let mut error = None;
                for (key, value) in url.query_pairs() {
                    match key.as_ref() {
                        "code" => code = Some(value.into_owned()),
                        "state" => state = Some(value.into_owned()),
                        "error" | "error_description" => error = Some(value.into_owned()),
                        _ => {}
                    }
                }
                if let Some(error) = error {
                    oauth_reply(
                        &mut stream,
                        "Calendar access was not connected. Return to Weekform to try again.",
                    );
                    return Err(format!("Calendar access was not granted ({error})."));
                }
                if state.as_deref() != Some(expected_state) {
                    oauth_reply(&mut stream, "This calendar response could not be verified.");
                    return Err("The calendar sign-in response could not be verified.".to_string());
                }
                let code = code.ok_or_else(|| {
                    "The calendar sign-in response did not include a code.".to_string()
                })?;
                oauth_reply(
                    &mut stream,
                    "Calendar connected. Close this tab and return to Weekform.",
                );
                return Ok(code);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err(
                        "Timed out waiting for calendar sign-in. Try Connect again.".to_string()
                    );
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(error) => return Err(format!("The calendar sign-in listener failed: {error}")),
        }
    }
}

async fn connect_oauth(provider: CalendarProvider) -> Result<(), String> {
    let client_id = configured_env(match provider {
        CalendarProvider::Google => "GOOGLE_CALENDAR_CLIENT_ID",
        CalendarProvider::Outlook => "MICROSOFT_CALENDAR_CLIENT_ID",
        CalendarProvider::Apple => return Err("Apple Calendar does not use OAuth.".to_string()),
    })
    .ok_or_else(|| {
        format!(
            "{} live sync is not configured in this build.",
            provider.label()
        )
    })?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Could not start calendar sign-in: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not inspect calendar sign-in listener: {error}"))?
        .port();
    let redirect_host = if provider == CalendarProvider::Outlook {
        "localhost"
    } else {
        "127.0.0.1"
    };
    let redirect_uri = format!("http://{redirect_host}:{port}/calendar-auth/callback");
    let verifier = random_urlsafe(64);
    let challenge = general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_urlsafe(32);

    let (authorize_endpoint, token_endpoint, scope) = match provider {
        CalendarProvider::Google => (
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://oauth2.googleapis.com/token",
            "https://www.googleapis.com/auth/calendar.events.readonly",
        ),
        CalendarProvider::Outlook => (
            "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            "offline_access Calendars.ReadBasic",
        ),
        CalendarProvider::Apple => unreachable!(),
    };
    let mut authorize_url = reqwest::Url::parse(authorize_endpoint)
        .map_err(|_| "Calendar authorization URL is invalid.".to_string())?;
    authorize_url
        .query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", scope)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    if provider == CalendarProvider::Google {
        authorize_url
            .query_pairs_mut()
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");
    }
    tauri_plugin_opener::open_url(authorize_url.as_str(), None::<&str>)
        .map_err(|error| format!("Could not open the browser for calendar sign-in: {error}"))?;
    let state_for_wait = state.clone();
    let code =
        tauri::async_runtime::spawn_blocking(move || wait_for_callback(listener, &state_for_wait))
            .await
            .map_err(|error| format!("Calendar sign-in listener failed: {error}"))??;
    let mut token_form = vec![
        ("client_id", client_id.as_str()),
        ("code", code.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
        ("code_verifier", verifier.as_str()),
    ];
    if provider == CalendarProvider::Outlook {
        token_form.push(("scope", scope));
    }
    let response = reqwest::Client::new()
        .post(token_endpoint)
        .form(&token_form)
        .send()
        .await
        .map_err(|error| format!("Calendar token exchange failed: {error}"))?;
    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Calendar token response could not be read: {error}"))?;
    if !status.is_success() {
        return Err(value
            .get("error_description")
            .or_else(|| value.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("The calendar provider rejected the token exchange.")
            .to_string());
    }
    let token: OAuthTokenResponse = serde_json::from_value(value)
        .map_err(|_| "The calendar provider did not return usable credentials.".to_string())?;
    let refresh_token = token.refresh_token.ok_or_else(|| "The calendar provider did not return offline access. Disconnect the app in the provider account and try Connect again.".to_string())?;
    keychain_write(provider, &StoredOAuthToken { refresh_token })
}

async fn refresh_access_token(provider: CalendarProvider) -> Result<String, String> {
    let stored = keychain_read(provider)?
        .ok_or_else(|| format!("{} is not connected.", provider.label()))?;
    let client_id = configured_env(match provider {
        CalendarProvider::Google => "GOOGLE_CALENDAR_CLIENT_ID",
        CalendarProvider::Outlook => "MICROSOFT_CALENDAR_CLIENT_ID",
        CalendarProvider::Apple => return Err("Apple Calendar does not use OAuth.".to_string()),
    })
    .ok_or_else(|| {
        format!(
            "{} live sync is not configured in this build.",
            provider.label()
        )
    })?;
    let (endpoint, scope) = match provider {
        CalendarProvider::Google => ("https://oauth2.googleapis.com/token", None),
        CalendarProvider::Outlook => (
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            Some("offline_access Calendars.ReadBasic"),
        ),
        CalendarProvider::Apple => unreachable!(),
    };
    let mut form = vec![
        ("client_id", client_id.as_str()),
        ("refresh_token", stored.refresh_token.as_str()),
        ("grant_type", "refresh_token"),
    ];
    if let Some(scope) = scope {
        form.push(("scope", scope));
    }
    let response = reqwest::Client::new()
        .post(endpoint)
        .form(&form)
        .send()
        .await
        .map_err(|error| format!("Could not refresh {} access: {error}", provider.label()))?;
    let status = response.status();
    let value = response.json::<Value>().await.map_err(|error| {
        format!(
            "{} refresh response could not be read: {error}",
            provider.label()
        )
    })?;
    if !status.is_success() {
        return Err(value
            .get("error_description")
            .or_else(|| value.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("Calendar access expired. Disconnect and connect again.")
            .to_string());
    }
    let token: OAuthTokenResponse = serde_json::from_value(value)
        .map_err(|_| "Calendar refresh did not return an access token.".to_string())?;
    if let Some(refresh_token) = token.refresh_token {
        keychain_write(provider, &StoredOAuthToken { refresh_token })?;
    }
    Ok(token.access_token)
}

fn stable_id(provider: CalendarProvider, provider_id: &str) -> String {
    let digest = Sha256::digest(provider_id.as_bytes());
    format!("{}-{}", provider.source(), &format!("{digest:x}")[..20])
}

fn imported_at() -> String {
    use time::{format_description::well_known::Rfc3339, OffsetDateTime};
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn normalize_datetime(value: &str, timezone: Option<&str>) -> String {
    let suffix = value.get(10..).unwrap_or("");
    if value.ends_with('Z') || suffix.contains('+') || suffix.contains('-') {
        value.to_string()
    } else if timezone == Some("UTC") {
        format!("{value}Z")
    } else {
        value.to_string()
    }
}

fn normalize_google(value: &Value) -> Vec<NativeCalendarEvent> {
    value
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            if item.get("status").and_then(Value::as_str) == Some("cancelled") {
                return None;
            }
            let provider_id = item.get("id").and_then(Value::as_str)?;
            let start_obj = item.get("start")?;
            let end_obj = item.get("end")?;
            let all_day = start_obj.get("dateTime").is_none();
            let start = start_obj
                .get("dateTime")
                .or_else(|| start_obj.get("date"))
                .and_then(Value::as_str)?;
            let end = end_obj
                .get("dateTime")
                .or_else(|| end_obj.get("date"))
                .and_then(Value::as_str)?;
            let start_time = if all_day {
                format!("{start}T00:00:00")
            } else {
                start.to_string()
            };
            let end_time = if all_day {
                format!("{end}T00:00:00")
            } else {
                end.to_string()
            };
            let uid = item
                .get("iCalUID")
                .and_then(Value::as_str)
                .unwrap_or(provider_id)
                .to_string();
            Some(NativeCalendarEvent {
                calendar_event_id: stable_id(CalendarProvider::Google, provider_id),
                uid,
                title: item
                    .get("summary")
                    .and_then(Value::as_str)
                    .unwrap_or("Untitled calendar event")
                    .to_string(),
                start_time,
                end_time,
                location: item
                    .get("location")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                organizer: item
                    .get("organizer")
                    .and_then(|value| value.get("displayName"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                attendee_count: item
                    .get("attendees")
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or(0),
                all_day,
                recurrence_note: None,
                source: CalendarProvider::Google.source().to_string(),
                imported_at: imported_at(),
            })
        })
        .collect()
}

fn normalize_outlook(value: &Value) -> Vec<NativeCalendarEvent> {
    value
        .get("value")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            if item.get("isCancelled").and_then(Value::as_bool) == Some(true) {
                return None;
            }
            let provider_id = item.get("id").and_then(Value::as_str)?;
            let start_obj = item.get("start")?;
            let end_obj = item.get("end")?;
            let start_raw = start_obj.get("dateTime").and_then(Value::as_str)?;
            let end_raw = end_obj.get("dateTime").and_then(Value::as_str)?;
            let start_time =
                normalize_datetime(start_raw, start_obj.get("timeZone").and_then(Value::as_str));
            let end_time =
                normalize_datetime(end_raw, end_obj.get("timeZone").and_then(Value::as_str));
            Some(NativeCalendarEvent {
                calendar_event_id: stable_id(CalendarProvider::Outlook, provider_id),
                uid: item
                    .get("iCalUId")
                    .and_then(Value::as_str)
                    .unwrap_or(provider_id)
                    .to_string(),
                title: item
                    .get("subject")
                    .and_then(Value::as_str)
                    .unwrap_or("Untitled calendar event")
                    .to_string(),
                start_time,
                end_time,
                location: item
                    .get("location")
                    .and_then(|value| value.get("displayName"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                organizer: item
                    .get("organizer")
                    .and_then(|value| value.get("emailAddress"))
                    .and_then(|value| value.get("name"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                attendee_count: item
                    .get("attendees")
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or(0),
                all_day: item
                    .get("isAllDay")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                recurrence_note: None,
                source: CalendarProvider::Outlook.source().to_string(),
                imported_at: imported_at(),
            })
        })
        .collect()
}

async fn fetch_google(
    token: &str,
    request: &CalendarRangeRequest,
) -> Result<Vec<NativeCalendarEvent>, String> {
    let client = reqwest::Client::new();
    let mut page_token: Option<String> = None;
    let mut events = Vec::new();
    loop {
        let mut url =
            reqwest::Url::parse("https://www.googleapis.com/calendar/v3/calendars/primary/events")
                .unwrap();
        url.query_pairs_mut()
            .append_pair("timeMin", &request.start)
            .append_pair("timeMax", &request.end_exclusive)
            .append_pair("singleEvents", "true")
            .append_pair("showDeleted", "false")
            .append_pair("maxResults", "2500")
            .append_pair("orderBy", "startTime")
            .append_pair("fields", "items(id,iCalUID,status,summary,start,end,location,organizer(displayName),attendees),nextPageToken");
        if let Some(page_token) = &page_token {
            url.query_pairs_mut().append_pair("pageToken", page_token);
        }
        let response = client
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| format!("Google Calendar request failed: {error}"))?;
        let status = response.status();
        let value = response
            .json::<Value>()
            .await
            .map_err(|error| format!("Google Calendar response could not be read: {error}"))?;
        if !status.is_success() {
            return Err("Google Calendar rejected the sync. Disconnect and connect again if access was revoked.".to_string());
        }
        events.extend(normalize_google(&value));
        page_token = value
            .get("nextPageToken")
            .and_then(Value::as_str)
            .map(str::to_string);
        if page_token.is_none() {
            break;
        }
    }
    Ok(events)
}

async fn fetch_outlook(
    token: &str,
    request: &CalendarRangeRequest,
) -> Result<Vec<NativeCalendarEvent>, String> {
    let client = reqwest::Client::new();
    let mut url = reqwest::Url::parse("https://graph.microsoft.com/v1.0/me/calendarView").unwrap();
    url.query_pairs_mut()
        .append_pair("startDateTime", &request.start)
        .append_pair("endDateTime", &request.end_exclusive)
        .append_pair("$top", "500")
        .append_pair(
            "$select",
            "id,iCalUId,subject,start,end,location,organizer,attendees,isAllDay,isCancelled",
        );
    let mut events = Vec::new();
    loop {
        let response = client
            .get(url.clone())
            .bearer_auth(token)
            .header("Prefer", "outlook.timezone=\"UTC\"")
            .send()
            .await
            .map_err(|error| format!("Outlook Calendar request failed: {error}"))?;
        let status = response.status();
        let value = response
            .json::<Value>()
            .await
            .map_err(|error| format!("Outlook Calendar response could not be read: {error}"))?;
        if !status.is_success() {
            return Err("Outlook Calendar rejected the sync. Disconnect and connect again if access was revoked.".to_string());
        }
        events.extend(normalize_outlook(&value));
        let Some(next) = value.get("@odata.nextLink").and_then(Value::as_str) else {
            break;
        };
        url = reqwest::Url::parse(next)
            .map_err(|_| "Outlook Calendar returned an invalid continuation URL.".to_string())?;
        if url.scheme() != "https" || url.host_str() != Some("graph.microsoft.com") {
            return Err("Outlook Calendar returned an unsafe continuation URL.".to_string());
        }
    }
    Ok(events)
}

#[cfg(target_os = "macos")]
extern "C" {
    fn weekform_eventkit_fetch(
        start_iso: *const c_char,
        end_iso: *const c_char,
        error_out: *mut *mut c_char,
    ) -> *mut c_char;
    fn weekform_eventkit_free(value: *mut c_char);
}

#[cfg(target_os = "macos")]
fn fetch_apple(request: &CalendarRangeRequest) -> Result<Vec<NativeCalendarEvent>, String> {
    use std::ffi::CString;
    let start = CString::new(request.start.as_str())
        .map_err(|_| "Apple Calendar start date is invalid.".to_string())?;
    let end = CString::new(request.end_exclusive.as_str())
        .map_err(|_| "Apple Calendar end date is invalid.".to_string())?;
    let mut error_ptr: *mut c_char = std::ptr::null_mut();
    let result_ptr =
        unsafe { weekform_eventkit_fetch(start.as_ptr(), end.as_ptr(), &mut error_ptr) };
    if result_ptr.is_null() {
        let message = if error_ptr.is_null() {
            "Apple Calendar could not be read.".to_string()
        } else {
            let value = unsafe { CStr::from_ptr(error_ptr) }
                .to_string_lossy()
                .into_owned();
            unsafe { weekform_eventkit_free(error_ptr) };
            value
        };
        return Err(message);
    }
    let json = unsafe { CStr::from_ptr(result_ptr) }
        .to_string_lossy()
        .into_owned();
    unsafe { weekform_eventkit_free(result_ptr) };
    let raw: Vec<EventKitEvent> = serde_json::from_str(&json)
        .map_err(|_| "Apple Calendar returned invalid event data.".to_string())?;
    let receipt = imported_at();
    Ok(raw
        .into_iter()
        .map(|item| NativeCalendarEvent {
            calendar_event_id: stable_id(CalendarProvider::Apple, &item.provider_id),
            uid: item.uid,
            title: item.title,
            start_time: item.start_time,
            end_time: item.end_time,
            location: item.location,
            organizer: item.organizer,
            attendee_count: item.attendee_count,
            all_day: item.all_day,
            recurrence_note: None,
            source: CalendarProvider::Apple.source().to_string(),
            imported_at: receipt.clone(),
        })
        .collect())
}

#[cfg(not(target_os = "macos"))]
fn fetch_apple(_request: &CalendarRangeRequest) -> Result<Vec<NativeCalendarEvent>, String> {
    Err("Apple Calendar live sync is available only in the macOS app.".to_string())
}

#[tauri::command]
pub fn calendar_source_statuses() -> Result<Vec<CalendarConnectionStatus>, String> {
    [
        CalendarProvider::Outlook,
        CalendarProvider::Google,
        CalendarProvider::Apple,
    ]
    .into_iter()
    .map(|provider| {
        let available = provider.configured();
        let connected = keychain_read(provider)?.is_some();
        let detail = if !available {
            match provider {
                CalendarProvider::Outlook => {
                    "Set MICROSOFT_CALENDAR_CLIENT_ID for this build.".to_string()
                }
                CalendarProvider::Google => {
                    "Set GOOGLE_CALENDAR_CLIENT_ID for this build.".to_string()
                }
                CalendarProvider::Apple => "Apple Calendar live sync requires macOS.".to_string(),
            }
        } else if connected {
            "Live sync is connected; credentials stay in macOS Keychain.".to_string()
        } else {
            "Optional. Connect when you want live metadata sync.".to_string()
        };
        Ok(CalendarConnectionStatus {
            provider,
            available,
            connected,
            detail,
        })
    })
    .collect()
}

#[tauri::command]
pub async fn connect_calendar_source(
    request: CalendarRangeRequest,
) -> Result<Vec<NativeCalendarEvent>, String> {
    request.validate()?;
    match request.provider {
        CalendarProvider::Apple => {
            let events = tauri::async_runtime::spawn_blocking(move || fetch_apple(&request))
                .await
                .map_err(|error| format!("Apple Calendar task failed: {error}"))??;
            keychain_write(
                CalendarProvider::Apple,
                &StoredOAuthToken {
                    refresh_token: "eventkit-permission".to_string(),
                },
            )?;
            Ok(events)
        }
        provider => {
            connect_oauth(provider).await?;
            sync_calendar_source(request).await
        }
    }
}

#[tauri::command]
pub async fn sync_calendar_source(
    request: CalendarRangeRequest,
) -> Result<Vec<NativeCalendarEvent>, String> {
    request.validate()?;
    match request.provider {
        CalendarProvider::Apple => {
            tauri::async_runtime::spawn_blocking(move || fetch_apple(&request))
                .await
                .map_err(|error| format!("Apple Calendar task failed: {error}"))?
        }
        CalendarProvider::Google => {
            let token = refresh_access_token(CalendarProvider::Google).await?;
            fetch_google(&token, &request).await
        }
        CalendarProvider::Outlook => {
            let token = refresh_access_token(CalendarProvider::Outlook).await?;
            fetch_outlook(&token, &request).await
        }
    }
}

#[tauri::command]
pub fn disconnect_calendar_source(provider: CalendarProvider) -> Result<(), String> {
    keychain_delete(provider)
}

#[cfg(test)]
mod tests {
    use super::{normalize_google, normalize_outlook, CalendarProvider, CalendarRangeRequest};
    use serde_json::json;

    #[test]
    fn google_normalization_keeps_only_allowlisted_calendar_metadata() {
        let events = normalize_google(&json!({"items": [{
            "id": "synthetic-google-1", "iCalUID": "uid@example.test", "summary": "Synthetic planning",
            "description": "must not survive", "start": {"dateTime": "2026-07-20T09:00:00-04:00"},
            "end": {"dateTime": "2026-07-20T10:00:00-04:00"}, "attendees": [{"email": "person@example.test"}]
        }]}));
        assert_eq!(events.len(), 1);
        let encoded = serde_json::to_string(&events).unwrap();
        assert!(!encoded.contains("must not survive"));
        assert!(!encoded.contains("person@example.test"));
        assert_eq!(events[0].attendee_count, 1);
    }

    #[test]
    fn outlook_normalization_skips_cancelled_events_and_preserves_utc() {
        let events = normalize_outlook(&json!({"value": [
            {"id":"cancelled","isCancelled":true,"start":{"dateTime":"2026-07-20T09:00:00.0000000","timeZone":"UTC"},"end":{"dateTime":"2026-07-20T10:00:00.0000000","timeZone":"UTC"}},
            {"id":"kept","subject":"Synthetic review","isCancelled":false,"start":{"dateTime":"2026-07-20T09:00:00.0000000","timeZone":"UTC"},"end":{"dateTime":"2026-07-20T10:00:00.0000000","timeZone":"UTC"}}
        ]}));
        assert_eq!(events.len(), 1);
        assert!(events[0].start_time.ends_with('Z'));
    }

    #[test]
    fn native_boundary_rejects_unbounded_calendar_ranges() {
        let request = CalendarRangeRequest {
            provider: CalendarProvider::Google,
            start: "2025-01-01T00:00:00Z".to_string(),
            end_exclusive: "2026-07-21T00:00:00Z".to_string(),
        };
        assert!(request.validate().unwrap_err().contains("366 days"));
    }
}
