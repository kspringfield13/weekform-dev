# Google Chat and Webex connection setup

Weekform for Mac now accepts each provider's public connection details directly
in **Settings → Data Sources → Chat**. Public values are saved in macOS Keychain.
Never paste a Client Secret into the desktop app.

## Google Chat

1. In [Google Cloud credentials](https://console.cloud.google.com/apis/credentials),
   enable the Google Chat API and configure the OAuth consent screen.
2. Request only Weekform's user scopes:
   `openid`, `chat.spaces.readonly`, and `chat.messages.readonly`.
   Google classifies `chat.messages.readonly` as restricted, so production use
   may require Google's verification process.
3. Create an OAuth client whose application type is **Desktop app**.
4. Copy its public Client ID, ending in `.apps.googleusercontent.com`.
5. Paste it into the Google Chat row and choose **Save and review access**.

Weekform opens the system browser, creates a unique PKCE verifier/challenge, and
listens on a temporary loopback callback. Token exchange and refresh happen
directly between the Mac and Google. The Client Secret is not required by this
desktop setup and must not be pasted into Weekform.

Official references: [OAuth for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
and [Google Chat authorization](https://developers.google.com/workspace/chat/authenticate-authorize).

## Webex

1. Create or open an integration in [Webex for Developers](https://developer.webex.com/my-apps).
2. Register this exact redirect URI:

   ```text
   http://127.0.0.1:49323/chat-auth/callback
   ```

3. Grant the four scopes used by Weekform:
   `spark:rooms_read`, `spark:messages_read`, `spark:people_read`, and
   `spark:kms`.
4. In Weekform, paste the public Client ID, confirm the exact redirect URI, and
   enter the public HTTPS base for the Weekform token broker, such as
   `https://weekform.dev/api`. Weekform appends `/oauth/webex/token`.
5. Choose **Save and review access**.

The Webex Client Secret belongs only in the broker deployment as
`WEBEX_CHAT_CLIENT_SECRET`. The broker and native release must use matching
`WEBEX_CHAT_CLIENT_ID` and `WEBEX_CHAT_REDIRECT_URI` values. The native connector
remains locked until the deployed request controls and credential-safe logging
have been verified and `WEBEX_CHAT_BROKER_SECURITY_VERIFIED=true` is set in the
release environment. The desktop form cannot set or bypass that attestation.

See [apps/web/README.md](../apps/web/README.md) for the broker's complete
deployment and request-control checklist, and the official
[Webex integration guide](https://developer.webex.com/docs/integrations) for
provider registration.

## Optional build defaults

Maintainers can still provide the public values through `.env` or release
configuration:

```dotenv
GOOGLE_CHAT_CLIENT_ID=
WEBEX_CHAT_CLIENT_ID=
WEBEX_CHAT_REDIRECT_URI=http://127.0.0.1:49323/chat-auth/callback
WEEKFORM_CHAT_OAUTH_BROKER_URL=
```

User-entered Keychain values take precedence over these optional defaults.
Changing connection details requires disconnecting the provider first. Reset
Local Data removes saved public details together with Chat tokens and cursors.
