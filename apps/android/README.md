# Focus Android

Native Android client for Focus.

## Development

```sh
./apps/android/gradlew -p apps/android :app:assembleDebug
```

The debug build defaults to `http://10.0.2.2:3001`, which reaches a local server
from the Android emulator. Change the server URL in Settings for physical
devices or deployed Railway environments.

For a physical device while keeping Focus private, install Tailscale on the
computer and phone, then enter `http://<computer-tailscale-ip>:3001` on the
Android sign-in screen. The Focus server must be running on the computer. No
router ports need to be opened. A normal LAN address such as
`http://192.168.1.20:3001` also works while both devices are on the same Wi-Fi.

Android builds require JDK 17 and an Android SDK with API 35 installed. The APK
is written to `apps/android/app/build/outputs/apk/debug/app-debug.apk`.

On Apple Silicon with Homebrew's keg-only JDK, configure the current shell once
before running the build:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

Firebase push is optional during development. Add a normal
`app/google-services.json` when enabling FCM on a Firebase project.
