<div align="center">

<img src="build/icon.png" width="84" height="84" alt="Flowplan logo">

# Flowplan Desktop

**Flowplan as an app for macOS, Windows and Linux.**

[Download](https://flowplan.org/download) · [Releases](https://github.com/yannicschuller/flowplan-desktop/releases) · [Flowplan](https://github.com/yannicschuller/flowplan) · [Documentation](https://docs.flowplan.org/operations#desktop-apps)

</div>

A slim [Electron](https://www.electronjs.org/) window around a Flowplan instance – like the desktop apps of Notion or Slack. All data stays on the server; the app remembers the addresses (several instances as [profiles](#profiles)) and the window, has native menus (in German, English or French, following the system language), opens links to other sites in the default browser, shows its own page without a connection and updates itself. It shows [notifications](#notifications) of the inbox as system notifications with the unread count on the app icon – also while the window is minimised or hidden. Around the window: a [right-click menu](#right-click-menu-and-spelling) with spelling suggestions, [quick capture](#quick-capture) from any app with a global shortcut, a [tray or menu bar icon](#tray-and-menu-bar-icon) with today's tasks, [`flowplan://` links](#links-to-pages-flowplan) to pages, [pages in windows of their own](#pages-in-windows-of-their-own), [files dropped on the app](#files-dropped-on-the-app), [launch at login](#launch-at-login), [printing and PDFs](#printing-and-pdf) and [updates](#updates) that show their progress without interrupting. Voice notes work: the instance may use the microphone (never the camera or the screen). Offline use and keyboard shortcuts of the web app work unchanged: with **Settings → Data → Offline use** switched on in the app, it opens the stored copy from the instance's service worker without a connection, and its own offline page only appears when there is no copy ([`fallback.js`](fallback.js)).

Flowplan itself – every new feature – arrives with the server and needs no app update. This app only changes when the window around it does.

## Download

[flowplan.org/download](https://flowplan.org/download) detects your system and starts the download of the latest version. All files are in the [latest release](https://github.com/yannicschuller/flowplan-desktop/releases/latest):

| System | File | Architectures |
| --- | --- | --- |
| macOS 12 or newer | `Flowplan-<version>-mac.dmg` (`.zip` for updates) | Apple Silicon and Intel in one app |
| Windows 10 or newer | `Flowplan-<version>-windows-setup.exe`, or the `.zip` without installing | x64 and ARM in one installer |
| Linux | `Flowplan-<version>-linux-<arch>.AppImage`, or the `.tar.gz` | x64 and ARM |

On first start the app always asks for the address of the Flowplan instance, suggesting `https://app.flowplan.org` (HTTPS; `http://localhost` for local tests). More instances are added as profiles (below). Managed installations suggest their own address with `--server=<URL>` or the environment variable `FLOWPLAN_SERVER`; the first start still shows it for confirmation.

The app only accepts a real Flowplan instance: its health check (`/api/health`) must answer as Flowplan, and the address must not redirect to another site. The setup page tells apart an address that cannot be reached, a proxy or VPN that asks for a sign-in first (HTTP 401/403), a server error, a web page that is something else and a server without Flowplan.

Only the app's own pages (setup, profiles, offline, sign-in, settings, quick capture, the update toast) can talk to the app: the bridge `window.flowplanDesktop` exists on `file:` pages alone, every call is checked against the page it comes from ([`guards.js`](guards.js)). The instance itself gets one tiny bridge, `window.FlowplanDesktop`, on the pages of the window profile's own origin only, answered only for the main frame of that origin in that profile's session: `platform`, `version`, `notifications.enabled()` / `setEnabled()` / `refresh()`, `spelling.check(word)` (answered by the spell checker inside the page, no message to the app) and `spelling.addWord(word)` (one word, checked again), and `openWindow(url)` (a page of the same instance, never an endpoint or another site). It cannot read files, open other sites in the window or hand anything but `http(s)`/`mailto` addresses to the system. Files dropped on the window that the page does not take itself reach the app only from real drops by the person (`isTrusted`, paths from the disk), and nothing is read before the person confirmed where they go. And only the active profile's instance, its sign-in and the identity provider it hands over to may open inside the window – any other address goes to the browser, even one that merely contains `/api/auth/` or belongs to another profile.

## Profiles

The app can keep several instances, for example **Work – flowplan.company.com** and **Private – notes.example** ([`profiles.js`](profiles.js)):

| | |
| --- | --- |
| **Switch** | Menu **Profile** / **Profiles** (in the *Flowplan* menu on macOS, under *File* on Windows and Linux), **Nächstes Profil** / **Next Profile** with ⇧⌘P or Ctrl+Shift+P, the Dock menu on macOS, the jump list on Windows, or `--profile=<id or name>` on the command line (Linux launchers, scripts). |
| **Add** | **Profil hinzufügen …** / **Add Profile…**: address and an optional name (default: the host). The address is checked like on first start. Two profiles may point to the same instance, e.g. for two accounts. |
| **Rename, remove** | **Profile verwalten …** / **Manage Profiles…**, also reachable from the offline page. Removing asks first, signs out of the instance and deletes everything the profile stored on this computer. |

Each profile has its **own Electron session** (partition `persist:profile-<id>`): cookies, the service worker's offline copy, IndexedDB and caches never mix, not even for two profiles on the same instance. A sign-in through the browser that was started in one profile is dropped when you switch, the window only lets the active profile's instance (and its identity provider) in, and permissions are granted only to the instance of the profile that owns the session. With more than one profile the window title names the active one.

`config.json` keeps `profiles` and `activeProfile`. The single address of version 1.0.4 and older becomes the first profile automatically and keeps the default session, so you stay signed in and the offline copy remains; `server` still mirrors the active profile for older versions. Everything read from the file is checked again: only `http(s)` origins, plain ids, and the session is derived from the id, never taken from the file.

While the apps are not signed and notarized, macOS blocks the first launch: from macOS 15 allow it under **System Settings → Privacy & Security → Open Anyway** (up to macOS 14, right-click → **Open** is enough); if macOS says the app is "damaged", `xattr -dr com.apple.quarantine /Applications/Flowplan.app` removes the quarantine flag. Signing and notarization (below) make this go away. Windows shows SmartScreen (**More info → Run anyway**), and AppImages need to be made executable (`chmod +x Flowplan-*.AppImage`).

## Notifications

Flowplan delivers system notifications through Web Push, which Electron does not have (there is no push service behind `pushManager.subscribe`). The app therefore asks the instance itself, like the desktop apps of Slack or Notion ([`notifier.js`](notifier.js), decisions in [`notifications.js`](notifications.js)):

| | |
| --- | --- |
| **What is asked** | `GET /api/notifications` of the profile's own instance (Flowplan newer than 0.6.0), with the profile's own session – its cookies, no token, nothing new stored on the server. The answer is what the inbox shows: the line in your language, the record title, where it leads, the unread count and whether **push** is on for that kind in **Settings → Notifications** – only those kinds pop up, all unread ones count on the badge. |
| **When** | Every minute while the app runs – also with the window minimised or hidden, and on macOS after closing the window, as long as the app stays in the Dock. After errors it waits longer (doubling up to 15 minutes), every 5 minutes while signed out, every 30 minutes against an older instance without the endpoint. It pauses while the computer sleeps or is offline and asks again on waking. The web app asks for a quick update after every change (reading a notification clears the badge within seconds). Flowplan's inbox has no live channel of its own (it polls too), so there is nothing faster to listen to. |
| **What shows** | Each new unread notification once: the inbox line as title, the record (and with several profiles the profile name) below – no more than the inbox shows. More than three at once become one notification that opens the inbox. Nothing pops up for the profile whose window is in front (its inbox is in view). What was there before the first answer – a new profile, a new installation – only becomes known; the ids seen are kept per profile in `config.json` (`notificationState`), so a restart shows nothing twice. |
| **Click** | Brings the window to the front, switches to the notification's profile if needed and opens its page. Only an address of that profile's own instance is opened; anything else leads to the instance's start page. |
| **Badge** | The unread count of the watched profiles: on the Dock icon (macOS), the launcher (Linux, where the desktop supports counts, e.g. Unity or KDE) and as a red dot on the taskbar button with the count as its description (Windows). It clears at 0. |
| **Settings** | Menu **Mitteilungen** / **Notifications** (in the *Flowplan* menu on macOS, under *File* on Windows and Linux): **Mitteilungen anzeigen** / **Show Notifications** (on by default; off stops asking and clears the badge), **Nicht stören** / **Do Not Disturb** for one hour or until 8 o'clock tomorrow (keeps asking and updating the badge, but shows nothing – also not afterwards), and **Alle Profile** / **All Profiles** (default: the active profile only). Saved in `config.json` (`notifications`). In the app, **Settings → Notifications** of the web app shows that the desktop app handles notifications, with the same on/off switch, instead of Web Push. |

Windows and Linux keep their behaviour: closing the window quits the app, so notifications arrive while it runs (minimised is fine) – unless the [tray icon](#tray-and-menu-bar-icon) is switched on, which keeps the app running without a window. On Windows, notifications need the app's id (`app.flowplan.desktop`), which the installer gives its shortcut; the ZIP without installing may show none. `FLOWPLAN_NOTIFICATION_INTERVAL=<seconds>` (at least 2) scales every wait, for tests and managed installations.

## Handoff (macOS)

The window offers the page it shows to your iPad and iPhone (and other Macs) – same Apple Account, Handoff on in the system settings: the Flowplan icon in the iPad's Dock or app switcher opens the page in the Flowplan app, without the app the device's browser opens it. The other way round, a page open in the iPad or iPhone app appears on the Mac's Dock and opens here – in the profile of its instance (the window switches profile like a clicked notification); pages of an instance without a profile open in the browser. Only pages of the profile's own instance are offered, never the app's own pages or `/api/` addresses ([`handoff.js`](handoff.js), activity type `app.flowplan.page`, declared under `NSUserActivityTypes` in `package.json` → `build.mac.extendInfo`).

Handoff works only between apps of the **same Apple Developer team**: the signed releases (Developer ID of team `V7N2K54KJN`, the team of the iOS app) – not `npm start` or unsigned builds. Should macOS not offer the app's pages although both are signed, add a Developer ID provisioning profile for `app.flowplan.desktop` (`mac.provisioningProfile`) and the entitlements `com.apple.application-identifier` = `V7N2K54KJN.app.flowplan.desktop` and `com.apple.developer.team-identifier` = `V7N2K54KJN` to `build/entitlements.mac.plist`.

## Right-click menu and spelling

A right click shows a native menu ([`context-menu.js`](context-menu.js)): the spell checker's suggestions for a misspelled word and **Zum Wörterbuch hinzufügen** / **Add to Dictionary**, cut, copy, paste, **Als reinen Text einsetzen** / **Paste as Plain Text**, select all; for a link **Link im Browser öffnen**, **Link-Adresse kopieren** and – a page of the same instance – **Link in neuem Fenster öffnen**; for an image **Bild kopieren** and **Bild sichern unter …**; **„…“ nachschlagen** / **Look Up** on macOS; **Rechtschreibung** / **Spelling** with the languages German, English and French (any of them, at least one; also under *Edit* and in the settings, saved in `config.json`); **Element untersuchen** only outside the packaged app.

Flowplan's editor has its own right-click menu for text. It calls `preventDefault` on `contextmenu`, and Chromium then does not ask the app for a menu at all – Electron emits no `context-menu` event (checked by `test:app`), so the native menu never appears on top of the editor's. Inside the editor the spelling suggestions come through the bridge instead: a Flowplan server with this feature asks `window.FlowplanDesktop.spelling.check(word)` on a right click and puts the suggestions and **Zum Wörterbuch hinzufügen** at the top of its own menu. Shift + right click in the editor keeps the native menu, as in the browser.

## Quick capture

**Ctrl+Shift+Space** (⇧⌘Space on macOS) opens a small window above every other app – also while Flowplan's window is minimised, hidden or (macOS, or with the tray icon) closed ([`capture.js`](capture.js), [`pages/capture.html`](pages/capture.html)). **Enter** saves, **Shift+Enter** starts a new line, **Esc** closes; **Als Aufgabe für heute** / **As a task for today** turns the first line into an open task due today, assigned to you (it shows under *My tasks* and in the tray). The window shows where the text goes and confirms it (**✓ Gespeichert in „Eingang“**), then disappears.

It saves the way the web app's quick capture does – `capture.record` into the person's default capture database (the inbox; without a default, the first database they may add to) of the **active profile**, through [`instance-api.js`](instance-api.js) with that profile's own session: its cookies, the instance's own origin, no token. Without a connection, signed out or without an inbox it says so in the window and **keeps the text**, so it can simply be sent again. The shortcut is changed, reset or switched off in the [settings](#settings), switched on and off under *File* (**Tastenkürzel … in jeder App**); one that another app already holds is reported (settings page, a notification at start) and not taken. **Schnell erfassen …** / **Quick Capture…** is also in the *File* menu and the tray. On Linux under Wayland, global shortcuts depend on the desktop; the menu and tray entries always work.

## Tray and menu bar icon

A setting – on by default in the macOS menu bar, off on Windows and Linux ([`tray.js`](tray.js)). Its menu: **Schnell erfassen …**, **Heute** / **Today** with the open tasks of the active profile that are due today or overdue (from the instance's *My tasks*, read again every five minutes, after a capture and when a window comes to the front; a click opens the task's page), the unread notifications (opens the inbox), **Flowplan öffnen**, the profiles, **Neu starten und auf … aktualisieren** once an update is ready, **Einstellungen …** and **Beenden**. On macOS it is a template image (`build/trayTemplate.png`, `@2x`) that the system draws light or dark to match the menu bar; Windows and Linux show the app icon (a click opens the window, the menu is on right-click).

On Windows and Linux the tray icon keeps the app running when the window is closed – notifications and quick capture go on; **Beenden** in its menu quits. Tray icons look and behave differently on every Linux desktop (GNOME needs an extension such as AppIndicator); that is why it is off there by default.

## Links to pages (`flowplan://`)

`flowplan://` was registered for the [sign-in hand-off](#signing-in-with-passkeys-and-sso); it now also opens pages ([`deep-links.js`](deep-links.js)):

```text
flowplan://open?instance=https://flowplan.example.com&page=<id>[&row=<id>][&thread=<id>]
flowplan://open?url=https://flowplan.example.com/%23page=<id>
flowplan://open/flowplan.example.com?page=<id>
```

The page opens in the profile of its instance (the active profile when it points there, otherwise the first one), like a clicked notification. A link to an instance without a profile **asks first** – **Hinzufügen und öffnen** (after the same check as on the setup page: a real Flowplan, no redirect), **Im Browser öffnen** or **Abbrechen** – the app never opens an origin the person did not agree to. Only `https` origins (`http` on `localhost` for tests) and pages of them count; no credentials, no `/api/` addresses, nothing else. The app holds a single-instance lock: macOS delivers links as `open-url`, Windows and Linux start a second instance with the link, which hands it to the running one. A Flowplan server with this feature offers **In Desktop-App öffnen** / **Open in desktop app** in a page's actions in browsers on computers (not inside the desktop app, not in the mobile apps). On Linux the scheme needs the desktop file, as for the sign-in.

## Pages in windows of their own

**Seite in neuem Fenster öffnen** / **Open Page in New Window** (*File* and *Window*, ⇧⌘N / Ctrl+Shift+N), Shift-, middle- or Ctrl-click on a link of the instance, **Link in neuem Fenster öffnen** in the right-click menu, and **In neuem Fenster öffnen** in the web app's page menu (through `window.FlowplanDesktop.openWindow`) open a page of the instance in another window ([`page-windows.js`](page-windows.js)). It has the profile's session and every rule of the main window (navigation, links in the browser, the right-click menu, Handoff). Which windows are open, with size and place, is remembered per profile in `config.json` (`pageWindows`, at most twelve) and restored when the profile opens again – also after quitting; switching to another profile closes them and brings back that profile's own. Only pages of the profile's own instance are remembered and restored.

## Files dropped on the app

PDFs, images (PNG, JPEG, GIF, WebP, AVIF, HEIC), Markdown and text files can be handed to the app ([`files.js`](files.js)): dropped on the Dock icon or opened with **Open With** on macOS (the app declares these types with the rank *Alternate* – it never becomes their default app), opened with the app on Windows (**Open with → Flowplan**, or dropped on the app's shortcut – no file types are associated, so no default changes) and Linux (the desktop file lists the types), passed on the command line, or dropped on the window where the page does not take them itself (Flowplan's editor and uploads keep their own drop zones). The app first checks each file – type by extension **and** content, at most 10 files, images and PDFs up to 50 MB, text up to 5 MB (the instance may allow less and says so) – then asks, naming the files, the profile and the instance:

| Choice | What happens |
| --- | --- |
| **In den Eingang** / **Into the Inbox** | One record per file in the inbox of the active profile: images and PDFs through `POST /api/upload` and `capture.record`, Markdown and text through the database's Markdown import (`POST /api/pages/<id>/import-markdown`). |
| **Als neue Seiten** / **As New Pages** | One page per file in the inbox's space (or the first space), through the instance's import (`POST /api/import/source` with a one-note Obsidian vault: Markdown becomes a real page, images and PDFs are embedded). |

Nothing is read before the person chose; afterwards the new record or page opens.

## Launch at login

**Beim Anmelden öffnen** / **Open at login** in the settings, off by default, and optionally **Ohne Fenster starten** / **Start without a window** ([`autostart.js`](autostart.js)): macOS and Windows through the system's login items (`app.setLoginItemSettings`), Linux through an XDG autostart entry `~/.config/autostart/flowplan.desktop` (or under `$XDG_CONFIG_HOME`) that starts the AppImage itself (not its temporary mount). Started without a window, macOS keeps the Dock and menu bar icon, Windows and Linux the tray icon – without the tray icon the window starts minimised. Switching it off removes the login item or the file.

## Printing and PDF

**Drucken …** / **Print…** (⌘P / Ctrl+P) shows the page as it will print in a preview window – Chromium's PDF viewer, whose print button opens the system's print dialog; **Als PDF sichern …** / **Save as PDF…** asks where with the system's save dialog ([`print.js`](print.js)). Both use the page's print stylesheet (Flowplan hides its sidebar and toolbars) and its `@page` size; otherwise A4, or Letter where the system's region uses it (US, Canada, Mexico, …), with default margins, backgrounds, a tagged PDF and an outline from the headings.

## Settings

**Einstellungen …** / **Settings…** (in the *Flowplan* menu on macOS, under *File* on Windows and Linux, and in the tray) opens [`pages/settings.html`](pages/settings.html): the tray or menu bar icon, launch at login and the hidden start, the quick capture shortcut (change by pressing a combination, default, off), the spell checker's languages, the version and **Nach Updates suchen …**. Everything is saved at once in `config.json` (`settings`) and checked again when it is read ([`settings.js`](settings.js)) – unknown keys and wrong values fall back to the default.

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

The app checks the latest release of this repository 15 seconds after starting, every six hours and via **Nach Updates suchen …** in the menu ([`updates.js`](updates.js), [electron-updater](https://www.electron.build/auto-update)). Nothing pops up in the middle of work: no dialog, no window that takes the focus. A small toast in the bottom corner of the window ([`pages/update.html`](pages/update.html), a view inside the window that never takes the focus by itself) shows the download with percent, size and speed (**Ausblenden** hides it), the progress also shows on the Dock icon or taskbar button, and typing goes on undisturbed.

| Installed as | What happens |
| --- | --- |
| Windows installer | Downloads in the background with its progress; once ready the toast, the app menu and the tray offer **Neu starten** / **Neu starten und auf … aktualisieren**; otherwise it installs when the app quits. |
| Linux AppImage | The same – the AppImage replaces itself. |
| macOS, signed | The same. |
| macOS unsigned, Windows ZIP, Linux `.tar.gz` | The toast names the new version with **Zur Download-Seite** ([flowplan.org/download](https://flowplan.org/download)) – once per version, again only when asked. macOS only lets signed apps replace themselves. |

A check from the menu answers in the same toast (up to date, or what failed); automatic checks stay quiet when nothing is new or the connection is missing, a failed download is said in the toast. Updates are found through the files `latest-mac.yml`, `latest.yml` (Windows) and `latest-linux*.yml` that every release carries, next to `.blockmap` files for smaller downloads. `FLOWPLAN_UPDATE_URL` points the app to another source – a folder with the same files, for example a mirror inside a company network. It must start with `https://` (`http://` only for `localhost`, used by `test:update`); anything else is ignored, and the toast always names the source it used.

### Trust model of unsigned builds

Until the certificates below exist, a downloaded update is verified only by the SHA-512 in the release feed (`latest*.yml`), fetched over HTTPS from GitHub Releases (or the `https://` mirror in `FLOWPLAN_UPDATE_URL`). There is no code signature to check, so whoever can publish a release of this repository – or whoever controls the mirror – can ship any code to every installed app. Treat the release workflow, the self-hosted runner that runs its `version` and `publish` jobs and the repository's write access accordingly. With `WIN_CSC_LINK` set, electron-updater additionally checks the Windows update's signature against the publisher; with `CSC_LINK`, macOS only installs updates signed by the same team.

## Signing

Releases are unsigned until the repository has these secrets (Settings → Secrets and variables → Actions):

| Secret | For |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | macOS: Developer ID Application certificate (`.p12`, base64 or a URL) and its password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code signing certificate |

With `CSC_LINK` set, the release workflow marks the macOS app as signed (`build/update.json`) and it updates itself like on Windows. The workflow imports the certificate into a keychain of its own and passes it to electron-builder by name (`CSC_KEYCHAIN`, `CSC_NAME`); the official macOS releases are signed and notarized from 1.0.6 on.

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

Installed apps find the new version within six hours; the download page offers it right away. CI (`ci.yml`) checks every push with a syntax check, the tests without a network (`test:security`, `test:features`, and `test:offline`, `test:profiles`, `test:notifications` and `test:app` under `xvfb-run` where it is installed), that the installed Electron is one of the three majors Electron still patches (anything older than `latest − 2` fails) and a Linux test build. CI jobs run on the self-hosted runner, Dependabot and pull requests from forks on GitHub's runners; the release workflow is dispatched by maintainers only and runs on the self-hosted runner.

## Development

Node.js 22 or newer.

```sh
npm ci
npm start                  # the app against any instance
npm run check              # syntax check
npm test                   # security guards and features (Node only), offline use, profiles, notifications, Handoff and the desktop features (Linux without a display: xvfb-run -a npm test)
npm run test:security      # guards alone: bridges, navigation, profiles, notifications, permissions, update source, health check, languages, links, files, settings
npm run test:features      # the decisions behind the new features, and what the app asks an instance, against a stand-in (Node only)
npm run test:profiles      # profiles in the running app (Electron; xvfb-run on Linux without a display)
npm run test:notifications # notifications in the running app against a stand-in instance (Electron; xvfb-run on Linux)
npm run test:app           # right-click menu, quick capture, tray, links, page windows, files, settings, PDF and the update toast in the running app (Electron; xvfb-run on Linux)
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

`test:security` ([`test/security.mjs`](test/security.mjs), Node alone, no network) checks the guards: the bridge is absent on anything but the app's own pages, the instance's tiny bridge exists only on its own origin and offers nothing but notifications, notifications ask only the profile's own instance with its session and a click opens nothing else, `https://evil.example/api/auth/x` opens in the browser while `<server>/api/auth/x` stays in the window, another profile's instance stays out of the window, every profile has its own session and `config.json` cannot pick one, only the microphone alone is granted, `http://` update sources are refused, the health check's verdicts and that every string exists in all three languages. `test:smoke` checks setup, loading, the offline page, a suggested address, that other servers are refused and the sign-in through the browser (the latter with the development sign-in of a local instance); `test:update` offers the app a newer version from a local source and checks that it is found and offered; `test:offline` (with `test:security` also `npm test`, no instance needed) checks that the window offers what offline use needs, that the instance has no bridge, and that without a connection the copy stored by the service worker opens – also after a failed page of the instance – and the offline page only without a copy. `test:profiles` checks with two stand-in instances that an old single address becomes the first profile, that new profiles – also a second one on the same instance – see none of the other profiles' cookies, switching from the menu, that another profile's address goes to the browser, renaming and removing (its session is emptied) and `--profile=<id>`. `test:notifications` checks settings, Do Not Disturb, backoff and which notifications are new with Node alone, then with stand-in instances that old notifications are not shown, a new one is (the app reports it through an app event, as Linux CI has no notification server) with the badge on the unread count, that a click opens its page on the instance only – and switches to another profile –, Do Not Disturb, the switch from the menu and from the web app's bridge, **All Profiles** and that a restart shows nothing twice.

`test:features` ([`test/features.mjs`](test/features.mjs), Node alone) checks the settings (defaults per system, only valid shortcuts and languages), the right-click menu's items (suggestions first, only `http(s)`/`mailto` links to the system, the last spell checker language stays), `flowplan://` links (forms, refused origins and paths, which profile), files (type by extension and content, sizes, command line arguments, the vault and its ZIP), remembered page windows, launch at login (login item options, the XDG entry and its quoting), PDF options, the update toast (what shows when – never for a quiet automatic check) and the tray's menu, and runs quick capture, today's tasks, upload and both imports against the stand-in instance of [`test/stand-in.mjs`](test/stand-in.mjs) (the instance's origin on every change, a multipart body with its length, refused redirects, offline). `test:app` runs the same stand-in against the app: no native menu where the page shows its own, the menu for fields, links and images, **Add to Dictionary** in the profile's session, the bridge (spelling, windows only for its own pages, a synthetic drop does nothing), Shift-click and `openWindow` into windows that come back after a restart, quick capture with the profile's cookie (Shift+Enter, Esc, as a task, signed out, offline – the text stays), the tray's tasks, `flowplan://open` (an unknown instance is asked about and nothing opens), files (checked, nothing sent before the choice, into the inbox and as pages), the settings (the XDG autostart entry, a taken shortcut is refused and the old one stays), **Save as PDF**, the print preview and the update toast instead of a dialog. `test:update` (packaged app) also pretends to be an AppImage on Linux: the download reports its progress in the toast and on the taskbar, and a download that does not match its checksum ends in the toast, never in a dialog. Spelling suggestions need Chromium's dictionaries, which it downloads on first use (CI cannot): the tests hand the app the parameters Chromium reports for a misspelled word.

The app's own words live in [`strings.js`](strings.js) (German, English, French; English for other languages), chosen by `app.getLocale()`; the pages in `pages/` get the language in their address and fill `data-i18n` attributes.

Why Electron and not Tauri: Electron ships the same Chromium everywhere, the browser Flowplan is developed and tested in (service worker, IndexedDB, editor). Tauri uses the system's web views (WebKit on macOS, WebView2 on Windows) and needs a Rust toolchain; the app would be much smaller (~10 MB instead of ~110 MB).

## License

[GNU Affero General Public License v3.0](LICENSE), like Flowplan.
