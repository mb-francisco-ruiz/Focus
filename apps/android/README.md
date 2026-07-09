# Focus Android

Native Android client for Focus.

## Development

```sh
cd apps/android
gradle :app:assembleDebug
```

The debug build defaults to `http://10.0.2.2:3001`, which reaches a local server
from the Android emulator. Change the server URL in Settings for physical
devices or deployed Railway environments.

Firebase push is optional during development. Add a normal
`app/google-services.json` when enabling FCM on a Firebase project.
