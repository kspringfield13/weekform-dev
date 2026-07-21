# Slack desktop app setup

Weekform uses Slack's public-client authorization-code flow with PKCE. It asks
only for user scopes, exchanges and refreshes tokens directly from the native
Mac process without a client secret, and stores the rotating refresh token in
macOS Keychain.

## Create the Slack app

1. Open [Your Apps](https://api.slack.com/apps), choose **Create New App**, then
   choose **From a manifest**.
2. Select the development workspace.
3. Paste [`slack-app-manifest.yaml`](slack-app-manifest.yaml) into the YAML
   editor, review the requested user scopes, and create the app.
4. In **Basic Information → App Credentials**, copy the **Client ID**. Do not
   copy the Client Secret into Weekform; the desktop PKCE flow does not use it.

Enabling PKCE marks the Slack app as a public client and is a one-way setting.
The manifest also enables token rotation. New Slack access tokens expire after
12 hours, refresh tokens are single-use and rotate on refresh, and refresh
tokens issued to a PKCE-enabled app expire after 30 days.

## Configure Weekform for Mac

Open **Settings → Data Sources → Chat** in the native Mac app. In the Slack row,
paste the public Client ID and choose **Save and review access**. Weekform saves
the ID locally in macOS Keychain, refreshes connector readiness, and opens the
existing access-review step before browser authorization.

The field accepts the numeric public identifier only. It does not accept or
request a Client Secret. You can change the Client ID while Slack is
disconnected; disconnect first if an authorization is already saved.

Maintainers can optionally provide a default for local source runs or packaged
builds with the same public environment value:

```dotenv
SLACK_CHAT_CLIENT_ID=1234567890.1234567890123
```

Never add a Slack Client Secret to the desktop build, `.env.example`, or source
control.

After access review, Weekform opens the system browser and returns to the exact
registered loopback callback:

```text
http://localhost:49324/chat-auth/callback
```

The Slack app begins in its selected development workspace. To authorize from
other workspaces, complete Slack's distribution setup; Marketplace publication
and live multi-workspace behavior are separate release checks.
