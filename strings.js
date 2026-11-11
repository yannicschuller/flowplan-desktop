// The app's own words in German, English, French and Simplified Chinese,
// chosen by the system language (app.getLocale(); English when the language is
// another one). Used by the main process (require) and by the app's own pages
// (<script>), which get the language in their address (?lang=de).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.flowplanStrings = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const LOCALES = ["de", "en", "fr", "zh"];
  const FALLBACK = "en";
  // Chinese written in Traditional characters (Taiwan, Hong Kong, Macau) gets
  // English rather than Simplified characters it does not read as its own.
  const TRADITIONAL = ["hant", "tw", "hk", "mo"];
  // "de-CH", "fr_CA", "en-US" → "de", "fr", "en"; "zh", "zh-CN", "zh-Hans",
  // "zh-SG" → "zh"; "zh-TW", "zh-HK", "zh-Hant" and anything else → "en".
  function pickLocale(value) {
    const [short, ...rest] = String(value || "")
      .toLowerCase()
      .split(/[-_]/);
    if (short === "zh" && rest.some((part) => TRADITIONAL.includes(part)) && !rest.includes("hans")) return FALLBACK;
    return LOCALES.includes(short) ? short : FALLBACK;
  }
  // The language tag for <html lang> and Intl: "zh-Hans" so Chromium picks
  // Simplified Chinese glyphs and formats.
  const tagOf = (locale) => (locale === "zh" ? "zh-Hans" : locale);
  // The language the instance's shorthand parser knows (de, en, fr): Chinese
  // shorthand is read the English way ("tomorrow 3pm", month/day like 3/15).
  const serverLocale = (locale) => (["de", "en", "fr"].includes(locale) ? locale : FALLBACK);
  // key → [de, en, fr, zh]
  const STRINGS = {
    // Server address and health check (main.js)
    "server.empty": ["Bitte die Adresse deiner Flowplan-Instanz eingeben.", "Please enter the address of your Flowplan instance.", "Veuillez saisir l'adresse de votre instance Flowplan.", "请输入你的 Flowplan 实例地址。"],
    "server.httpsOnly": ["Nur HTTPS-Adressen sind erlaubt (HTTP nur für localhost).", "Only HTTPS addresses are allowed (HTTP only for localhost).", "Seules les adresses HTTPS sont autorisées (HTTP uniquement pour localhost).", "只允许 HTTPS 地址（HTTP 仅限 localhost）。"],
    "server.unreachable": ["Die Adresse ist nicht erreichbar ({0}). Prüfe die Schreibweise und deine Verbindung.", "The address cannot be reached ({0}). Check the spelling and your connection.", "L'adresse est inaccessible ({0}). Vérifiez l'orthographe et votre connexion.", "无法访问该地址（{0}）。请检查拼写和网络连接。"],
    "server.redirects": ["Die Adresse leitet auf {0} weiter. Gib bitte diese Adresse ein.", "The address redirects to {0}. Please enter that address instead.", "L'adresse redirige vers {0}. Saisissez plutôt cette adresse.", "该地址会重定向到 {0}。请改为输入这个地址。"],
    "server.proxyAuth": ["Der Server verlangt zuerst eine Anmeldung (HTTP {0}), zum Beispiel an einem vorgeschalteten Proxy oder VPN. Melde dich dort an oder frag deine Administration.", "The server asks you to sign in first (HTTP {0}), for example at a proxy or VPN in front of it. Sign in there or ask your administrator.", "Le serveur demande d'abord une connexion (HTTP {0}), par exemple à un proxy ou un VPN placé devant. Connectez-vous là ou demandez à votre administration.", "服务器要求先登录（HTTP {0}），例如在其前面的代理或 VPN 上。请先在那里登录，或询问你的管理员。"],
    "server.status": ["Der Server antwortet mit einem Fehler (HTTP {0}). Flowplan ist dort gerade nicht erreichbar.", "The server answers with an error (HTTP {0}). Flowplan is not available there right now.", "Le serveur répond par une erreur (HTTP {0}). Flowplan n'y est pas disponible pour le moment.", "服务器返回错误（HTTP {0}）。Flowplan 目前无法在该地址使用。"],
    "server.html": ["Unter dieser Adresse antwortet eine Webseite, aber kein Flowplan – vielleicht eine Anmeldeseite oder ein anderer Dienst.", "A web page answers at this address, but not Flowplan – maybe a sign-in page or another service.", "Une page web répond à cette adresse, mais pas Flowplan – peut-être une page de connexion ou un autre service.", "该地址返回的是一个网页，而不是 Flowplan——可能是登录页或其他服务。"],
    "server.notFlowplan": ["Dort läuft kein Flowplan.", "There is no Flowplan running there.", "Aucun Flowplan ne fonctionne à cette adresse.", "该地址上没有运行 Flowplan。"],
    "server.notFound": ["Unter {0} wurde keine Flowplan-Instanz gefunden ({1})", "No Flowplan instance was found at {0} ({1})", "Aucune instance Flowplan n'a été trouvée sous {0} ({1})", "在 {0} 未找到 Flowplan 实例（{1}）"],

    // Menu (main.js)
    "menu.about": ["Über Flowplan", "About Flowplan", "À propos de Flowplan", "关于 Flowplan"],
    "menu.checkUpdates": ["Nach Updates suchen …", "Check for Updates…", "Rechercher des mises à jour…", "检查更新…"],
    "menu.profiles": ["Profile", "Profiles", "Profils", "账户"],
    "menu.nextProfile": ["Nächstes Profil", "Next Profile", "Profil suivant", "下一个账户"],
    "menu.addProfile": ["Profil hinzufügen …", "Add Profile…", "Ajouter un profil…", "添加账户…"],
    "menu.manageProfiles": ["Profile verwalten …", "Manage Profiles…", "Gérer les profils…", "管理账户…"],
    "menu.hide": ["Flowplan ausblenden", "Hide Flowplan", "Masquer Flowplan", "隐藏 Flowplan"],
    "menu.hideOthers": ["Andere ausblenden", "Hide Others", "Masquer les autres", "隐藏其他"],
    "menu.unhide": ["Alle einblenden", "Show All", "Tout afficher", "全部显示"],
    "menu.quitMac": ["Flowplan beenden", "Quit Flowplan", "Quitter Flowplan", "退出 Flowplan"],
    "menu.file": ["Datei", "File", "Fichier", "文件"],
    "menu.quit": ["Beenden", "Quit", "Quitter", "退出"],
    "menu.edit": ["Bearbeiten", "Edit", "Édition", "编辑"],
    "menu.undo": ["Widerrufen", "Undo", "Annuler", "撤销"],
    "menu.redo": ["Wiederholen", "Redo", "Rétablir", "重做"],
    "menu.cut": ["Ausschneiden", "Cut", "Couper", "剪切"],
    "menu.copy": ["Kopieren", "Copy", "Copier", "复制"],
    "menu.paste": ["Einsetzen", "Paste", "Coller", "粘贴"],
    "menu.pasteAndMatchStyle": ["Ohne Formatierung einsetzen", "Paste and Match Style", "Coller sans mise en forme", "粘贴并匹配样式"],
    "menu.selectAll": ["Alles auswählen", "Select All", "Tout sélectionner", "全选"],
    "menu.view": ["Ansicht", "View", "Affichage", "视图"],
    "menu.reload": ["Neu laden", "Reload", "Recharger", "重新加载"],
    "menu.forceReload": ["Neu laden ohne Cache", "Reload Ignoring Cache", "Recharger sans le cache", "忽略缓存并重新加载"],
    "menu.resetZoom": ["Originalgröße", "Actual Size", "Taille réelle", "实际大小"],
    "menu.zoomIn": ["Vergrößern", "Zoom In", "Agrandir", "放大"],
    "menu.zoomOut": ["Verkleinern", "Zoom Out", "Réduire", "缩小"],
    "menu.fullscreen": ["Vollbild", "Full Screen", "Plein écran", "全屏"],
    "menu.devTools": ["Entwicklerwerkzeuge", "Developer Tools", "Outils de développement", "开发者工具"],
    // A page of the window that crashed or stopped answering (main.js, #182)
    "page.gone": ["Diese Seite ist abgestürzt.", "This page crashed.", "Cette page a planté.", "此页面已崩溃。"],
    "page.goneDetail": ["Grund: {0} (Code {1}). Lade die Seite neu. Passiert es wieder, öffne vorher Ansicht → Entwicklerwerkzeuge ({2}) und kopiere die roten Meldungen im Tab „Console“ in deinen Fehlerbericht.", "Reason: {0} (code {1}). Reload the page. If it happens again, open View → Developer Tools ({2}) first and copy the red messages in the Console tab into your bug report.", "Raison : {0} (code {1}). Rechargez la page. Si cela se reproduit, ouvrez d'abord Affichage → Outils de développement ({2}) et copiez les messages rouges de l'onglet Console dans votre rapport de bug.", "原因：{0}（代码 {1}）。请重新加载页面。如果再次发生，请先打开 视图 → 开发者工具（{2}），并将“Console”标签中的红色消息复制到你的错误报告中。"],
    "page.hung": ["Diese Seite reagiert nicht mehr.", "This page is not responding.", "Cette page ne répond plus.", "此页面无响应。"],
    "page.hungDetail": ["Du kannst warten oder die Seite neu laden. Für einen Fehlerbericht: Ansicht → Entwicklerwerkzeuge ({0}), Tab „Console“.", "You can wait or reload the page. For a bug report: View → Developer Tools ({0}), Console tab.", "Vous pouvez attendre ou recharger la page. Pour un rapport de bug : Affichage → Outils de développement ({0}), onglet Console.", "你可以等待或重新加载页面。如需提交错误报告：视图 → 开发者工具（{0}），“Console”标签。"],
    "page.wait": ["Warten", "Wait", "Attendre", "等待"],
    "menu.navigation": ["Navigation", "Navigation", "Navigation", "导航"],
    "menu.back": ["Zurück", "Back", "Précédent", "后退"],
    "menu.forward": ["Vorwärts", "Forward", "Suivant", "前进"],
    "menu.home": ["Startseite", "Home", "Accueil", "主页"],
    "menu.openInBrowser": ["Im Browser öffnen", "Open in Browser", "Ouvrir dans le navigateur", "在浏览器中打开"],
    "menu.window": ["Fenster", "Window", "Fenêtre", "窗口"],
    "menu.minimize": ["Minimieren", "Minimize", "Réduire", "最小化"],
    "menu.zoom": ["Zoomen", "Zoom", "Zoom", "缩放"],
    "menu.front": ["Alle nach vorne", "Bring All to Front", "Tout ramener au premier plan", "前置全部窗口"],
    "menu.close": ["Schließen", "Close", "Fermer", "关闭"],
    "menu.notifications": ["Mitteilungen", "Notifications", "Notifications", "通知"],
    "menu.notificationsShow": ["Mitteilungen anzeigen", "Show Notifications", "Afficher les notifications", "显示通知"],
    "menu.doNotDisturb": ["Nicht stören", "Do Not Disturb", "Ne pas déranger", "请勿打扰"],
    "menu.dndOff": ["Aus", "Off", "Désactivé", "关闭"],
    "menu.dndHour": ["Für 1 Stunde", "For 1 Hour", "Pendant 1 heure", "1 小时"],
    "menu.dndTomorrow": ["Bis morgen", "Until Tomorrow", "Jusqu'à demain", "直到明天"],
    "menu.dndUntil": ["Stumm bis {0}", "Muted until {0}", "En sourdine jusqu'à {0}", "静音至 {0}"],
    "menu.notificationsAllProfiles": ["Alle Profile", "All Profiles", "Tous les profils", "所有账户"],
    "menu.settings": ["Einstellungen …", "Settings…", "Réglages…", "设置…"],
    "menu.quickCapture": ["Schnell erfassen …", "Quick Capture…", "Capture rapide…", "快速捕获…"],
    "menu.captureShortcut": ["Tastenkürzel {0} in jeder App", "Shortcut {0} in Every App", "Raccourci {0} dans toute application", "在任意应用中按 {0}"],
    "menu.pageInNewWindow": ["Seite in neuem Fenster öffnen", "Open Page in New Window", "Ouvrir la page dans une nouvelle fenêtre", "在新窗口中打开页面"],
    "menu.print": ["Drucken …", "Print…", "Imprimer…", "打印…"],
    "menu.savePdf": ["Als PDF sichern …", "Save as PDF…", "Enregistrer en PDF…", "存储为 PDF…"],
    "menu.restartToUpdate": ["Neu starten und auf {0} aktualisieren", "Restart to Update to {0}", "Redémarrer pour passer à {0}", "重新启动以更新到 {0}"],

    // Right-click menu (context-menu.js)
    "context.noSuggestions": ["Keine Vorschläge", "No Suggestions", "Aucune suggestion", "无拼写建议"],
    "context.addToDictionary": ["Zum Wörterbuch hinzufügen", "Add to Dictionary", "Ajouter au dictionnaire", "添加到词典"],
    "context.openLinkWindow": ["Link in neuem Fenster öffnen", "Open Link in New Window", "Ouvrir le lien dans une nouvelle fenêtre", "在新窗口中打开链接"],
    "context.openLink": ["Link im Browser öffnen", "Open Link in Browser", "Ouvrir le lien dans le navigateur", "在浏览器中打开链接"],
    "context.copyLink": ["Link-Adresse kopieren", "Copy Link Address", "Copier l'adresse du lien", "复制链接地址"],
    "context.copyEmail": ["E-Mail-Adresse kopieren", "Copy Email Address", "Copier l'adresse e-mail", "复制电子邮件地址"],
    "context.copyImage": ["Bild kopieren", "Copy Image", "Copier l'image", "复制图像"],
    "context.saveImage": ["Bild sichern unter …", "Save Image As…", "Enregistrer l'image sous…", "图像存储为…"],
    "context.pastePlain": ["Als reinen Text einsetzen", "Paste as Plain Text", "Coller en texte brut", "粘贴为纯文本"],
    "context.lookUp": ["„{0}“ nachschlagen", "Look Up “{0}”", "Rechercher « {0} »", "查询“{0}”"],
    "context.spellingLanguages": ["Rechtschreibung", "Spelling", "Orthographe", "拼写"],
    "context.inspect": ["Element untersuchen", "Inspect Element", "Inspecter l'élément", "检查元素"],
    "spelling.de-DE": ["Deutsch", "German", "Allemand", "德语"],
    "spelling.en-US": ["Englisch", "English", "Anglais", "英语"],
    "spelling.fr-FR": ["Französisch", "French", "Français", "法语"],

    // Quick capture (capture.js, pages/capture.html)
    "capture.title": ["Schnell erfassen", "Quick capture", "Capture rapide", "快速捕获"],
    "capture.placeholder": ["Was willst du festhalten? z. B. „Angebot schreiben morgen 15 Uhr #kunde @anna !hoch“", "What do you want to capture? e.g. “Write offer tomorrow 3pm #client @anna !high”", "Que voulez-vous noter ? p. ex. « Écrire l'offre demain à 15h #client @anna !haute »", "你想记下什么？例如“写报价 tomorrow 3pm #客户 @anna !high”"],
    "capture.asTask": ["Als Aufgabe für heute", "As a task for today", "Comme tâche pour aujourd'hui", "作为今天的任务"],
    "capture.hint": ["Enter speichert · Umschalt+Enter neue Zeile · Tab Ziel · Esc schließt", "Enter saves · Shift+Enter new line · Tab target · Esc closes", "Entrée enregistre · Maj+Entrée nouvelle ligne · Tab cible · Échap ferme", "Enter 保存 · Shift+Enter 换行 · Tab 选择目标 · Esc 关闭"],
    "capture.target": ["in den Eingang von {0}", "into the inbox of {0}", "dans la boîte de réception de {0}", "存入 {0} 的收件箱"],
    "capture.inbox": ["Eingang", "Inbox", "Boîte de réception", "收件箱"],
    "capture.saving": ["Speichere …", "Saving…", "Enregistrement…", "正在保存…"],
    "capture.saved": ["✓ Gespeichert in „{0}“", "✓ Saved to “{0}”", "✓ Enregistré dans « {0} »", "✓ 已保存到“{0}”"],
    "capture.savedTask": ["✓ Aufgabe für heute in „{0}“", "✓ Task for today in “{0}”", "✓ Tâche pour aujourd'hui dans « {0} »", "✓ 已作为今天的任务存入“{0}”"],
    "capture.empty": ["Schreib zuerst etwas.", "Write something first.", "Écrivez d'abord quelque chose.", "请先输入内容。"],
    "capture.tooLong": ["Der Text ist zu lang (höchstens 20 000 Zeichen).", "The text is too long (at most 20,000 characters).", "Le texte est trop long (20 000 caractères au maximum).", "文本过长（最多 20,000 个字符）。"],
    "capture.offline": ["Keine Verbindung zu {0}. Der Text bleibt hier – versuch es gleich noch einmal.", "No connection to {0}. The text stays here – try again in a moment.", "Pas de connexion à {0}. Le texte reste ici – réessayez dans un instant.", "无法连接到 {0}。文本会保留在这里——请稍后再试。"],
    "capture.signedOut": ["Bei {0} nicht angemeldet. Melde dich im Flowplan-Fenster an; der Text bleibt hier.", "Not signed in to {0}. Sign in in the Flowplan window; the text stays here.", "Non connecté à {0}. Connectez-vous dans la fenêtre Flowplan ; le texte reste ici.", "尚未登录 {0}。请在 Flowplan 窗口中登录；文本会保留在这里。"],
    "capture.noInbox": ["Kein Eingang gefunden. Lege in Flowplan unter „Erfassen“ eine Datenbank als Standard fest.", "No inbox found. In Flowplan, choose a default database under “Capture”.", "Aucune boîte de réception. Dans Flowplan, choisissez une base de données par défaut sous « Capturer ».", "未找到收件箱。请在 Flowplan 的“捕获”下选择一个默认数据库。"],
    "capture.noProfile": ["Zuerst eine Flowplan-Instanz einrichten.", "Set up a Flowplan instance first.", "Configurez d'abord une instance Flowplan.", "请先设置一个 Flowplan 实例。"],
    "capture.failed": ["Speichern hat nicht geklappt. Der Text bleibt hier.", "Saving did not work. The text stays here.", "L'enregistrement a échoué. Le texte reste ici.", "保存失败。文本会保留在这里。"],
    "capture.targetLabel": ["Ziel", "Target", "Cible", "目标"],
    "capture.targetSearch": ["Ziel suchen …", "Search targets…", "Chercher une cible…", "搜索目标…"],
    "capture.kind.inbox": ["Eingang", "Inbox", "Boîte de réception", "收件箱"],
    "capture.kind.database": ["Datenbank – neuer Eintrag", "Database – new record", "Base de données – nouvelle entrée", "数据库——新记录"],
    "capture.kind.document": ["Seite – unten angehängt", "Page – appended at the end", "Page – ajouté à la fin", "页面——追加到末尾"],
    "capture.kind.journal": ["Journal – heutiger Eintrag", "Journal – today's entry", "Journal – entrée du jour", "日记——今天的条目"],
    "capture.recentTarget": ["zuletzt", "recent", "récent", "最近"],
    "capture.noTargets": ["Keine passenden Ziele.", "No matching targets.", "Aucune cible correspondante.", "没有匹配的目标。"],
    "capture.encryptedNote": ["{0} Seite(n) in Ende-zu-Ende-verschlüsselten Bereichen fehlen hier: Der Server kann nicht in sie schreiben, und dieses Fenster hat keine Schlüssel. Erfasse dort direkt im Flowplan-Fenster.", "{0} page(s) in end-to-end encrypted spaces are not listed: the server cannot write into them, and this window has no keys. Capture there directly in the Flowplan window.", "{0} page(s) d'espaces chiffrés de bout en bout ne sont pas listées : le serveur ne peut pas y écrire et cette fenêtre n'a pas de clés. Capturez-y directement dans la fenêtre Flowplan.", "端到端加密空间中的 {0} 个页面未列出：服务器无法写入这些页面，而此窗口没有密钥。请直接在 Flowplan 窗口中捕获。"],
    "capture.chipKeep": ["Als Text behalten", "Keep as text", "Garder comme texte", "保留为文本"],
    "capture.chipText": ["bleibt Text", "stays text", "reste du texte", "保留为文本"],
    "capture.chipTask": ["Aufgabe", "Task", "Tâche", "任务"],
    "capture.shorthandOffline": ["Ohne Verbindung: Kürzel wie #tag oder morgen werden beim Senden ausgewertet.", "Offline: shorthand like #tag or tomorrow is read when the capture is sent.", "Hors ligne : les raccourcis comme #tag ou demain sont lus à l'envoi.", "离线：#标签 或 tomorrow 等简写会在发送时识别。"],
    "capture.paste": ["Einfügen", "Paste", "Coller", "粘贴"],
    "capture.pasteTitle": ["Zwischenablage einfügen ({0}) – ein Link bekommt seinen Titel", "Paste the clipboard ({0}) – a link gets its title", "Coller le presse-papiers ({0}) – un lien reçoit son titre", "粘贴剪贴板内容（{0}）——链接会自动获取标题"],
    "capture.clipboardEmpty": ["Die Zwischenablage ist leer.", "The clipboard is empty.", "Le presse-papiers est vide.", "剪贴板为空。"],
    "capture.attach": ["Anhängen …", "Attach…", "Joindre…", "添加附件…"],
    "capture.attachTitle": ["Bilder, PDFs, Markdown- oder Textdateien anhängen (oder hierher ziehen)", "Attach images, PDFs, Markdown or text files (or drop them here)", "Joindre images, PDF, fichiers Markdown ou texte (ou les déposer ici)", "添加图片、PDF、Markdown 或文本文件作为附件（也可拖到这里）"],
    "capture.attachFilter": ["Bilder, PDFs, Markdown und Text", "Images, PDFs, Markdown and text", "Images, PDF, Markdown et texte", "图片、PDF、Markdown 和文本"],
    "capture.screen": ["Ausschnitt", "Region", "Zone", "截取区域"],
    "capture.screenTitle": ["Bildschirmausschnitt aufnehmen und anhängen", "Capture a screen region and attach it", "Capturer une zone de l'écran et la joindre", "截取屏幕区域并添加为附件"],
    "capture.screenPermission": ["Flowplan darf den Bildschirm nicht aufnehmen. Erlaube es unter Systemeinstellungen → Datenschutz & Sicherheit → Bildschirm- & Systemaudioaufnahme und starte Flowplan neu.", "Flowplan may not record the screen. Allow it in System Settings → Privacy & Security → Screen & System Audio Recording, then restart Flowplan.", "Flowplan ne peut pas enregistrer l'écran. Autorisez-le dans Réglages Système → Confidentialité et sécurité → Enregistrement de l'écran et de l'audio système, puis redémarrez Flowplan.", "Flowplan 没有录制屏幕的权限。请在“系统设置”→“隐私与安全性”→“录屏与系统录音”中允许，然后重新启动 Flowplan。"],
    "capture.screenUnavailable": ["Der Bildschirm ließ sich nicht aufnehmen.", "The screen could not be captured.", "Impossible de capturer l'écran.", "无法截取屏幕。"],
    "capture.openSystemSettings": ["Systemeinstellungen öffnen", "Open System Settings", "Ouvrir les Réglages Système", "打开系统设置"],
    "capture.voice": ["Halten zum Sprechen", "Hold to talk", "Maintenir pour parler", "按住说话"],
    "capture.voiceTitle": ["Gedrückt halten und sprechen ({0}) – die Sprachnotiz wird zu Text", "Hold and speak ({0}) – the voice note becomes text", "Maintenez et parlez ({0}) – la note vocale devient du texte", "按住并说话（{0}）——语音笔记会转为文本"],
    "capture.voiceRecording": ["Aufnahme läuft … loslassen zum Beenden", "Recording… release to stop", "Enregistrement… relâchez pour arrêter", "正在录音…松开即停止"],
    "capture.voiceWorking": ["Sprachnotiz wird umgewandelt …", "Transcribing the voice note…", "Transcription de la note vocale…", "正在转写语音笔记…"],
    "capture.voiceTranscribed": ["Sprachnotiz als Text eingefügt.", "Voice note inserted as text.", "Note vocale insérée comme texte.", "语音笔记已作为文本插入。"],
    "capture.voiceAttached": ["Sprachnotiz angehängt – die Instanz wandelt sie beim Speichern in Text um, wenn sie es kann.", "Voice note attached – the instance turns it into text when it is saved, if it can.", "Note vocale jointe – l'instance la transforme en texte à l'enregistrement si elle le peut.", "语音笔记已添加为附件——保存时，实例会在支持的情况下将其转为文本。"],
    "capture.voiceFailed": ["Die Aufnahme hat nicht geklappt.", "The recording did not work.", "L'enregistrement a échoué.", "录音失败。"],
    "capture.voiceName": ["Sprachnotiz", "Voice note", "Note vocale", "语音笔记"],
    "capture.micDenied": ["Flowplan darf das Mikrofon nicht nutzen. Erlaube es unter Systemeinstellungen → Datenschutz & Sicherheit → Mikrofon.", "Flowplan may not use the microphone. Allow it in System Settings → Privacy & Security → Microphone.", "Flowplan ne peut pas utiliser le micro. Autorisez-le dans Réglages Système → Confidentialité et sécurité → Micro.", "Flowplan 没有使用麦克风的权限。请在“系统设置”→“隐私与安全性”→“麦克风”中允许。"],
    "capture.micUnavailable": ["Kein Mikrofon gefunden oder nicht erlaubt.", "No microphone found, or not allowed.", "Aucun micro trouvé, ou non autorisé.", "未找到麦克风，或未获允许。"],
    "capture.dropHere": ["Bilder, PDFs, Markdown oder Text hier ablegen", "Drop images, PDFs, Markdown or text here", "Déposez ici images, PDF, Markdown ou texte", "将图片、PDF、Markdown 或文本拖到这里"],
    "capture.refused": ["{0}: {1}", "{0}: {1}", "{0} : {1}", "{0}：{1}"],
    "capture.tooManyFiles": ["Höchstens {0} Anhänge.", "At most {0} attachments.", "{0} pièces jointes au maximum.", "最多 {0} 个附件。"],
    "capture.remove": ["Entfernen", "Remove", "Retirer", "移除"],
    "capture.attachmentsOnly": ["Anhang", "Attachment", "Pièce jointe", "附件"],
    "capture.suggest": ["Vorschlag", "Suggest", "Suggérer", "建议"],
    "capture.suggestTitle": ["KI schlägt Ziel, Titel und Eigenschaften vor – nichts wird ohne dich übernommen", "AI suggests target, title and properties – nothing is applied without you", "L'IA propose cible, titre et propriétés – rien n'est appliqué sans vous", "AI 会建议目标、标题和属性——未经你确认不会应用任何内容"],
    "capture.suggestHeading": ["KI-Vorschlag", "AI suggestion", "Suggestion de l'IA", "AI 建议"],
    "capture.suggestDevice": ["auf diesem Mac", "on this Mac", "sur ce Mac", "在这台 Mac 上"],
    "capture.suggestServer": ["von der KI der Instanz", "from the instance's AI", "de l'IA de l'instance", "来自实例的 AI"],
    "capture.suggestAccept": ["Übernehmen", "Accept", "Accepter", "接受"],
    "capture.suggestIgnore": ["Ignorieren", "Ignore", "Ignorer", "忽略"],
    "capture.suggestTarget": ["Nach „{0}“", "Into “{0}”", "Dans « {0} »", "存入“{0}”"],
    "capture.suggestTitleChip": ["Titel: {0}", "Title: {0}", "Titre : {0}", "标题：{0}"],
    "capture.suggestNothing": ["Die KI hat nichts Passendes vorgeschlagen.", "The AI suggested nothing that fits.", "L'IA n'a rien proposé qui convienne.", "AI 没有给出合适的建议。"],
    "capture.suggestWorking": ["Die KI denkt nach …", "The AI is thinking…", "L'IA réfléchit…", "AI 正在思考…"],
    "capture.suggestOff": ["KI ist für dich ausgeschaltet.", "AI is switched off for you.", "L'IA est désactivée pour vous.", "AI 已为你关闭。"],
    "capture.suggestFailed": ["Die KI konnte keinen Vorschlag machen.", "The AI could not make a suggestion.", "L'IA n'a pas pu faire de suggestion.", "AI 无法给出建议。"],
    // "Text verbessern" (#172) – the web app's words (Flowplan's locales).
    "capture.improve": ["Text verbessern", "Improve text", "Améliorer le texte", "改进文本"],
    "capture.improveTitle": ["Rechtschreibung und Grammatik mit KI verbessern – gespeichert wird erst beim Speichern", "Improve spelling and grammar with AI – nothing is saved until you save", "Améliorer l'orthographe et la grammaire avec l'IA – rien n'est enregistré avant l'enregistrement", "使用 AI 改进拼写和语法——在你保存之前不会保存任何内容"],
    "capture.improveWorking": ["Die KI verbessert den Text …", "The AI is improving the text…", "L'IA améliore le texte…", "AI 正在改进文本…"],
    "capture.improveUse": ["Übernehmen", "Use", "Utiliser", "使用"],
    "capture.improveKeep": ["Original behalten", "Keep original", "Garder l'original", "保留原文"],
    "capture.improveLost": ["Dabei ginge verloren: {0}", "This would lose: {0}", "Cela ferait perdre : {0}", "这样会丢失：{0}"],
    "capture.improveNothing": ["Die KI hat nichts zu verbessern gefunden.", "The AI found nothing to improve.", "L'IA n'a rien trouvé à améliorer.", "AI 没有发现需要改进的地方。"],
    "capture.improveFailed": ["Die KI konnte den Text nicht verbessern.", "The AI could not improve the text.", "L'IA n'a pas pu améliorer le texte.", "AI 无法改进文本。"],
    "capture.queued": ["Ohne Verbindung zu {0} – in der Warteschlange, wird automatisch gesendet.", "No connection to {0} – queued, sent automatically.", "Pas de connexion à {0} – en file d'attente, envoyé automatiquement.", "无法连接到 {0}——已加入队列，将自动发送。"],
    "capture.queueCount": ["{0} in der Warteschlange", "{0} queued", "{0} en attente", "{0} 条在队列中"],
    "capture.queueFull": ["Die Warteschlange ist voll. Der Text bleibt hier.", "The queue is full. The text stays here.", "La file d'attente est pleine. Le texte reste ici.", "队列已满。文本会保留在这里。"],
    "capture.queueSent": ["{0} Erfassung(en) aus der Warteschlange gesendet", "{0} queued capture(s) sent", "{0} capture(s) en attente envoyée(s)", "已发送队列中的 {0} 条捕获"],
    "capture.queueAttention": ["{0} Erfassung(en) konnten nicht gesendet werden", "{0} capture(s) could not be sent", "{0} capture(s) n'ont pas pu être envoyée(s)", "{0} 条捕获无法发送"],
    "capture.queueRetry": ["Jetzt senden", "Send now", "Envoyer maintenant", "立即发送"],
    "capture.discard": ["Verwerfen", "Discard", "Supprimer", "丢弃"],
    "capture.copy": ["Kopieren", "Copy", "Copier", "复制"],
    "capture.open": ["Öffnen", "Open", "Ouvrir", "打开"],
    "capture.undo": ["Rückgängig", "Undo", "Annuler", "撤销"],
    "capture.undone": ["Rückgängig gemacht.", "Undone.", "Annulé.", "已撤销。"],
    "capture.undoTooLate": ["Das lässt sich nicht mehr rückgängig machen.", "This can no longer be undone.", "Ce n'est plus annulable.", "已无法撤销。"],
    "capture.undoChanged": ["Inzwischen geändert – bleibt, wie es ist.", "Changed in the meantime – left as it is.", "Modifié entre-temps – laissé tel quel.", "期间已被更改——保持原样。"],
    "capture.recent": ["Zuletzt erfasst", "Recently captured", "Capturé récemment", "最近捕获"],
    "capture.recentEmpty": ["Noch nichts erfasst.", "Nothing captured yet.", "Rien de capturé pour l'instant.", "还没有捕获任何内容。"],
    "capture.recentQueued": ["wartet", "waiting", "en attente", "等待中"],
    "capture.legacy": ["Diese Instanz kann nur Text in den Eingang übernehmen – für Ziele, Links und Anhänge Flowplan auf dem Server aktualisieren.", "This instance only takes text into the inbox – update Flowplan on the server for targets, links and attachments.", "Cette instance n'accepte que du texte dans la boîte de réception – mettez Flowplan à jour sur le serveur pour les cibles, liens et pièces jointes.", "此实例只能将文本存入收件箱——如需目标、链接和附件，请在服务器上更新 Flowplan。"],
    "capture.action": ["Schnellaktion: {0}", "Quick action: {0}", "Action rapide : {0}", "快速操作：{0}"],
    "capture.template": ["Vorlage: {0}", "Template: {0}", "Modèle : {0}", "模板：{0}"],

    // Quick actions (capture-actions.js, pages/settings.html)
    "actions.task": ["Aufgabe", "Task", "Tâche", "任务"],
    "actions.journal": ["Journal-Eintrag", "Journal entry", "Entrée de journal", "日记条目"],
    "actions.bookmark": ["Lesezeichen", "Bookmark", "Signet", "书签"],
    "actions.meeting": ["Besprechungsnotiz", "Meeting note", "Note de réunion", "会议记录"],
    "actions.meetingPrefix": ["Besprechung: ", "Meeting: ", "Réunion : ", "会议："],
    "actions.note": ["Notiz", "Note", "Note", "笔记"],
    "actions.template": ["Aus Vorlage", "From template", "Depuis un modèle", "使用模板"],

    // Tray and menu bar icon (tray.js)
    "tray.capture": ["Schnell erfassen …", "Quick Capture…", "Capture rapide…", "快速捕获…"],
    "tray.today": ["Heute", "Today", "Aujourd'hui", "今天"],
    "tray.loading": ["Lade Aufgaben …", "Loading tasks…", "Chargement des tâches…", "正在加载任务…"],
    "tray.noTasks": ["Keine Aufgaben für heute", "No tasks for today", "Aucune tâche pour aujourd'hui", "今天没有任务"],
    "tray.moreTasks": ["{0} weitere …", "{0} more…", "{0} de plus…", "还有 {0} 项…"],
    "tray.signedOut": ["Nicht angemeldet", "Not signed in", "Non connecté", "未登录"],
    "tray.tasksUnavailable": ["Aufgaben gerade nicht erreichbar", "Tasks not available right now", "Tâches indisponibles pour le moment", "暂时无法获取任务"],
    "tray.unread": ["{0} ungelesene Benachrichtigungen", "{0} unread notifications", "{0} notifications non lues", "{0} 条未读通知"],
    "tray.noUnread": ["Posteingang", "Inbox", "Boîte de réception", "收件箱"],
    "tray.open": ["Flowplan öffnen", "Open Flowplan", "Ouvrir Flowplan", "打开 Flowplan"],
    "tray.queued": ["{0} warten auf Verbindung – jetzt senden", "{0} waiting for a connection – send now", "{0} en attente de connexion – envoyer maintenant", "{0} 条等待连接——立即发送"],
    "tray.queueFailed": ["{0} nicht gesendet – ansehen …", "{0} not sent – view…", "{0} non envoyé(s) – voir…", "{0} 条未发送——查看…"],
    "tray.recent": ["Zuletzt erfasst", "Recently Captured", "Capturé récemment", "最近捕获"],

    // Settings (pages/settings.html)
    "settings.title": ["Einstellungen", "Settings", "Réglages", "设置"],
    "settings.general": ["Allgemein", "General", "Général", "通用"],
    "settings.tray": ["Symbol im Infobereich der Taskleiste", "Icon in the notification area", "Icône dans la zone de notification", "通知区域中的图标"],
    "settings.trayMac": ["Symbol in der Menüleiste", "Icon in the menu bar", "Icône dans la barre des menus", "菜单栏中的图标"],
    "settings.trayHint": ["Schnell erfassen, die Aufgaben von heute und ungelesene Benachrichtigungen. Unter Windows und Linux läuft Flowplan dann nach dem Schließen des Fensters weiter.", "Quick capture, today's tasks and unread notifications. On Windows and Linux, Flowplan then keeps running after its window is closed.", "Capture rapide, tâches du jour et notifications non lues. Sous Windows et Linux, Flowplan continue alors de tourner après la fermeture de la fenêtre.", "快速捕获、今天的任务和未读通知。在 Windows 和 Linux 上，关闭窗口后 Flowplan 会继续运行。"],
    "settings.launchAtLogin": ["Beim Anmelden öffnen", "Open at login", "Ouvrir à l'ouverture de session", "登录时打开"],
    "settings.startHidden": ["Ohne Fenster starten", "Start without a window", "Démarrer sans fenêtre", "启动时不显示窗口"],
    "settings.capture": ["Schnell erfassen", "Quick capture", "Capture rapide", "快速捕获"],
    "settings.captureHint": ["Ein Tastenkürzel öffnet über jeder App ein kleines Fenster: in den Eingang, eine Datenbank, den heutigen Journal-Eintrag oder an eine Seite – mit Kürzeln wie #tag, @person, morgen 15 Uhr, !hoch, mit Links, Dateien, Bildschirmausschnitten und Sprachnotizen, auch ohne Verbindung.", "A shortcut opens a small window above every app: into the inbox, a database, today's journal entry or a page – with shorthand like #tag, @person, tomorrow 3pm, !high, with links, files, screen regions and voice notes, also offline.", "Un raccourci ouvre une petite fenêtre au-dessus de toute application : dans la boîte de réception, une base de données, l'entrée du jour du journal ou une page – avec des raccourcis comme #tag, @personne, demain 15h, !haute, avec liens, fichiers, zones d'écran et notes vocales, aussi hors ligne.", "按下快捷键，会在任意应用上方打开一个小窗口：存入收件箱、数据库、今天的日记条目或某个页面——支持 #标签、@某人、tomorrow 3pm、!high 等简写，支持链接、文件、屏幕区域和语音笔记，离线也能用。"],
    "settings.shortcutPlaceholder": ["Tastenkombination drücken", "Press a key combination", "Appuyez sur une combinaison de touches", "按下组合键"],
    "settings.shortcutChange": ["Ändern", "Change", "Modifier", "更改"],
    "settings.shortcutDefault": ["Standard", "Default", "Par défaut", "默认"],
    "settings.shortcutOff": ["Aus", "Off", "Désactiver", "关闭"],
    "settings.shortcutOk": ["Aktiv – funktioniert in jeder App.", "Active – works in every app.", "Actif – fonctionne dans toute application.", "已启用——在任意应用中均可使用。"],
    "settings.shortcutIsOff": ["Ausgeschaltet – Schnell erfassen bleibt im Menü und im Symbol.", "Off – quick capture stays in the menu and the icon.", "Désactivé – la capture rapide reste dans le menu et l'icône.", "已关闭——快速捕获仍可从菜单和图标中使用。"],
    "settings.shortcutTaken": ["{0} ist schon von einer anderen App belegt. Wähle eine andere Kombination.", "{0} is already used by another app. Choose another combination.", "{0} est déjà utilisé par une autre application. Choisissez une autre combinaison.", "{0} 已被其他应用占用。请选择其他组合键。"],
    "settings.spelling": ["Rechtschreibprüfung", "Spell checking", "Vérification orthographique", "拼写检查"],
    "settings.updates": ["Updates", "Updates", "Mises à jour", "更新"],
    "settings.cancel": ["Abbrechen", "Cancel", "Annuler", "取消"],
    "settings.captureTry": ["Ausprobieren", "Try it", "Essayer", "试一试"],
    "settings.queueTitle": ["Warteschlange ohne Verbindung", "Offline queue", "File d'attente hors ligne", "离线队列"],
    "settings.queueNone": ["Nichts wartet.", "Nothing is waiting.", "Rien n'attend.", "没有等待中的内容。"],
    "settings.queueWaiting": ["{0} Erfassung(en) warten auf die Verbindung und werden automatisch gesendet.", "{0} capture(s) waiting for the connection, sent automatically.", "{0} capture(s) en attente de connexion, envoyée(s) automatiquement.", "{0} 条捕获正在等待连接，将自动发送。"],
    "settings.queueFailed": ["{0} Erfassung(en) brauchen deine Aufmerksamkeit – im Erfassen-Fenster ansehen.", "{0} capture(s) need your attention – view them in the capture window.", "{0} capture(s) demandent votre attention – voir dans la fenêtre de capture.", "{0} 条捕获需要你处理——请在捕获窗口中查看。"],
    "settings.queueSend": ["Jetzt senden", "Send now", "Envoyer maintenant", "立即发送"],
    "settings.queueEncrypted": ["Die Warteschlange und „Zuletzt erfasst“ liegen verschlüsselt mit dem Schlüsselbund des Systems auf diesem Computer.", "The queue and “Recently captured” are stored on this computer, encrypted with the system's key store.", "La file d'attente et « Capturé récemment » sont stockés sur cet ordinateur, chiffrés avec le trousseau du système.", "队列和“最近捕获”保存在这台电脑上，并使用系统的密钥存储加密。"],
    "settings.queuePlain": ["Kein Schlüsselbund des Systems verfügbar: Die Warteschlange und „Zuletzt erfasst“ liegen unverschlüsselt im Datenordner der App, nur für dein Benutzerkonto lesbar.", "No system key store available: the queue and “Recently captured” are stored unencrypted in the app's data folder, readable only by your user account.", "Aucun trousseau système disponible : la file d'attente et « Capturé récemment » sont stockés non chiffrés dans le dossier de données de l'application, lisibles uniquement par votre compte.", "系统密钥存储不可用：队列和“最近捕获”以未加密形式保存在应用的数据文件夹中，仅你的用户账户可读取。"],
    "settings.actionsTitle": ["Schnellaktionen", "Quick actions", "Actions rapides", "快速操作"],
    "settings.actionsHint": ["Weitere Tastenkürzel, die das Erfassen-Fenster passend vorbereitet öffnen. Ohne Tastenkürzel ist keine aktiv.", "More shortcuts that open the capture window ready for one thing. None is active without a shortcut.", "D'autres raccourcis qui ouvrent la fenêtre de capture prête pour une chose. Aucune n'est active sans raccourci.", "更多快捷键，可打开为特定用途准备好的捕获窗口。未设置快捷键的快速操作不会启用。"],
    "settings.actionAdd": ["Hinzufügen …", "Add…", "Ajouter…", "添加…"],
    "settings.actionName": ["Name", "Name", "Nom", "名称"],
    "settings.actionTarget": ["Ziel", "Target", "Cible", "目标"],
    "settings.actionTemplate": ["Vorlage", "Template", "Modèle", "模板"],
    "settings.actionNoTemplate": ["Standardvorlage", "Default template", "Modèle par défaut", "默认模板"],
    "settings.actionTask": ["Als Aufgabe", "As a task", "Comme tâche", "作为任务"],
    "settings.actionRemove": ["Entfernen", "Remove", "Retirer", "移除"],
    "settings.actionStatus.ok": ["Aktiv", "Active", "Actif", "已启用"],
    "settings.actionStatus.off": ["Kein Tastenkürzel – nicht aktiv", "No shortcut – not active", "Pas de raccourci – inactif", "无快捷键——未启用"],
    "settings.actionStatus.conflict": ["Tastenkürzel von einer anderen App belegt", "Shortcut used by another app", "Raccourci utilisé par une autre application", "快捷键已被其他应用占用"],
    "settings.actionStatus.incomplete": ["Erst ein Ziel wählen", "Choose a target first", "Choisissez d'abord une cible", "请先选择目标"],
    "settings.actionNeedsSignIn": ["Ziele erscheinen, sobald das aktive Profil angemeldet ist.", "Targets appear once the active profile is signed in.", "Les cibles apparaissent une fois le profil actif connecté.", "当前账户登录后，目标就会显示。"],
    "settings.actionChooseJournal": ["Journal wählen …", "Choose a journal…", "Choisir un journal…", "选择日记…"],
    "settings.actionChooseDatabase": ["Datenbank wählen …", "Choose a database…", "Choisir une base de données…", "选择数据库…"],

    // Apple's on-device model (device-ai.js, pages/settings.html)
    "settings.deviceAiTitle": ["Apple Intelligence (optional)", "Apple Intelligence (optional)", "Apple Intelligence (facultatif)", "Apple 智能（可选）"],
    "settings.deviceAi": ["Apple Intelligence auf diesem Mac nutzen", "Use Apple Intelligence on this Mac", "Utiliser Apple Intelligence sur ce Mac", "在这台 Mac 上使用 Apple 智能"],
    "settings.deviceAiHint": [
      "Optional. KI-Funktionen von Flowplan können Apples Modell auf diesem Mac nutzen – Texte und Antworten verlassen den Mac nicht. Ausgeschaltet startet Flowplan das Modell nie und die Instanz bekommt keinen Zugriff darauf (offene Seiten nach dem Neuladen). Braucht macOS 26, einen Mac mit Apple-Chip und eingeschaltete Apple Intelligence.",
      "Optional. Flowplan's AI features can use Apple's model on this Mac – prompts and answers never leave the Mac. Switched off, Flowplan never starts the model and the instance gets no access to it (open pages after reloading). Needs macOS 26, a Mac with Apple silicon and Apple Intelligence switched on.",
      "Facultatif. Les fonctions d'IA de Flowplan peuvent utiliser le modèle d'Apple sur ce Mac – les textes et les réponses ne quittent pas le Mac. Désactivé, Flowplan ne démarre jamais le modèle et l'instance n'y a pas accès (pages ouvertes après rechargement). Nécessite macOS 26, un Mac avec puce Apple et Apple Intelligence activé.",
      "可选。Flowplan 的 AI 功能可以使用这台 Mac 上的 Apple 模型——提示和回答都不会离开这台 Mac。关闭后，Flowplan 永远不会启动该模型，实例也无法访问它（已打开的页面在重新加载后生效）。需要 macOS 26、搭载 Apple 芯片的 Mac，并已打开 Apple 智能。",
    ],
    "settings.deviceAiChecking": ["Wird geprüft …", "Checking…", "Vérification…", "正在检查…"],
    "settings.deviceAiIsOff": ["Ausgeschaltet – Flowplan nutzt das Modell nicht.", "Off – Flowplan does not use the model.", "Désactivé – Flowplan n'utilise pas le modèle.", "已关闭——Flowplan 不使用该模型。"],
    "settings.deviceAiAvailable": ["Verfügbar – läuft auf diesem Mac.", "Available – runs on this Mac.", "Disponible – fonctionne sur ce Mac.", "可用——在这台 Mac 上运行。"],
    "settings.deviceAi.unsupported-os": ["Nicht verfügbar – braucht macOS 26 oder neuer.", "Not available – needs macOS 26 or newer.", "Indisponible – nécessite macOS 26 ou plus récent.", "不可用——需要 macOS 26 或更高版本。"],
    "settings.deviceAi.device-not-eligible": ["Nicht verfügbar – dieser Mac unterstützt Apple Intelligence nicht.", "Not available – this Mac does not support Apple Intelligence.", "Indisponible – ce Mac ne prend pas en charge Apple Intelligence.", "不可用——这台 Mac 不支持 Apple 智能。"],
    "settings.deviceAi.apple-intelligence-off": ["Apple Intelligence ist ausgeschaltet – einschalten unter Systemeinstellungen → Apple Intelligence & Siri.", "Apple Intelligence is off – switch it on in System Settings → Apple Intelligence & Siri.", "Apple Intelligence est désactivé – activez-le dans Réglages Système → Apple Intelligence et Siri.", "Apple 智能已关闭——请在“系统设置”→“Apple 智能与 Siri”中打开。"],
    "settings.deviceAi.model-not-ready": ["Das Modell wird noch geladen – bitte später noch einmal.", "The model is still downloading – please try again later.", "Le modèle est encore en cours de téléchargement – réessayez plus tard.", "模型仍在下载——请稍后再试。"],
    "settings.deviceAi.unsupported-language": ["Nicht verfügbar – die Sprache dieses Macs wird noch nicht unterstützt.", "Not available – this Mac's language is not supported yet.", "Indisponible – la langue de ce Mac n'est pas encore prise en charge.", "不可用——尚不支持这台 Mac 的语言。"],
    "settings.deviceAi.error": ["Der Zustand ließ sich nicht abfragen.", "Could not check the status.", "Impossible de vérifier l'état.", "无法检查状态。"],
    "ai.error.unavailable": ["Apple Intelligence ist auf diesem Mac nicht verfügbar.", "Apple Intelligence is not available on this Mac.", "Apple Intelligence n'est pas disponible sur ce Mac.", "Apple 智能在这台 Mac 上不可用。"],
    "ai.error.context-too-long": ["Der Text ist zu lang für das Modell auf diesem Mac.", "The text is too long for the model on this Mac.", "Le texte est trop long pour le modèle de ce Mac.", "文本过长，这台 Mac 上的模型无法处理。"],
    "ai.error.guardrail": ["Das Modell hat diese Anfrage abgelehnt.", "The model declined this request.", "Le modèle a refusé cette demande.", "模型拒绝了此请求。"],
    "ai.error.cancelled": ["Abgebrochen.", "Cancelled.", "Annulé.", "已取消。"],
    "ai.error.busy": ["Das Modell beantwortet gerade eine andere Anfrage.", "The model is answering another request.", "Le modèle répond à une autre demande.", "模型正在处理另一个请求。"],
    "ai.error.error": ["Das Modell auf diesem Mac konnte nicht antworten.", "The model on this Mac could not answer.", "Le modèle de ce Mac n'a pas pu répondre.", "这台 Mac 上的模型无法回答。"],

    // Links to pages (deep-links.js)
    "links.unknown": ["{0} als Profil hinzufügen?", "Add {0} as a profile?", "Ajouter {0} comme profil ?", "将 {0} 添加为账户？"],
    "links.unknownDetail": ["Ein Link möchte eine Seite von {0} öffnen. Für diese Instanz gibt es noch kein Profil. Füge sie nur hinzu, wenn du ihr vertraust.", "A link wants to open a page of {0}. There is no profile for this instance yet. Only add it if you trust it.", "Un lien veut ouvrir une page de {0}. Il n'existe pas encore de profil pour cette instance. Ne l'ajoutez que si vous lui faites confiance.", "一个链接想要打开 {0} 上的页面。此实例还没有账户。仅在你信任它时才添加。"],
    "links.add": ["Hinzufügen und öffnen", "Add and Open", "Ajouter et ouvrir", "添加并打开"],
    "links.browser": ["Im Browser öffnen", "Open in Browser", "Ouvrir dans le navigateur", "在浏览器中打开"],
    "links.cancel": ["Abbrechen", "Cancel", "Annuler", "取消"],
    "links.failed": ["Link kann nicht geöffnet werden", "Cannot open the link", "Impossible d'ouvrir le lien", "无法打开链接"],

    // Files handed to the app (files.js)
    "files.noProfile": ["Richte zuerst eine Flowplan-Instanz ein, dann kannst du Dateien hineinziehen.", "Set up a Flowplan instance first, then you can drop files on it.", "Configurez d'abord une instance Flowplan, puis vous pourrez y déposer des fichiers.", "请先设置一个 Flowplan 实例，然后就可以将文件拖到上面。"],
    "files.confirm": ["{0} Datei(en) zu „{1}“ hinzufügen?", "Add {0} file(s) to “{1}”?", "Ajouter {0} fichier(s) à « {1} » ?", "将 {0} 个文件添加到“{1}”？"],
    "files.where": ["In den Eingang: ein Eintrag je Datei. Als neue Seiten: eine Seite je Datei. Alles wird an {0} gesendet.", "Into the inbox: one record per file. As new pages: one page per file. Everything is sent to {0}.", "Dans la boîte de réception : une entrée par fichier. Comme nouvelles pages : une page par fichier. Tout est envoyé à {0}.", "存入收件箱：每个文件一条记录。作为新页面：每个文件一个页面。所有内容都会发送到 {0}。"],
    "files.toInbox": ["In den Eingang", "Into the Inbox", "Dans la boîte de réception", "存入收件箱"],
    "files.asPages": ["Als neue Seiten", "As New Pages", "Comme nouvelles pages", "作为新页面"],
    "files.cancel": ["Abbrechen", "Cancel", "Annuler", "取消"],
    "files.none": ["Diese Dateien kann Flowplan nicht übernehmen", "Flowplan cannot take these files", "Flowplan ne peut pas prendre ces fichiers", "Flowplan 无法接收这些文件"],
    "files.tooMany": ["Höchstens {0} Dateien auf einmal.", "At most {0} files at once.", "{0} fichiers au maximum à la fois.", "一次最多 {0} 个文件。"],
    "files.refused.type": ["nur PDF, Bilder, Markdown und Text", "only PDF, images, Markdown and text", "seulement PDF, images, Markdown et texte", "仅支持 PDF、图片、Markdown 和文本"],
    "files.refused.size": ["zu groß (Bilder und PDFs bis 50 MB, Text bis 5 MB)", "too large (images and PDFs up to 50 MB, text up to 5 MB)", "trop volumineux (images et PDF jusqu'à 50 Mo, texte jusqu'à 5 Mo)", "文件过大（图片和 PDF 最大 50 MB，文本最大 5 MB）"],
    "files.refused.empty": ["leer", "empty", "vide", "为空"],
    "files.refused.content": ["Inhalt passt nicht zur Endung", "content does not match its extension", "le contenu ne correspond pas à l'extension", "内容与扩展名不符"],
    "files.refused.missing": ["nicht lesbar", "cannot be read", "illisible", "无法读取"],
    "files.done": ["{0} Datei(en) übernommen", "{0} file(s) added", "{0} fichier(s) ajouté(s)", "已添加 {0} 个文件"],
    "files.doneInbox": ["Im Eingang", "In the inbox", "Dans la boîte de réception", "已存入收件箱"],
    "files.donePages": ["Als neue Seiten", "As new pages", "Comme nouvelles pages", "已作为新页面"],
    "files.failed": ["Dateien konnten nicht übernommen werden", "The files could not be added", "Les fichiers n'ont pas pu être ajoutés", "无法添加这些文件"],

    // Printing (print.js)
    "print.preview": ["Druckvorschau", "Print Preview", "Aperçu avant impression", "打印预览"],
    "print.failed": ["Drucken hat nicht geklappt", "Printing did not work", "L'impression a échoué", "打印失败"],

    // Notifications (notifier.js, notifications.js)
    "notifications.many": ["{0} neue Benachrichtigungen", "{0} new notifications", "{0} nouvelles notifications", "{0} 条新通知"],
    "notifications.badge": ["{0} ungelesene Benachrichtigungen", "{0} unread notifications", "{0} notifications non lues", "{0} 条未读通知"],

    // Updates (updates.js, pages/update.html)
    "updates.title": ["Update", "Update", "Mise à jour", "更新"],
    "updates.download": ["Zur Download-Seite", "Download Page", "Page de téléchargement", "下载页面"],
    "updates.later": ["Später", "Later", "Plus tard", "稍后"],
    "updates.hide": ["Ausblenden", "Hide", "Masquer", "隐藏"],
    "updates.ok": ["OK", "OK", "OK", "好"],
    "updates.checking": ["Suche nach Updates …", "Checking for updates…", "Recherche de mises à jour…", "正在检查更新…"],
    "updates.downloading": ["Lade Flowplan {0} …", "Downloading Flowplan {0}…", "Téléchargement de Flowplan {0}…", "正在下载 Flowplan {0}…"],
    "updates.timeout": ["Die Updatequelle antwortet nicht.", "The update source does not answer.", "La source des mises à jour ne répond pas.", "更新源没有响应。"],
    "updates.ofSize": ["{0} von {1}", "{0} of {1}", "{0} sur {1}", "{0} / {1}"],
    "updates.available": ["Flowplan {0} ist verfügbar", "Flowplan {0} is available", "Flowplan {0} est disponible", "Flowplan {0} 现已推出"],
    "updates.availableDetail": ["Du nutzt Version {0}. Lade die neue Version herunter und ersetze die App damit.", "You are using version {0}. Download the new version and replace the app with it.", "Vous utilisez la version {0}. Téléchargez la nouvelle version et remplacez l'application.", "你正在使用版本 {0}。请下载新版本并用它替换当前应用。"],
    "updates.upToDate": ["Flowplan ist auf dem neuesten Stand", "Flowplan is up to date", "Flowplan est à jour", "Flowplan 已是最新版本"],
    "updates.version": ["Version {0}", "Version {0}", "Version {0}", "版本 {0}"],
    "updates.restartNow": ["Neu starten", "Restart", "Redémarrer", "重新启动"],
    "updates.ready": ["Flowplan {0} ist bereit", "Flowplan {0} is ready", "Flowplan {0} est prêt", "Flowplan {0} 已准备就绪"],
    "updates.readyDetail": ["Wird beim Beenden installiert – oder jetzt mit einem Neustart.", "Installs when Flowplan quits – or now with a restart.", "S'installe à la fermeture de Flowplan – ou maintenant avec un redémarrage.", "将在退出 Flowplan 时安装——或者现在重新启动以安装。"],
    "updates.failed": ["Nach Updates suchen hat nicht geklappt", "Checking for updates did not work", "La recherche de mises à jour a échoué", "检查更新失败"],
    "updates.failedDetail": ["{0} – die neueste Version gibt es auch unter {1}.", "{0} – the latest version is also available at {1}.", "{0} – la dernière version est aussi disponible sur {1}.", "{0}——也可以在 {1} 获取最新版本。"],
    "updates.onlyInstalled": ["Updates gibt es nur in der installierten App", "Updates are only available in the installed app", "Les mises à jour ne sont disponibles que dans l'application installée", "只有已安装的应用才能更新"],
    "updates.onlyInstalledDetail": ["Die neueste Version gibt es unter {0}.", "The latest version is available at {0}.", "La dernière version est disponible sur {0}.", "可以在 {0} 获取最新版本。"],
    "updates.source": ["Updatequelle: {0}", "Update source: {0}", "Source des mises à jour : {0}", "更新源：{0}"],
    "updates.sourceGithub": ["GitHub-Releases von {0}", "GitHub releases of {0}", "Versions GitHub de {0}", "{0} 的 GitHub 发布版本"],
    "updates.sourceIgnored": ["FLOWPLAN_UPDATE_URL wurde ignoriert, weil die Adresse nicht mit https:// beginnt: {0}", "FLOWPLAN_UPDATE_URL was ignored because the address does not start with https://: {0}", "FLOWPLAN_UPDATE_URL a été ignorée car l'adresse ne commence pas par https:// : {0}", "已忽略 FLOWPLAN_UPDATE_URL，因为该地址不是以 https:// 开头：{0}"],

    // Sign-in through the browser (sign-in.js, pages/sign-in.html)
    "signIn.notPossible": ["Anmeldung nicht möglich", "Cannot sign in", "Connexion impossible", "无法登录"],
    "signIn.notStarted": ["Diese Anmeldung wurde nicht in dieser App gestartet oder gehört zu einer anderen Instanz. Starte sie bitte noch einmal über „Mit Passkey anmelden“ oder „Mit SSO anmelden“.", "This sign-in was not started in this app or belongs to another instance. Please start it again with “Sign in with passkey” or “Sign in with SSO”.", "Cette connexion n'a pas été lancée depuis cette application ou appartient à une autre instance. Relancez-la via « Se connecter avec une clé d'accès » ou « Se connecter avec SSO ».", "此登录不是在本应用中发起的，或属于其他实例。请通过“使用通行密钥登录”或“使用 SSO 登录”重新开始。"],
    "signIn.failed": ["Anmeldung fehlgeschlagen", "Sign-in failed", "Échec de la connexion", "登录失败"],
    "signIn.retry": ["Bitte erneut anmelden.", "Please sign in again.", "Veuillez vous reconnecter.", "请重新登录。"],
    "signIn.noCode": ["Füge den Link „Flowplan-App öffnen“ aus dem Browser oder den Anmeldecode ein.", "Paste the “Open the Flowplan app” link from the browser or the sign-in code.", "Collez le lien « Ouvrir l'application Flowplan » du navigateur ou le code de connexion.", "请粘贴浏览器中的“打开 Flowplan 应用”链接或登录代码。"],
    "signIn.noPending": ["In dieser App wartet keine Anmeldung. Starte sie bitte noch einmal.", "No sign-in is waiting in this app. Please start it again.", "Aucune connexion n'est en attente dans cette application. Veuillez la relancer.", "本应用中没有等待中的登录。请重新开始。"],
    "signIn.title": ["Weiter im Browser", "Continue in the browser", "Continuez dans le navigateur", "在浏览器中继续"],
    "signIn.text": ["Der Browser hat die Anmeldung bei {0} geöffnet. Melde dich dort an und bestätige „In der App anmelden“ – die App übernimmt dann von selbst.", "Your browser has opened the sign-in at {0}. Sign in there and confirm “Sign in to the app” – the app then takes over by itself.", "Votre navigateur a ouvert la connexion à {0}. Connectez-vous et confirmez « Se connecter dans l'application » – l'application prend ensuite le relais.", "浏览器已打开 {0} 的登录页面。请在那里登录并确认“登录应用”——之后应用会自动接管。"],
    "signIn.fallback": ["Passiert nichts (zum Beispiel unter Linux, wenn flowplan:// nicht registriert ist)? Kopiere auf der letzten Seite im Browser den Link hinter „Flowplan-App öffnen“ (Rechtsklick → Linkadresse kopieren) und füge ihn hier ein.", "Nothing happens (for example on Linux when flowplan:// is not registered)? On the last page in the browser, copy the link behind “Open the Flowplan app” (right-click → Copy link address) and paste it here.", "Rien ne se passe (par exemple sous Linux si flowplan:// n'est pas enregistré) ? Sur la dernière page du navigateur, copiez le lien derrière « Ouvrir l'application Flowplan » (clic droit → Copier l'adresse du lien) et collez-le ici.", "没有反应（例如在 Linux 上未注册 flowplan:// 时）？请在浏览器的最后一个页面上复制“打开 Flowplan 应用”背后的链接（右键点按 → 复制链接地址），然后粘贴到这里。"],
    "signIn.codeLabel": ["Link oder Anmeldecode", "Link or sign-in code", "Lien ou code de connexion", "链接或登录代码"],
    "signIn.codePlaceholder": ["flowplan://sign-in?…", "flowplan://sign-in?…", "flowplan://sign-in?…", "flowplan://sign-in?…"],
    "signIn.paste": ["Code einfügen", "Paste code", "Coller le code", "粘贴代码"],
    "signIn.pasting": ["Melde an …", "Signing in…", "Connexion…", "正在登录…"],
    "signIn.cancel": ["Abbrechen", "Cancel", "Annuler", "取消"],
    // Passkeys in the window (Windows, sign-in.js): several passkeys for one instance
    "passkey.choose": ["Passkey wählen", "Choose a passkey", "Choisir une clé d'accès", "选择通行密钥"],
    "passkey.chooseDetail": ["Für {0} sind mehrere Passkeys gespeichert. Mit welchem möchtest du dich anmelden?", "Several passkeys are saved for {0}. Which one do you want to sign in with?", "Plusieurs clés d'accès sont enregistrées pour {0}. Avec laquelle voulez-vous vous connecter ?", "{0} 保存了多个通行密钥。你要使用哪一个登录？"],
    "passkey.unnamed": ["Passkey ohne Namen", "Unnamed passkey", "Clé d'accès sans nom", "未命名的通行密钥"],

    // Setup page (pages/setup.html)
    "setup.title": ["Flowplan einrichten", "Set up Flowplan", "Configurer Flowplan", "设置 Flowplan"],
    "setup.heading": ["Willkommen bei Flowplan", "Welcome to Flowplan", "Bienvenue dans Flowplan", "欢迎使用 Flowplan"],
    "setup.text": ["Verbinde dich mit app.flowplan.org oder gib die Adresse deiner eigenen Flowplan-Instanz ein. Weitere Instanzen fügst du später im Menü unter „Profile“ hinzu.", "Connect to app.flowplan.org or enter the address of your own Flowplan instance. You can add more instances later in the menu under “Profiles”.", "Connectez-vous à app.flowplan.org ou saisissez l'adresse de votre propre instance Flowplan. Vous pourrez ajouter d'autres instances plus tard dans le menu « Profils ».", "连接到 app.flowplan.org，或输入你自己的 Flowplan 实例地址。以后可以在菜单的“账户”下添加更多实例。"],
    "setup.label": ["Adresse der Instanz", "Address of the instance", "Adresse de l'instance", "实例地址"],
    "setup.placeholder": ["flowplan.deine-firma.de", "flowplan.your-company.com", "flowplan.votre-entreprise.fr", "flowplan.your-company.com"],
    "setup.connect": ["Verbinden", "Connect", "Se connecter", "连接"],
    "setup.connecting": ["Verbinde …", "Connecting…", "Connexion…", "正在连接…"],
    "setup.nameLabel": ["Name des Profils (optional)", "Name of the profile (optional)", "Nom du profil (facultatif)", "账户名称（可选）"],
    "setup.namePlaceholder": ["Arbeit", "Work", "Travail", "工作"],
    "setup.cancel": ["Abbrechen", "Cancel", "Annuler", "取消"],
    "setup.addTitle": ["Profil hinzufügen", "Add profile", "Ajouter un profil", "添加账户"],
    "setup.addHeading": ["Weitere Instanz hinzufügen", "Add another instance", "Ajouter une autre instance", "添加另一个实例"],
    "setup.addText": ["Jedes Profil hat seine eigene Anmeldung und seine eigenen Offline-Daten. Wechseln kannst du im Menü unter „Profile“.", "Each profile has its own sign-in and its own offline data. Switch between them in the menu under “Profiles”.", "Chaque profil a sa propre connexion et ses propres données hors ligne. Changez de profil dans le menu « Profils ».", "每个账户都有自己的登录和离线数据。可以在菜单的“账户”下切换。"],
    "setup.add": ["Hinzufügen", "Add", "Ajouter", "添加"],
    "setup.desktopTitle": ["So soll Flowplan auf diesem Computer laufen", "How Flowplan should run on this computer", "Comment Flowplan doit fonctionner sur cet ordinateur", "Flowplan 在这台电脑上的运行方式"],
    "setup.desktopText": ["Alles ist freiwillig – du kannst jeden Punkt überspringen und alles später unter Einstellungen ändern.", "Everything is optional – skip any of it and change it all later in Settings.", "Tout est facultatif – passez ce que vous voulez et modifiez tout plus tard dans les Réglages.", "所有选项都是可选的——你可以跳过任何一项，以后在“设置”中更改。"],
    "setup.capture": ["Schnell erfassen aktivieren", "Turn on quick capture", "Activer la capture rapide", "开启快速捕获"],
    "setup.captureHint": ["Ein Tastenkürzel öffnet über jeder App ein kleines Fenster für Notizen, Aufgaben und Links – auch ohne Verbindung.", "A shortcut opens a small window above every app for notes, tasks and links – also offline.", "Un raccourci ouvre une petite fenêtre au-dessus de toute application pour notes, tâches et liens – aussi hors ligne.", "按下快捷键，会在任意应用上方打开一个小窗口，用于记录笔记、任务和链接——离线也能用。"],
    "setup.try": ["Jetzt ausprobieren", "Try it now", "Essayer maintenant", "立即试用"],
    "setup.trayHint": ["Schnell erfassen, die Aufgaben von heute und ungelesene Benachrichtigungen.", "Quick capture, today's tasks and unread notifications.", "Capture rapide, tâches du jour et notifications non lues.", "快速捕获、今天的任务和未读通知。"],
    "setup.launchAtLogin": ["Beim Anmelden am Computer starten", "Start when you sign in to the computer", "Démarrer à l'ouverture de session", "登录电脑时启动"],
    "setup.startHidden": ["Minimiert / im Hintergrund starten", "Start minimized / in the background", "Démarrer réduit / en arrière-plan", "以最小化方式在后台启动"],
    "setup.done": ["Fertig", "Done", "Terminé", "完成"],
    "setup.skip": ["Überspringen", "Skip", "Passer", "跳过"],

    // The one-time hint (hint.js, pages/hint.html)
    "hint.title": ["Neu: Schnell erfassen mit {0}", "New: quick capture with {0}", "Nouveau : capture rapide avec {0}", "新功能：使用 {0} 快速捕获"],
    "hint.text": ["Notizen, Aufgaben und Links aus jeder App – auch ohne Verbindung.", "Notes, tasks and links from any app – also offline.", "Notes, tâches et liens depuis toute application – aussi hors ligne.", "从任意应用记录笔记、任务和链接——离线也能用。"],
    "hint.try": ["Ausprobieren", "Try it", "Essayer", "试一试"],
    "hint.settings": ["Einstellungen", "Settings", "Réglages", "设置"],
    "hint.close": ["Schließen", "Close", "Fermer", "关闭"],

    // System audio for meeting notes (main.js, system-audio.js)
    "systemAudio.permissionTitle": ["Systemton für Besprechungsnotizen erlauben", "Allow system audio for meeting notes", "Autoriser l'audio système pour les notes de réunion", "允许为会议记录录制系统声音"],
    "systemAudio.permission": ["Damit Flowplan hört, was die anderen im Anruf sagen, erlaube es unter Systemeinstellungen → Datenschutz & Sicherheit → Bildschirm- & Systemaudioaufnahme und starte Flowplan neu.", "So Flowplan can hear what the others in the call say, allow it in System Settings → Privacy & Security → Screen & System Audio Recording, then restart Flowplan.", "Pour que Flowplan entende ce que disent les autres participants à l'appel, autorisez-le dans Réglages Système → Confidentialité et sécurité → Enregistrement de l'écran et de l'audio système, puis redémarrez Flowplan.", "为了让 Flowplan 听到通话中其他人的发言，请在“系统设置”→“隐私与安全性”→“录屏与系统录音”中允许，然后重新启动 Flowplan。"],
    // Screen region (screen-capture.js, pages/region.html)
    "region.title": ["Bildschirmausschnitt", "Screen region", "Zone de l'écran", "屏幕区域"],
    "region.hint": ["Bereich mit der Maus aufziehen · Enter: ganzer Bildschirm · Esc: abbrechen", "Drag a region with the mouse · Enter: whole screen · Esc: cancel", "Tracez une zone à la souris · Entrée : tout l'écran · Échap : annuler", "用鼠标拖出一个区域 · Enter：整个屏幕 · Esc：取消"],

    // Profiles (main.js, pages/profiles.html)
    "profiles.title": ["Profile", "Profiles", "Profils", "账户"],
    "profiles.text": ["Jedes Profil ist eine Flowplan-Instanz mit eigener Anmeldung. Wechseln kannst du im Menü oder mit {0}.", "Each profile is a Flowplan instance with its own sign-in. Switch in the menu or with {0}.", "Chaque profil est une instance Flowplan avec sa propre connexion. Changez de profil dans le menu ou avec {0}.", "每个账户都是一个拥有独立登录的 Flowplan 实例。可以在菜单中或使用 {0} 切换。"],
    "profiles.nameLabel": ["Name des Profils", "Name of the profile", "Nom du profil", "账户名称"],
    "profiles.active": ["Aktiv", "Active", "Actif", "当前"],
    "profiles.open": ["Öffnen", "Open", "Ouvrir", "打开"],
    "profiles.add": ["Profil hinzufügen", "Add profile", "Ajouter un profil", "添加账户"],
    "profiles.back": ["Zurück", "Back", "Retour", "返回"],
    "profiles.remove": ["Entfernen", "Remove", "Supprimer", "移除"],
    "profiles.cancel": ["Abbrechen", "Cancel", "Annuler", "取消"],
    "profiles.removeConfirm": ["Profil „{0}“ entfernen?", "Remove the profile “{0}”?", "Supprimer le profil « {0} » ?", "移除账户“{0}”？"],
    "profiles.removeDetail": ["Die App meldet sich bei {0} ab und löscht, was dieses Profil auf diesem Computer gespeichert hat (Anmeldung, Offline-Kopie). Deine Daten bleiben auf dem Server.", "The app signs out of {0} and deletes what this profile stored on this computer (sign-in, offline copy). Your data stays on the server.", "L'application se déconnecte de {0} et supprime ce que ce profil a enregistré sur cet ordinateur (connexion, copie hors ligne). Vos données restent sur le serveur.", "应用会退出 {0} 的登录，并删除此账户在这台电脑上存储的内容（登录信息、离线副本）。你的数据仍保留在服务器上。"],
    "profiles.tooMany": ["Höchstens {0} Profile.", "At most {0} profiles.", "{0} profils au maximum.", "最多 {0} 个账户。"],
    "profiles.openProfile": ["Flowplan mit dem Profil „{0}“ öffnen", "Open Flowplan with the profile “{0}”", "Ouvrir Flowplan avec le profil « {0} »", "使用账户“{0}”打开 Flowplan"],

    // Offline page (pages/offline.html)
    "offline.title": ["Keine Verbindung", "No connection", "Pas de connexion", "无网络连接"],
    "offline.heading": ["Keine Verbindung zu Flowplan", "No connection to Flowplan", "Pas de connexion à Flowplan", "无法连接到 Flowplan"],
    "offline.text": ["Der Server ist gerade nicht erreichbar. Prüfe deine Internetverbindung oder die Adresse der Instanz.", "The server cannot be reached right now. Check your internet connection or the address of the instance.", "Le serveur est inaccessible pour le moment. Vérifiez votre connexion Internet ou l'adresse de l'instance.", "目前无法访问服务器。请检查你的互联网连接或实例地址。"],
    "offline.detail": ["{0} ist gerade nicht erreichbar ({1}). Prüfe deine Internetverbindung oder die Adresse der Instanz.", "{0} cannot be reached right now ({1}). Check your internet connection or the address of the instance.", "{0} est inaccessible pour le moment ({1}). Vérifiez votre connexion Internet ou l'adresse de l'instance.", "目前无法访问 {0}（{1}）。请检查你的互联网连接或实例地址。"],
    "offline.unknownError": ["unbekannter Fehler", "unknown error", "erreur inconnue", "未知错误"],
    "offline.retry": ["Erneut versuchen", "Try again", "Réessayer", "重试"],
    "offline.profiles": ["Profile", "Profiles", "Profils", "账户"],
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
    doc.documentElement.lang = tagOf(current);
    for (const node of doc.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
    for (const node of doc.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = t(node.dataset.i18nPlaceholder);
    const title = doc.querySelector("title[data-i18n-title]");
    if (title) doc.title = t(title.dataset.i18nTitle);
  }
  return { LOCALES, STRINGS, pickLocale, setLocale, locale, tagOf, serverLocale, t, apply };
});
