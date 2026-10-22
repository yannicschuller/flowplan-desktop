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

    // Updates (updates.js)
    "updates.download": ["Herunterladen", "Download", "Télécharger"],
    "updates.later": ["Später", "Later", "Plus tard"],
    "updates.available": ["Flowplan {0} ist verfügbar", "Flowplan {0} is available", "Flowplan {0} est disponible"],
    "updates.availableDetail": ["Du nutzt Version {0}. Lade die neue Version herunter und ersetze die App damit.", "You are using version {0}. Download the new version and replace the app with it.", "Vous utilisez la version {0}. Téléchargez la nouvelle version et remplacez l'application."],
    "updates.upToDate": ["Flowplan ist auf dem neuesten Stand", "Flowplan is up to date", "Flowplan est à jour"],
    "updates.version": ["Version {0}", "Version {0}", "Version {0}"],
    "updates.restartNow": ["Jetzt neu starten", "Restart Now", "Redémarrer maintenant"],
    "updates.onNextStart": ["Beim nächsten Start", "On Next Start", "Au prochain démarrage"],
    "updates.ready": ["Flowplan {0} ist bereit", "Flowplan {0} is ready", "Flowplan {0} est prêt"],
    "updates.readyDetail": ["Das Update wird beim nächsten Start installiert – oder jetzt sofort.", "The update installs on the next start – or right now.", "La mise à jour s'installe au prochain démarrage – ou tout de suite."],
    "updates.failed": ["Nach Updates suchen hat nicht geklappt", "Checking for updates did not work", "La recherche de mises à jour a échoué"],
    "updates.failedDetail": ["{0}\n\nDie neueste Version gibt es auch unter {1}.", "{0}\n\nThe latest version is also available at {1}.", "{0}\n\nLa dernière version est aussi disponible sur {1}."],
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
