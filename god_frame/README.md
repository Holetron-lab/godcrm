# GOD Frame

Custom Flutter app for Brilliant Frame AR glasses integrated with GOD CRM.

## Features

- **Auth**: Login with GOD CRM email/password or API key
- **AI Chat**: Full conversation interface with @agent mentions
- **Frame BLE**: Connect to Brilliant Frame glasses via Bluetooth
- **Voice Mode**: Tap glasses to capture audio + photo, get AI response displayed on glasses

## Architecture

```
GOD Frame App (Flutter)
  ├── Auth → GOD CRM /api/v3/auth/login (JWT)
  ├── Chat → GOD CRM /api/v3/chat/* (conversations + messages)
  ├── Frame → Brilliant Frame (BLE via frame_ble SDK)
  └── Voice → GOD CRM /api/v3/frame/noa (multimodal AI)
```

## Setup

1. Install Flutter SDK (>=3.16.0)
2. Clone this repo
3. Run `flutter pub get`
4. For Frame hardware support, uncomment `frame_ble` and `frame_msg` in `pubspec.yaml`
5. Run `flutter run`

## Configuration

On the login screen, tap "Server Settings" to set the CRM backend URL:
- Production: `https://crm.hltrn.cc`
- Development: `https://devcrm.hltrn.cc`

## ADR

See [ADR-106](../docs/architecture/ADR-106-GOD-FRAME-FLUTTER-APP.md) for architecture details.

## iOS build (Mac only)

Prerequisites:
- macOS 13+, Xcode 15+
- Apple Developer account added in Xcode → Settings → Accounts
- Cocoapods 1.14+ (`sudo gem install cocoapods`)
- Flutter 3.16+

First-time setup:
1. `cd god_frame && flutter pub get`
2. Download `GoogleService-Info.plist` from Google Cloud Console (iOS OAuth client for `cc.hltrn.godframe`)
3. Drag into `ios/Runner/` in Xcode (do NOT commit — already in .gitignore)
4. Copy the `REVERSED_CLIENT_ID` value into `ios/Runner/Info.plist` `CFBundleURLTypes`
5. `cd ios && pod install`
6. `flutter run -d <iphone-udid>`

TestFlight upload:
1. `flutter build ipa --release`
2. Open `build/ios/archive/Runner.xcarchive` in Xcode → Distribute App → App Store Connect → Upload

See [ADR-0027](../docs) for the full 8-phase plan, plugin matrix, and risks.
