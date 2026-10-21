<div align="center">

<img src="build/icon.png" width="84" height="84" alt="Flowplan logo">

# Flowplan Desktop

**Flowplan as an app for macOS, Windows and Linux.**

[Download](https://flowplan.org/download) · [Releases](https://github.com/yannicschuller/flowplan-desktop/releases) · [Flowplan](https://github.com/yannicschuller/flowplan) · [Documentation](https://docs.flowplan.org/operations#desktop-apps)

</div>

A slim [Electron](https://www.electronjs.org/) window around a Flowplan instance – like the desktop apps of Notion or Slack. All data stays on the server; the app remembers the address and the window, has native menus (in German, English or French, following the system language), opens links to other sites in the default browser, shows its own page without a connection and updates itself. Voice notes work: the instance may use the microphone (never the camera or the screen). Offline use, notifications and keyboard shortcuts of the web app work unchanged: with **Settings → Data → Offline use** switched on in the app, it opens the stored copy from the instance's service worker without a connection, and its own offline page only appears when there is no copy ([`fallback.js`](fallback.js)).

Flowplan itself – every new feature – arrives with the server and needs no app update. This app only changes when the window around it does.

## Download

[flowplan.org/download](https://flowplan.org/download) detects your system and starts the download of the latest version. All files are in the [latest release](https://github.com/yannicschuller/flowplan-desktop/releases/latest):

| System | File | Architectures |
| --- | --- | --- |
| macOS 12 or newer | `Flowplan-<version>-mac.dmg` (`.zip` for updates) | Apple Silicon and Intel in one app |
| Windows 10 or newer | `Flowplan-<version>-windows-setup.exe`, or the `.zip` without installing | x64 and ARM in one installer |
| Linux | `Flowplan-<version>-linux-<arch>.AppImage`, or the `.tar.gz` | x64 and ARM |

On first start the app always asks for the address of the Flowplan instance, suggesting `https://app.flowplan.org` (HTTPS; `http://localhost` for local tests). Change it via the menu **Server wechseln …**. Managed installations suggest their own address with `--server=<URL>` or the environment variable `FLOWPLAN_SERVER`; the first start still shows it for confirmation.

The app only accepts a real Flowplan instance: its health check (`/api/health`) must answer as Flowplan, and the address must not redirect to another site. The setup page tells apart an address that cannot be reached, a proxy or VPN that asks for a sign-in first (HTTP 401/403), a server error, a web page that is something else and a server without Flowplan.

Only the app's own pages (setup, offline, sign-in) can talk to the app: the bridge `window.flowplanDesktop` exists on `file:` pages alone, every call is checked against the page it comes from ([`guards.js`](guards.js)), and only the instance itself, its sign-in and the identity provider it hands over to may open inside the window – any other address goes to the browser, even one that merely contains `/api/auth/`.

While the apps are not signed and notarized, macOS blocks the first launch: from macOS 15 allow it under **System Settings → Privacy & Security → Open Anyway** (up to macOS 14, right-click → **Open** is enough); if macOS says the app is "damaged", `xattr -dr com.apple.quarantine /Applications/Flowplan.app` removes the quarantine flag. Signing and notarization (below) make this go away. Windows shows SmartScreen (**More info → Run anyway**), and AppImages need to be made executable (`chmod +x Flowplan-*.AppImage`).

## Signing in with passkeys and SSO

Passkeys (iCloud Keychain, Windows Hello, password managers) and identity providers that ask for one only work in a real browser. In the app, **Mit Passkey anmelden** and **Mit SSO anmelden** therefore open the sign-in in the default browser:

1. The app creates a random secret and opens the instance with its hash (`/api/auth/desktop`). A small window **Weiter im Browser** / **Continue in the browser** waits in the app.
2. You sign in in the browser as usual and confirm **In der App anmelden** / **Sign in to the app**.
3. The browser opens `flowplan://sign-in` with a one-time code; the app redeems it with its secret and is signed in.

If the browser cannot hand the link to the app, copy the link behind **Flowplan-App öffnen** / **Open the Flowplan app** on the browser's last page (right-click → Copy link address) and paste it into the waiting window (**Code einfügen** / **Paste code**); the bare code from that link works too. This is needed on **Linux** when `flowplan://` is not registered: the AppImage and the `.tar.gz` do not install a `.desktop` file by themselves. To register the link type once, integrate the AppImage (AppImageLauncher, `appimaged`, or Gear Lever), or install the desktop file by hand – it is inside the AppImage as `flowplan.desktop` with `MimeType=x-scheme-handler/flowplan` – and run

```sh
xdg-mime default flowplan.desktop x-scheme-handler/flowplan
```

macOS and Windows register the link type when the app is installed.

The code is valid for one minute, works once and only together with the secret that never leaves the app – a link caught elsewhere is useless, and the app ignores codes for sign-ins it did not start or for another instance. E-mail and password sign in directly in the app. This needs a Flowplan server newer than 0.3.2.

## Updates

The app checks the latest release of this repository 15 seconds after starting, every six hours and via **Nach Updates suchen …** in the menu ([`updates.js`](updates.js), [electron-updater](https://www.electron.build/auto-update)):

| Installed as | What happens |
| --- | --- |
| Windows installer | Downloads in the background; a dialog offers **Jetzt neu starten**, otherwise it installs on the next start. |
| Linux AppImage | The same – the AppImage replaces itself. |
| macOS, signed | The same. |
| macOS unsigned, Windows ZIP, Linux `.tar.gz` | A dialog names the new version and opens [flowplan.org/download](https://flowplan.org/download). macOS only lets signed apps replace themselves. |

Updates are found through the files `latest-mac.yml`, `latest.yml` (Windows) and `latest-linux*.yml` that every release carries, next to `.blockmap` files for smaller downloads. Without a connection the check stays quiet and tries again later. `FLOWPLAN_UPDATE_URL` points the app to another source – a folder with the same files, for example a mirror inside a company network. It must start with `https://` (`http://` only for `localhost`, used by `test:update`); anything else is ignored, and the update dialogs always name the source they used.

### Trust model of unsigned builds

Until the certificates below exist, a downloaded update is verified only by the SHA-512 in the release feed (`latest*.yml`), fetched over HTTPS from GitHub Releases (or the `https://` mirror in `FLOWPLAN_UPDATE_URL`). There is no code signature to check, so whoever can publish a release of this repository – or whoever controls the mirror – can ship any code to every installed app. Treat the release workflow, the self-hosted runner that runs its `version` and `publish` jobs and the repository's write access accordingly. With `WIN_CSC_LINK` set, electron-updater additionally checks the Windows update's signature against the publisher; with `CSC_LINK`, macOS only installs updates signed by the same team.

## Signing

Releases are unsigned until the repository has these secrets (Settings → Secrets and variables → Actions):

| Secret | For |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | macOS: Developer ID Application certificate (`.p12`, base64 or a URL) and its password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code signing certificate |

With `CSC_LINK` set, the release workflow marks the macOS app as signed (`build/update.json`) and it updates itself like on Windows.

### macOS: no more quarantine warning

Browsers mark every download with `com.apple.quarantine`; Gatekeeper then opens the app without asking only if it is signed with a **Developer ID** and **notarized** by Apple. electron-builder does both (and staples the ticket) as soon as the secrets above are set:

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) (99 USD a year, as a person or an organisation).
2. On a Mac: Xcode → Settings → Accounts → Manage Certificates → **+** → **Developer ID Application** (or create it under Certificates on developer.apple.com).
3. In Keychain Access, export that certificate together with its private key as `.p12` with a password. `base64 -i developer-id.p12 | pbcopy` → secret `CSC_LINK`; the password → `CSC_KEY_PASSWORD`.
4. On [account.apple.com](https://account.apple.com) → Sign-In and Security → **App-Specific Passwords**, create one → `APPLE_APP_SPECIFIC_PASSWORD`; your Apple ID e-mail → `APPLE_ID`; the Team ID (Membership details on developer.apple.com) → `APPLE_TEAM_ID`.
5. Run **Actions → Release**. Check a download with `spctl -a -vv /Applications/Flowplan.app` – it should say `accepted, source=Notarized Developer ID`.

Windows has the same with SmartScreen: a code signing certificate (`WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`) removes the warning once the certificate has gathered reputation with Microsoft.

## Releasing

**Actions → Release → Run workflow** (patch, minor or major):

1. raises the version in `package.json`, commits it on `main` and tags `v1.2.3`,
2. creates the release as a draft,
3. builds macOS, Windows and Linux on GitHub's runners and attaches the apps and the update files,
4. publishes the release once every system is attached.

If a build fails, run the workflow again with **rebuild** set to the version (e.g. `1.0.1`): it builds that version again and completes its draft release instead of raising the version.

Installed apps find the new version within six hours; the download page offers it right away. CI (`ci.yml`) checks every push with a syntax check, the tests without a network (`test:security`, and `test:offline` under `xvfb-run` where it is installed), that the installed Electron is one of the three majors Electron still patches (anything older than `latest − 2` fails) and a Linux test build. CI jobs run on the self-hosted runner, Dependabot and pull requests from forks on GitHub's runners; the release workflow is dispatched by maintainers only and runs on the self-hosted runner.

## Development

Node.js 22 or newer.

```sh
npm ci
npm start                  # the app against any instance
npm run check              # syntax check
npm test                   # security guards (Node only) and offline use (Linux without a display: xvfb-run -a npm test)
npm run test:security      # guards alone: bridge, navigation, permissions, update source, health check, languages
npm run dist:mac           # DMG and ZIP (universal), only on macOS
npm run dist:win           # installer and ZIP (x64 and ARM)
npm run dist:linux         # AppImage and tar.gz (x64 and ARM)
```

The results are in `dist/`. Tests against a packaged app:

```sh
npx electron-builder --mac zip --arm64 --publish never
FLOWPLAN_APP="$PWD/dist/mac-arm64/Flowplan.app/Contents/MacOS/Flowplan" npm run test:smoke -- https://your-instance.example
FLOWPLAN_APP="$PWD/dist/mac-arm64/Flowplan.app/Contents/MacOS/Flowplan" npm run test:update
FLOWPLAN_APP="$PWD/dist/mac-arm64/Flowplan.app/Contents/MacOS/Flowplan" npm run test:offline
```

`test:security` ([`test/security.mjs`](test/security.mjs), Node alone, no network) checks the guards: the bridge is absent on anything but the app's own pages, `https://evil.example/api/auth/x` opens in the browser while `<server>/api/auth/x` stays in the window, only the microphone alone is granted, `http://` update sources are refused, the health check's verdicts and that every string exists in all three languages. `test:smoke` checks setup, loading, the offline page, a suggested address, that other servers are refused and the sign-in through the browser (the latter with the development sign-in of a local instance); `test:update` offers the app a newer version from a local source and checks that it is found and offered; `test:offline` (with `test:security` also `npm test`, no instance needed) checks that the window offers what offline use needs, that the instance has no bridge, and that without a connection the copy stored by the service worker opens – also after a failed page of the instance – and the offline page only without a copy.

The app's own words live in [`strings.js`](strings.js) (German, English, French; English for other languages), chosen by `app.getLocale()`; the pages in `pages/` get the language in their address and fill `data-i18n` attributes.

Why Electron and not Tauri: Electron ships the same Chromium everywhere, the browser Flowplan is developed and tested in (service worker, IndexedDB, editor). Tauri uses the system's web views (WebKit on macOS, WebView2 on Windows) and needs a Rust toolchain; the app would be much smaller (~10 MB instead of ~110 MB).

## License

[GNU Affero General Public License v3.0](LICENSE), like Flowplan.
