# Android client

Focus includes a native Android client in `apps/android`. It talks to the same
Focus server as the desktop client, so tasks and account data remain shared.

## Local setup

Start the local dependencies and API from the repository root:

```sh
docker compose up -d
cp apps/server/.env.example apps/server/.env
# Set JWT_SECRET in apps/server/.env
pnpm dev:server
```

Build the debug APK with JDK 17 and Android SDK API 35:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
pnpm android:build
```

The output is `apps/android/app/build/outputs/apk/debug/app-debug.apk`.

## Connecting a physical phone

The Android emulator uses `http://10.0.2.2:3001` by default. A physical phone
must use an address reachable from the phone:

- Same Wi-Fi: `http://<computer-lan-ip>:3001`.
- Private remote access: `http://<computer-tailscale-ip>:3001` with Tailscale
  installed on both devices.
- Deployed server: the HTTPS URL of the Focus API.

The server listens on `0.0.0.0:3001`, and the Android sign-in screen accepts the
server URL. The URL is validated and saved before login or account creation, so
switching from the emulator to a phone does not use a stale endpoint.

## Current scope

The client supports authentication, task sync, offline capture replay, task
updates, subtasks, notes, image attachments, suggestions, memory, integrations,
WebSocket updates, and optional Firebase notifications. Firebase remains
optional for local development.
