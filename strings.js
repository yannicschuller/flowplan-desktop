// The app's own words in German, English and French, chosen by the system
// language (app.getLocale(); English when the language is another one). Used
// by the main process (require) and by the app's own pages (<script>), which
// get the language in their address (?lang=de).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.flowplanStrings = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const LOCALES = ["de", "en", "fr"];
  const FALLBACK = "en";
  // "de-CH", "fr_CA", "en-US" → "de", "fr", "en"; anything else → "en".
  function pickLocale(value) {
    const short = String(value || "")
      .toLowerCase()
      .split(/[-_]/)[0];
    return LOCALES.includes(short) ? short : FALLBACK;
  }
  // key → [de, en, fr]
  const STRINGS = {
    // Server address and health check (main.js)
    "server.empty": ["Bitte die Adresse deiner Flowplan-Instanz eingeben.", "Please enter the address of your Flowplan instance.", "Veuillez saisir l'adresse de votre instance Flowplan."],
    "server.httpsOnly": ["Nur HTTPS-Adressen sind erlaubt (HTTP nur für localhost).", "Only HTTPS addresses are allowed (HTTP only for localhost).", "Seules les adresses HTTPS sont autorisées (HTTP uniquement pour localhost)."],
    "server.unreachable": ["Die Adresse ist nicht erreichbar ({0}). Prüfe die Schreibweise und deine Verbindung.", "The address cannot be reached ({0}). Check the spelling and your connection.", "L'adresse est inaccessible ({0}). Vérifiez l'orthographe et votre connexion."],
    "server.redirects": ["Die Adresse leitet auf {0} weiter. Gib bitte diese Adresse ein.", "The address redirects to {0}. Please enter that address instead.", "L'adresse redirige vers {0}. Saisissez plutôt cette adresse."],
    "server.proxyAuth": ["Der Server verlangt zuerst eine Anmeldung (HTTP {0}), zum Beispiel an einem vorgeschalteten Proxy oder VPN. Melde dich dort an oder frag deine Administration.", "The server asks you to sign in first (HTTP {0}), for example at a proxy or VPN in front of it. Sign in there or ask your administrator.", "Le serveur demande d'abord une connexion (HTTP {0}), par exemple à un proxy ou un VPN placé devant. Connectez-vous là ou demandez à votre administration."],
    "server.status": ["Der Server antwortet mit einem Fehler (HTTP {0}). Flowplan ist dort gerade nicht erreichbar.", "The server answers with an error (HTTP {0}). Flowplan is not available there right now.", "Le serveur répond par une erreur (HTTP {0}). Flowplan n'y est pas disponible pour le moment."],
    "server.html": ["Unter dieser Adresse antwortet eine Webseite, aber kein Flowplan – vielleicht eine Anmeldeseite oder ein anderer Dienst.", "A web page answers at this address, but not Flowplan – maybe a sign-in page or another service.", "Une page web répond à cette adresse, mais pas Flowplan – peut-être une page de connexion ou un autre service."],
    "server.notFlowplan": ["Dort läuft kein Flowplan.", "There is no Flowplan running there.", "Aucun Flowplan ne fonctionne à cette adresse."],
    "server.notFound": ["Unter {0} wurde keine Flowplan-Instanz gefunden ({1})", "No Flowplan instance was found at {0} ({1})", "Aucune instance Flowplan n'a été trouvée sous {0} ({1})"],

    // Menu (main.js)
    "menu.about": ["Über Flowplan", "About Flowplan", "À propos de Flowplan"],
    "menu.checkUpdates": ["Nach Updates suchen …", "Check for Updates…", "Rechercher des mises à jour…"],
    "menu.profiles": ["Profile", "Profiles", "Profils"],
    "menu.nextProfile": ["Nächstes Profil", "Next Profile", "Profil suivant"],
    "menu.addProfile": ["Profil hinzufügen …", "Add Profile…", "Ajouter un profil…"],
    "menu.manageProfiles": ["Profile verwalten …", "Manage Profiles…", "Gérer les profils…"],
    "menu.hide": ["Flowplan ausblenden", "Hide Flowplan", "Masquer Flowplan"],
    "menu.hideOthers": ["Andere ausblenden", "Hide Others", "Masquer les autres"],
    "menu.unhide": ["Alle einblenden", "Show All", "Tout afficher"],
    "menu.quitMac": ["Flowplan beenden", "Quit Flowplan", "Quitter Flowplan"],
    "menu.file": ["Datei", "File", "Fichier"],
    "menu.quit": ["Beenden", "Quit", "Quitter"],
    "menu.edit": ["Bearbeiten", "Edit", "Édition"],
    "menu.undo": ["Widerrufen", "Undo", "Annuler"],
    "menu.redo": ["Wiederholen", "Redo", "Rétablir"],
    "menu.cut": ["Ausschneiden", "Cut", "Couper"],
    "menu.copy": ["Kopieren", "Copy", "Copier"],
    "menu.paste": ["Einsetzen", "Paste", "Coller"],
    "menu.pasteAndMatchStyle": ["Ohne Formatierung einsetzen", "Paste and Match Style", "Coller sans mise en forme"],
    "menu.selectAll": ["Alles auswählen", "Select All", "Tout sélectionner"],
    "menu.view": ["Ansicht", "View", "Affichage"],
    "menu.reload": ["Neu laden", "Reload", "Recharger"],
    "menu.forceReload": ["Neu laden ohne Cache", "Reload Ignoring Cache", "Recharger sans le cache"],
    "menu.resetZoom": ["Originalgröße", "Actual Size", "Taille réelle"],
    "menu.zoomIn": ["Vergrößern", "Zoom In", "Agrandir"],
    "menu.zoomOut": ["Verkleinern", "Zoom Out", "Réduire"],
    "menu.fullscreen": ["Vollbild", "Full Screen", "Plein écran"],
    "menu.devTools": ["Entwicklerwerkzeuge", "Developer Tools", "Outils de développement"],
    "menu.navigation": ["Navigation", "Navigation", "Navigation"],
    "menu.back": ["Zurück", "Back", "Précédent"],
    "menu.forward": ["Vorwärts", "Forward", "Suivant"],
    "menu.home": ["Startseite", "Home", "Accueil"],
    "menu.openInBrowser": ["Im Browser öffnen", "Open in Browser", "Ouvrir dans le navigateur"],
    "menu.window": ["Fenster", "Window", "Fenêtre"],
    "menu.minimize": ["Minimieren", "Minimize", "Réduire"],
    "menu.zoom": ["Zoomen", "Zoom", "Zoom"],
    "menu.front": ["Alle nach vorne", "Bring All to Front", "Tout ramener au premier plan"],
    "menu.close": ["Schließen", "Close", "Fermer"],
    "menu.notifications": ["Mitteilungen", "Notifications", "Notifications"],
    "menu.notificationsShow": ["Mitteilungen anzeigen", "Show Notifications", "Afficher les notifications"],
    "menu.doNotDisturb": ["Nicht stören", "Do Not Disturb", "Ne pas déranger"],
    "menu.dndOff": ["Aus", "Off", "Désactivé"],
    "menu.dndHour": ["Für 1 Stunde", "For 1 Hour", "Pendant 1 heure"],
    "menu.dndTomorrow": ["Bis morgen", "Until Tomorrow", "Jusqu'à demain"],
    "menu.dndUntil": ["Stumm bis {0}", "Muted until {0}", "En sourdine jusqu'à {0}"],
    "menu.notificationsAllProfiles": ["Alle Profile", "All Profiles", "Tous les profils"],
    "menu.settings": ["Einstellungen …", "Settings…", "Réglages…"],
    "menu.quickCapture": ["Schnell erfassen …", "Quick Capture…", "Capture rapide…"],
    "menu.captureShortcut": ["Tastenkürzel {0} in jeder App", "Shortcut {0} in Every App", "Raccourci {0} dans toute application"],
    "menu.pageInNewWindow": ["Seite in neuem Fenster öffnen", "Open Page in New Window", "Ouvrir la page dans une nouvelle fenêtre"],
    "menu.print": ["Drucken …", "Print…", "Imprimer…"],
    "menu.savePdf": ["Als PDF sichern …", "Save as PDF…", "Enregistrer en PDF…"],
    "menu.restartToUpdate": ["Neu starten und auf {0} aktualisieren", "Restart to Update to {0}", "Redémarrer pour passer à {0}"],

    // Right-click menu (context-menu.js)
    "context.noSuggestions": ["Keine Vorschläge", "No Suggestions", "Aucune suggestion"],
    "context.addToDictionary": ["Zum Wörterbuch hinzufügen", "Add to Dictionary", "Ajouter au dictionnaire"],
    "context.openLinkWindow": ["Link in neuem Fenster öffnen", "Open Link in New Window", "Ouvrir le lien dans une nouvelle fenêtre"],
    "context.openLink": ["Link im Browser öffnen", "Open Link in Browser", "Ouvrir le lien dans le navigateur"],
    "context.copyLink": ["Link-Adresse kopieren", "Copy Link Address", "Copier l'adresse du lien"],
    "context.copyEmail": ["E-Mail-Adresse kopieren", "Copy Email Address", "Copier l'adresse e-mail"],
    "context.copyImage": ["Bild kopieren", "Copy Image", "Copier l'image"],
    "context.saveImage": ["Bild sichern unter …", "Save Image As…", "Enregistrer l'image sous…"],
    "context.pastePlain": ["Als reinen Text einsetzen", "Paste as Plain Text", "Coller en texte brut"],
    "context.lookUp": ["„{0}“ nachschlagen", "Look Up “{0}”", "Rechercher « {0} »"],
    "context.spellingLanguages": ["Rechtschreibung", "Spelling", "Orthographe"],
    "context.inspect": ["Element untersuchen", "Inspect Element", "Inspecter l'élément"],
    "spelling.de-DE": ["Deutsch", "German", "Allemand"],
    "spelling.en-US": ["Englisch", "English", "Anglais"],
    "spelling.fr-FR": ["Französisch", "French", "Français"],

    // Quick capture (capture.js, pages/capture.html)
    "capture.title": ["Schnell erfassen", "Quick capture", "Capture rapide"],
    "capture.placeholder": ["Was willst du festhalten?", "What do you want to capture?", "Que voulez-vous noter ?"],
    "capture.asTask": ["Als Aufgabe für heute", "As a task for today", "Comme tâche pour aujourd'hui"],
    "capture.hint": ["Enter speichert · Umschalt+Enter neue Zeile · Esc schließt", "Enter saves · Shift+Enter new line · Esc closes", "Entrée enregistre · Maj+Entrée nouvelle ligne · Échap ferme"],
    "capture.target": ["in den Eingang von {0}", "into the inbox of {0}", "dans la boîte de réception de {0}"],
    "capture.inbox": ["Eingang", "Inbox", "Boîte de réception"],
    "capture.saving": ["Speichere …", "Saving…", "Enregistrement…"],
    "capture.saved": ["✓ Gespeichert in „{0}“", "✓ Saved to “{0}”", "✓ Enregistré dans « {0} »"],
    "capture.savedTask": ["✓ Aufgabe für heute in „{0}“", "✓ Task for today in “{0}”", "✓ Tâche pour aujourd'hui dans « {0} »"],
    "capture.empty": ["Schreib zuerst etwas.", "Write something first.", "Écrivez d'abord quelque chose."],
    "capture.tooLong": ["Der Text ist zu lang (höchstens 20 000 Zeichen).", "The text is too long (at most 20,000 characters).", "Le texte est trop long (20 000 caractères au maximum)."],
    "capture.offline": ["Keine Verbindung zu {0}. Der Text bleibt hier – versuch es gleich noch einmal.", "No connection to {0}. The text stays here – try again in a moment.", "Pas de connexion à {0}. Le texte reste ici – réessayez dans un instant."],
    "capture.signedOut": ["Bei {0} nicht angemeldet. Melde dich im Flowplan-Fenster an; der Text bleibt hier.", "Not signed in to {0}. Sign in in the Flowplan window; the text stays here.", "Non connecté à {0}. Connectez-vous dans la fenêtre Flowplan ; le texte reste ici."],
    "capture.noInbox": ["Kein Eingang gefunden. Lege in Flowplan unter „Erfassen“ eine Datenbank als Standard fest.", "No inbox found. In Flowplan, choose a default database under “Capture”.", "Aucune boîte de réception. Dans Flowplan, choisissez une base de données par défaut sous « Capturer »."],
    "capture.noProfile": ["Zuerst eine Flowplan-Instanz einrichten.", "Set up a Flowplan instance first.", "Configurez d'abord une instance Flowplan."],
    "capture.failed": ["Speichern hat nicht geklappt. Der Text bleibt hier.", "Saving did not work. The text stays here.", "L'enregistrement a échoué. Le texte reste ici."],

    // Tray and menu bar icon (tray.js)
    "tray.capture": ["Schnell erfassen …", "Quick Capture…", "Capture rapide…"],
    "tray.today": ["Heute", "Today", "Aujourd'hui"],
    "tray.loading": ["Lade Aufgaben …", "Loading tasks…", "Chargement des tâches…"],
    "tray.noTasks": ["Keine Aufgaben für heute", "No tasks for today", "Aucune tâche pour aujourd'hui"],
    "tray.moreTasks": ["{0} weitere …", "{0} more…", "{0} de plus…"],
    "tray.signedOut": ["Nicht angemeldet", "Not signed in", "Non connecté"],
    "tray.tasksUnavailable": ["Aufgaben gerade nicht erreichbar", "Tasks not available right now", "Tâches indisponibles pour le moment"],
    "tray.unread": ["{0} ungelesene Benachrichtigungen", "{0} unread notifications", "{0} notifications non lues"],
    "tray.noUnread": ["Posteingang", "Inbox", "Boîte de réception"],
    "tray.open": ["Flowplan öffnen", "Open Flowplan", "Ouvrir Flowplan"],

    // Settings (pages/settings.html)
    "settings.title": ["Einstellungen", "Settings", "Réglages"],
    "settings.general": ["Allgemein", "General", "Général"],
    "settings.tray": ["Symbol im Infobereich der Taskleiste", "Icon in the notification area", "Icône dans la zone de notification"],
    "settings.trayMac": ["Symbol in der Menüleiste", "Icon in the menu bar", "Icône dans la barre des menus"],
    "settings.trayHint": ["Schnell erfassen, die Aufgaben von heute und ungelesene Benachrichtigungen. Unter Windows und Linux läuft Flowplan dann nach dem Schließen des Fensters weiter.", "Quick capture, today's tasks and unread notifications. On Windows and Linux, Flowplan then keeps running after its window is closed.", "Capture rapide, tâches du jour et notifications non lues. Sous Windows et Linux, Flowplan continue alors de tourner après la fermeture de la fenêtre."],
    "settings.launchAtLogin": ["Beim Anmelden öffnen", "Open at login", "Ouvrir à l'ouverture de session"],
    "settings.startHidden": ["Ohne Fenster starten", "Start without a window", "Démarrer sans fenêtre"],
    "settings.capture": ["Schnell erfassen", "Quick capture", "Capture rapide"],
    "settings.captureHint": ["Ein Tastenkürzel öffnet über jeder App ein kleines Fenster; der Text landet im Eingang des aktiven Profils.", "A shortcut opens a small window above every app; the text goes into the inbox of the active profile.", "Un raccourci ouvre une petite fenêtre au-dessus de toute application ; le texte va dans la boîte de réception du profil actif."],
    "settings.shortcutPlaceholder": ["Tastenkombination drücken", "Press a key combination", "Appuyez sur une combinaison de touches"],
    "settings.shortcutChange": ["Ändern", "Change", "Modifier"],
    "settings.shortcutDefault": ["Standard", "Default", "Par défaut"],
    "settings.shortcutOff": ["Aus", "Off", "Désactiver"],
    "settings.shortcutOk": ["Aktiv – funktioniert in jeder App.", "Active – works in every app.", "Actif – fonctionne dans toute application."],
    "settings.shortcutIsOff": ["Ausgeschaltet – Schnell erfassen bleibt im Menü und im Symbol.", "Off – quick capture stays in the menu and the icon.", "Désactivé – la capture rapide reste dans le menu et l'icône."],
    "settings.shortcutTaken": ["{0} ist schon von einer anderen App belegt. Wähle eine andere Kombination.", "{0} is already used by another app. Choose another combination.", "{0} est déjà utilisé par une autre application. Choisissez une autre combinaison."],
    "settings.spelling": ["Rechtschreibprüfung", "Spell checking", "Vérification orthographique"],
    "settings.updates": ["Updates", "Updates", "Mises à jour"],
    "settings.cancel": ["Abbrechen", "Cancel", "Annuler"],

    // Links to pages (deep-links.js)
    "links.unknown": ["{0} als Profil hinzufügen?", "Add {0} as a profile?", "Ajouter {0} comme profil ?"],
    "links.unknownDetail": ["Ein Link möchte eine Seite von {0} öffnen. Für diese Instanz gibt es noch kein Profil. Füge sie nur hinzu, wenn du ihr vertraust.", "A link wants to open a page of {0}. There is no profile for this instance yet. Only add it if you trust it.", "Un lien veut ouvrir une page de {0}. Il n'existe pas encore de profil pour cette instance. Ne l'ajoutez que si vous lui faites confiance."],
    "links.add": ["Hinzufügen und öffnen", "Add and Open", "Ajouter et ouvrir"],
    "links.browser": ["Im Browser öffnen", "Open in Browser", "Ouvrir dans le navigateur"],
    "links.cancel": ["Abbrechen", "Cancel", "Annuler"],
    "links.failed": ["Link kann nicht geöffnet werden", "Cannot open the link", "Impossible d'ouvrir le lien"],

    // Files handed to the app (files.js)
    "files.noProfile": ["Richte zuerst eine Flowplan-Instanz ein, dann kannst du Dateien hineinziehen.", "Set up a Flowplan instance first, then you can drop files on it.", "Configurez d'abord une instance Flowplan, puis vous pourrez y déposer des fichiers."],
    "files.confirm": ["{0} Datei(en) zu „{1}“ hinzufügen?", "Add {0} file(s) to “{1}”?", "Ajouter {0} fichier(s) à « {1} » ?"],
    "files.where": ["In den Eingang: ein Eintrag je Datei. Als neue Seiten: eine Seite je Datei. Alles wird an {0} gesendet.", "Into the inbox: one record per file. As new pages: one page per file. Everything is sent to {0}.", "Dans la boîte de réception : une entrée par fichier. Comme nouvelles pages : une page par fichier. Tout est envoyé à {0}."],
    "files.toInbox": ["In den Eingang", "Into the Inbox", "Dans la boîte de réception"],
    "files.asPages": ["Als neue Seiten", "As New Pages", "Comme nouvelles pages"],
    "files.cancel": ["Abbrechen", "Cancel", "Annuler"],
    "files.none": ["Diese Dateien kann Flowplan nicht übernehmen", "Flowplan cannot take these files", "Flowplan ne peut pas prendre ces fichiers"],
    "files.tooMany": ["Höchstens {0} Dateien auf einmal.", "At most {0} files at once.", "{0} fichiers au maximum à la fois."],
    "files.refused.type": ["nur PDF, Bilder, Markdown und Text", "only PDF, images, Markdown and text", "seulement PDF, images, Markdown et texte"],
    "files.refused.size": ["zu groß (Bilder und PDFs bis 50 MB, Text bis 5 MB)", "too large (images and PDFs up to 50 MB, text up to 5 MB)", "trop volumineux (images et PDF jusqu'à 50 Mo, texte jusqu'à 5 Mo)"],
    "files.refused.empty": ["leer", "empty", "vide"],
    "files.refused.content": ["Inhalt passt nicht zur Endung", "content does not match its extension", "le contenu ne correspond pas à l'extension"],
    "files.refused.missing": ["nicht lesbar", "cannot be read", "illisible"],
    "files.done": ["{0} Datei(en) übernommen", "{0} file(s) added", "{0} fichier(s) ajouté(s)"],
    "files.doneInbox": ["Im Eingang", "In the inbox", "Dans la boîte de réception"],
    "files.donePages": ["Als neue Seiten", "As new pages", "Comme nouvelles pages"],
    "files.failed": ["Dateien konnten nicht übernommen werden", "The files could not be added", "Les fichiers n'ont pas pu être ajoutés"],

    // Printing (print.js)
    "print.preview": ["Druckvorschau", "Print Preview", "Aperçu avant impression"],
    "print.failed": ["Drucken hat nicht geklappt", "Printing did not work", "L'impression a échoué"],

    // Notifications (notifier.js, notifications.js)
    "notifications.many": ["{0} neue Benachrichtigungen", "{0} new notifications", "{0} nouvelles notifications"],
    "notifications.badge": ["{0} ungelesene Benachrichtigungen", "{0} unread notifications", "{0} notifications non lues"],

    // Updates (updates.js, pages/update.html)
    "updates.title": ["Update", "Update", "Mise à jour"],
    "updates.download": ["Zur Download-Seite", "Download Page", "Page de téléchargement"],
    "updates.later": ["Später", "Later", "Plus tard"],
    "updates.hide": ["Ausblenden", "Hide", "Masquer"],
    "updates.ok": ["OK", "OK", "OK"],
    "updates.checking": ["Suche nach Updates …", "Checking for updates…", "Recherche de mises à jour…"],
    "updates.downloading": ["Lade Flowplan {0} …", "Downloading Flowplan {0}…", "Téléchargement de Flowplan {0}…"],
    "updates.ofSize": ["{0} von {1}", "{0} of {1}", "{0} sur {1}"],
    "updates.available": ["Flowplan {0} ist verfügbar", "Flowplan {0} is available", "Flowplan {0} est disponible"],
    "updates.availableDetail": ["Du nutzt Version {0}. Lade die neue Version herunter und ersetze die App damit.", "You are using version {0}. Download the new version and replace the app with it.", "Vous utilisez la version {0}. Téléchargez la nouvelle version et remplacez l'application."],
    "updates.upToDate": ["Flowplan ist auf dem neuesten Stand", "Flowplan is up to date", "Flowplan est à jour"],
    "updates.version": ["Version {0}", "Version {0}", "Version {0}"],
    "updates.restartNow": ["Neu starten", "Restart", "Redémarrer"],
    "updates.ready": ["Flowplan {0} ist bereit", "Flowplan {0} is ready", "Flowplan {0} est prêt"],
    "updates.readyDetail": ["Wird beim Beenden installiert – oder jetzt mit einem Neustart.", "Installs when Flowplan quits – or now with a restart.", "S'installe à la fermeture de Flowplan – ou maintenant avec un redémarrage."],
    "updates.failed": ["Nach Updates suchen hat nicht geklappt", "Checking for updates did not work", "La recherche de mises à jour a échoué"],
    "updates.failedDetail": ["{0} – die neueste Version gibt es auch unter {1}.", "{0} – the latest version is also available at {1}.", "{0} – la dernière version est aussi disponible sur {1}."],
    "updates.onlyInstalled": ["Updates gibt es nur in der installierten App", "Updates are only available in the installed app", "Les mises à jour ne sont disponibles que dans l'application installée"],
    "updates.onlyInstalledDetail": ["Die neueste Version gibt es unter {0}.", "The latest version is available at {0}.", "La dernière version est disponible sur {0}."],
    "updates.source": ["Updatequelle: {0}", "Update source: {0}", "Source des mises à jour : {0}"],
    "updates.sourceGithub": ["GitHub-Releases von {0}", "GitHub releases of {0}", "Versions GitHub de {0}"],
    "updates.sourceIgnored": ["FLOWPLAN_UPDATE_URL wurde ignoriert, weil die Adresse nicht mit https:// beginnt: {0}", "FLOWPLAN_UPDATE_URL was ignored because the address does not start with https://: {0}", "FLOWPLAN_UPDATE_URL a été ignorée car l'adresse ne commence pas par https:// : {0}"],

    // Sign-in through the browser (sign-in.js, pages/sign-in.html)
    "signIn.notPossible": ["Anmeldung nicht möglich", "Cannot sign in", "Connexion impossible"],
    "signIn.notStarted": ["Diese Anmeldung wurde nicht in dieser App gestartet oder gehört zu einer anderen Instanz. Starte sie bitte noch einmal über „Mit Passkey anmelden“ oder „Mit SSO anmelden“.", "This sign-in was not started in this app or belongs to another instance. Please start it again with “Sign in with passkey” or “Sign in with SSO”.", "Cette connexion n'a pas été lancée depuis cette application ou appartient à une autre instance. Relancez-la via « Se connecter avec une clé d'accès » ou « Se connecter avec SSO »."],
    "signIn.failed": ["Anmeldung fehlgeschlagen", "Sign-in failed", "Échec de la connexion"],
    "signIn.retry": ["Bitte erneut anmelden.", "Please sign in again.", "Veuillez vous reconnecter."],
    "signIn.noCode": ["Füge den Link „Flowplan-App öffnen“ aus dem Browser oder den Anmeldecode ein.", "Paste the “Open the Flowplan app” link from the browser or the sign-in code.", "Collez le lien « Ouvrir l'application Flowplan » du navigateur ou le code de connexion."],
    "signIn.noPending": ["In dieser App wartet keine Anmeldung. Starte sie bitte noch einmal.", "No sign-in is waiting in this app. Please start it again.", "Aucune connexion n'est en attente dans cette application. Veuillez la relancer."],
    "signIn.title": ["Weiter im Browser", "Continue in the browser", "Continuez dans le navigateur"],
    "signIn.text": ["Der Browser hat die Anmeldung bei {0} geöffnet. Melde dich dort an und bestätige „In der App anmelden“ – die App übernimmt dann von selbst.", "Your browser has opened the sign-in at {0}. Sign in there and confirm “Sign in to the app” – the app then takes over by itself.", "Votre navigateur a ouvert la connexion à {0}. Connectez-vous et confirmez « Se connecter dans l'application » – l'application prend ensuite le relais."],
    "signIn.fallback": ["Passiert nichts (zum Beispiel unter Linux, wenn flowplan:// nicht registriert ist)? Kopiere auf der letzten Seite im Browser den Link hinter „Flowplan-App öffnen“ (Rechtsklick → Linkadresse kopieren) und füge ihn hier ein.", "Nothing happens (for example on Linux when flowplan:// is not registered)? On the last page in the browser, copy the link behind “Open the Flowplan app” (right-click → Copy link address) and paste it here.", "Rien ne se passe (par exemple sous Linux si flowplan:// n'est pas enregistré) ? Sur la dernière page du navigateur, copiez le lien derrière « Ouvrir l'application Flowplan » (clic droit → Copier l'adresse du lien) et collez-le ici."],
    "signIn.codeLabel": ["Link oder Anmeldecode", "Link or sign-in code", "Lien ou code de connexion"],
    "signIn.codePlaceholder": ["flowplan://sign-in?…", "flowplan://sign-in?…", "flowplan://sign-in?…"],
    "signIn.paste": ["Code einfügen", "Paste code", "Coller le code"],
    "signIn.pasting": ["Melde an …", "Signing in…", "Connexion…"],
    "signIn.cancel": ["Abbrechen", "Cancel", "Annuler"],

    // Setup page (pages/setup.html)
    "setup.title": ["Flowplan einrichten", "Set up Flowplan", "Configurer Flowplan"],
    "setup.heading": ["Willkommen bei Flowplan", "Welcome to Flowplan", "Bienvenue dans Flowplan"],
    "setup.text": ["Verbinde dich mit app.flowplan.org oder gib die Adresse deiner eigenen Flowplan-Instanz ein. Weitere Instanzen fügst du später im Menü unter „Profile“ hinzu.", "Connect to app.flowplan.org or enter the address of your own Flowplan instance. You can add more instances later in the menu under “Profiles”.", "Connectez-vous à app.flowplan.org ou saisissez l'adresse de votre propre instance Flowplan. Vous pourrez ajouter d'autres instances plus tard dans le menu « Profils »."],
    "setup.label": ["Adresse der Instanz", "Address of the instance", "Adresse de l'instance"],
    "setup.placeholder": ["flowplan.deine-firma.de", "flowplan.your-company.com", "flowplan.votre-entreprise.fr"],
    "setup.connect": ["Verbinden", "Connect", "Se connecter"],
    "setup.connecting": ["Verbinde …", "Connecting…", "Connexion…"],
    "setup.nameLabel": ["Name des Profils (optional)", "Name of the profile (optional)", "Nom du profil (facultatif)"],
    "setup.namePlaceholder": ["Arbeit", "Work", "Travail"],
    "setup.cancel": ["Abbrechen", "Cancel", "Annuler"],
    "setup.addTitle": ["Profil hinzufügen", "Add profile", "Ajouter un profil"],
    "setup.addHeading": ["Weitere Instanz hinzufügen", "Add another instance", "Ajouter une autre instance"],
    "setup.addText": ["Jedes Profil hat seine eigene Anmeldung und seine eigenen Offline-Daten. Wechseln kannst du im Menü unter „Profile“.", "Each profile has its own sign-in and its own offline data. Switch between them in the menu under “Profiles”.", "Chaque profil a sa propre connexion et ses propres données hors ligne. Changez de profil dans le menu « Profils »."],
    "setup.add": ["Hinzufügen", "Add", "Ajouter"],

    // Profiles (main.js, pages/profiles.html)
    "profiles.title": ["Profile", "Profiles", "Profils"],
    "profiles.text": ["Jedes Profil ist eine Flowplan-Instanz mit eigener Anmeldung. Wechseln kannst du im Menü oder mit {0}.", "Each profile is a Flowplan instance with its own sign-in. Switch in the menu or with {0}.", "Chaque profil est une instance Flowplan avec sa propre connexion. Changez de profil dans le menu ou avec {0}."],
    "profiles.nameLabel": ["Name des Profils", "Name of the profile", "Nom du profil"],
    "profiles.active": ["Aktiv", "Active", "Actif"],
    "profiles.open": ["Öffnen", "Open", "Ouvrir"],
    "profiles.add": ["Profil hinzufügen", "Add profile", "Ajouter un profil"],
    "profiles.back": ["Zurück", "Back", "Retour"],
    "profiles.remove": ["Entfernen", "Remove", "Supprimer"],
    "profiles.cancel": ["Abbrechen", "Cancel", "Annuler"],
    "profiles.removeConfirm": ["Profil „{0}“ entfernen?", "Remove the profile “{0}”?", "Supprimer le profil « {0} » ?"],
    "profiles.removeDetail": ["Die App meldet sich bei {0} ab und löscht, was dieses Profil auf diesem Computer gespeichert hat (Anmeldung, Offline-Kopie). Deine Daten bleiben auf dem Server.", "The app signs out of {0} and deletes what this profile stored on this computer (sign-in, offline copy). Your data stays on the server.", "L'application se déconnecte de {0} et supprime ce que ce profil a enregistré sur cet ordinateur (connexion, copie hors ligne). Vos données restent sur le serveur."],
    "profiles.tooMany": ["Höchstens {0} Profile.", "At most {0} profiles.", "{0} profils au maximum."],
    "profiles.openProfile": ["Flowplan mit dem Profil „{0}“ öffnen", "Open Flowplan with the profile “{0}”", "Ouvrir Flowplan avec le profil « {0} »"],

    // Offline page (pages/offline.html)
    "offline.title": ["Keine Verbindung", "No connection", "Pas de connexion"],
    "offline.heading": ["Keine Verbindung zu Flowplan", "No connection to Flowplan", "Pas de connexion à Flowplan"],
    "offline.text": ["Der Server ist gerade nicht erreichbar. Prüfe deine Internetverbindung oder die Adresse der Instanz.", "The server cannot be reached right now. Check your internet connection or the address of the instance.", "Le serveur est inaccessible pour le moment. Vérifiez votre connexion Internet ou l'adresse de l'instance."],
    "offline.detail": ["{0} ist gerade nicht erreichbar ({1}). Prüfe deine Internetverbindung oder die Adresse der Instanz.", "{0} cannot be reached right now ({1}). Check your internet connection or the address of the instance.", "{0} est inaccessible pour le moment ({1}). Vérifiez votre connexion Internet ou l'adresse de l'instance."],
    "offline.unknownError": ["unbekannter Fehler", "unknown error", "erreur inconnue"],
    "offline.retry": ["Erneut versuchen", "Try again", "Réessayer"],
    "offline.profiles": ["Profile", "Profiles", "Profils"],
  };

  let current = FALLBACK;
  function setLocale(value) {
    current = pickLocale(value);
    return current;
  }
  const locale = () => current;
  function format(template, args) {
    return template.replace(/\{(\d+)\}/g, (match, index) => (index < args.length ? String(args[index]) : match));
  }
  // t("updates.available", "1.2.3") in the current language; a missing key
  // comes back as the key so a typo shows instead of hiding.
  function t(key, ...args) {
    const entry = STRINGS[key];
    if (!entry) return key;
    const text = entry[LOCALES.indexOf(current)] || entry[LOCALES.indexOf(FALLBACK)];
    return format(text, args);
  }
  // Fills a document: data-i18n (text), data-i18n-placeholder, and the title.
  function apply(doc) {
    doc.documentElement.lang = current;
    for (const node of doc.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
    for (const node of doc.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = t(node.dataset.i18nPlaceholder);
    const title = doc.querySelector("title[data-i18n-title]");
    if (title) doc.title = t(title.dataset.i18nTitle);
  }
  return { LOCALES, STRINGS, pickLocale, setLocale, locale, t, apply };
});
