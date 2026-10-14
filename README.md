<div align="center">

<img src="build/icon.png" width="84" height="84" alt="Flowplan logo">

# Flowplan Desktop

**Flowplan as an app for macOS, Windows and Linux.**

[Download](https://flowplan.org/download) · [Releases](https://github.com/yannicschuller/flowplan-desktop/releases) · [Flowplan](https://github.com/yannicschuller/flowplan) · [Documentation](https://docs.flowplan.org/operations#desktop-apps)

</div>

A slim [Electron](https://www.electronjs.org/) window around a Flowplan instance – like the desktop apps of Notion or Slack. All data stays on the server; the app remembers the address and the window, has native menus, opens links to other sites in the default browser, shows its own page without a connection and updates itself. Offline use, notifications and keyboard shortcuts of the web app work unchanged.

Flowplan itself – every new feature – arrives with the server and needs no app update. This app only changes when the window around it does.

## Download

[flowplan.org/download](https://flowplan.org/download) detects your system and starts the download of the latest version. All files are in the [latest release](https://github.com/yannicschuller/flowplan-desktop/releases/latest):

| System | File | Architectures |
| --- | --- | --- |
| macOS 12 or newer | `Flowplan-<version>-mac.dmg` (`.zip` for updates) | Apple Silicon and Intel in one app |
| Windows 10 or newer | `Flowplan-<version>-windows-setup.exe`, or the `.zip` without installing | x64 and ARM in one installer |
| Linux | `Flowplan-<version>-linux-<arch>.AppImage`, or the `.tar.gz` | x64 and ARM |

On first start the app always asks for the address of the Flowplan instance, suggesting `https://app.flowplan.org` (HTTPS; `http://localhost` for local tests). Change it via the menu **Server wechseln …**. Managed installations suggest their own address with `--server=<URL>` or the environment variable `FLOWPLAN_SERVER`; the first start still shows it for confirmation.

The app only accepts a real Flowplan instance: its health check (`/api/health`) must answer as Flowplan, and the address must not redirect to another site.

While the apps are not signed, macOS asks on first opening (right-click → **Open**), Windows shows SmartScreen (**More info → Run anyway**), and AppImages need to be made executable (`chmod +x Flowplan-*.AppImage`).

## Signing in with passkeys and SSO

Passkeys (iCloud Keychain, Windows Hello, password managers) and identity providers that ask for one only work in a real browser. In the app, **Mit Passkey anmelden** and **Mit SSO anmelden** therefore open the sign-in in the default browser:

1. The app creates a random secret and opens the instance with its hash (`/api/auth/desktop`).
2. You sign in in the browser as usual and confirm **In der Desktop-App anmelden**.
3. The browser opens `flowplan://sign-in` with a one-time code; the app redeems it with its secret and is signed in.

The code is valid for one minute, works once and only together with the secret that never leaves the app – a link caught elsewhere is useless, and the app ignores codes for sign-ins it did not start or for another instance. E-mail and password sign in directly in the app. This needs a Flowplan server newer than 0.3.2.

## Updates

The app checks the latest release of this repository 15 seconds after starting, every six hours and via **Nach Updates suchen …** in the menu ([`updates.js`](updates.js), [electron-updater](https://www.electron.build/auto-update)):

| Installed as | What happens |
| --- | --- |
| Windows installer | Downloads in the background; a dialog offers **Jetzt neu starten**, otherwise it installs on the next start. |
| Linux AppImage | The same – the AppImage replaces itself. |
| macOS, signed | The same. |
| macOS unsigned, Windows ZIP, Linux `.tar.gz` | A dialog names the new version and opens [flowplan.org/download](https://flowplan.org/download). macOS only lets signed apps replace themselves. |

Updates are found through the files `latest-mac.yml`, `latest.yml` (Windows) and `latest-linux*.yml` that every release carries, next to `.blockmap` files for smaller downloads. Without a connection the check stays quiet and tries again later. `FLOWPLAN_UPDATE_URL` points the app to another source – a folder with the same files, for example a mirror inside a company network.

## Signing

Releases are unsigned until the repository has these secrets (Settings → Secrets and variables → Actions):

| Secret | For |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | macOS: Developer ID Application certificate (`.p12`, base64 or a URL) and its password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code signing certificate |

With `CSC_LINK` set, the release workflow marks the macOS app as signed (`build/update.json`) and it updates itself like on Windows.

## Releasing

**Actions → Release → Run workflow** (patch, minor or major):

1. raises the version in `package.json`, commits it on `main` and tags `v1.2.3`,
2. creates the release as a draft,
3. builds macOS, Windows and Linux on GitHub's runners and attaches the apps and the update files,
4. publishes the release once every system is attached.

If a build fails, run the workflow again with **rebuild** set to the version (e.g. `1.0.1`): it builds that version again and completes its draft release instead of raising the version.

Installed apps find the new version within six hours; the download page offers it right away. CI (`ci.yml`) checks every push with a syntax check and a Linux test build. Jobs of this repository run on the self-hosted runner; Dependabot and pull requests from forks use GitHub's runners.

## Development

Node.js 22 or newer.

```sh
npm ci
npm start                  # the app against any instance
npm run check              # syntax check
npm run dist:mac           # DMG and ZIP (universal), only on macOS
npm run dist:win           # installer and ZIP (x64 and ARM)
npm run dist:linux         # AppImage and tar.gz (x64 and ARM)
```

The results are in `dist/`. Tests against a packaged app:

```sh
npx electron-builder --mac zip --arm64 --publish never
FLOWPLAN_APP="$PWD/dist/mac-arm64/Flowplan.app/Contents/MacOS/Flowplan" npm run test:smoke -- https://your-instance.example
FLOWPLAN_APP="$PWD/dist/mac-arm64/Flowplan.app/Contents/MacOS/Flowplan" npm run test:update
```

`test:smoke` checks setup, loading, the offline page, a suggested address, that other servers are refused and the sign-in through the browser (the latter with the development sign-in of a local instance); `test:update` offers the app a newer version from a local source and checks that it is found and offered.

Why Electron and not Tauri: Electron ships the same Chromium everywhere, the browser Flowplan is developed and tested in (service worker, IndexedDB, editor). Tauri uses the system's web views (WebKit on macOS, WebView2 on Windows) and needs a Rust toolchain; the app would be much smaller (~10 MB instead of ~110 MB).

## License

[GNU Affero General Public License v3.0](LICENSE), like Flowplan.
