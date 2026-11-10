// YouTV runtime: loaded first into https://www.youtube.com/tv, on every page load.
// Feature scripts (the other .js files) register themselves with youtv.feature().
//
// Based on the runtime core of DylanDuff/utv-runtime (MIT License, Copyright (c) 2026 Dylan Duff):
// JSON.parse hook for InnerTube responses and settings registered as YouTube client settings.
//
// youtv.feature({
//     id: "shorts",                     // [a-z0-9-]+, unique; becomes the client setting YOUTV_SHORTS
//     name: "Ocultar Shorts",           // switch title in Ajustes > YouTV
//     summary: "...",                   // switch description
//     defaultEnabled: true,             // true if omitted
//     restart: false,                   // true: changing it shows the "restart needed" dialog
//     settings: [{ key: "x", title: "...", summary: "...", default: false }],  // optional extra switches
//     onResponse: function (response, settings) { ... }  // every parsed InnerTube response, only while
// });                                                    // enabled; settings.get("x") reads an extra
(function () {
    if (location.hostname !== "www.youtube.com" || window.youtv) return;

    var parse = JSON.parse;

    // ---- log ----------------------------------------------------------------------------------
    // Console output of injected code never reaches logcat. report() briefly sets document.title to
    // "tvp:<message>"; the patched navigation observer (titleWasSet) logs it under the tag TvPatches.
    var reportQueue = [];
    var savedTitle = null;
    function report(message) {
        reportQueue.push(message);
        if (reportQueue.length === 1 && savedTitle === null) setTimeout(flushReports, 0);
    }
    function flushReports() {
        if (savedTitle === null) savedTitle = document.title;
        if (reportQueue.length === 0) {
            document.title = savedTitle;
            savedTitle = null;
            return;
        }
        document.title = "tvp:" + reportQueue.shift();
        setTimeout(flushReports, 0);
    }

    // ---- settings -----------------------------------------------------------------------------
    // Registered as YouTube client settings, so the app draws, toggles and stores them itself:
    // localStorage "yt.leanback.default::<key>" = {"data": <bool>}.
    var STORAGE_PREFIX = "yt.leanback.default::";
    var CATEGORY_ID = "SETTING_CAT_YOUTV";
    var RESTART_SETTING = { key: "YOUTV_RESTART_REQUEST", defaultValue: false };  // see restart dialog
    var settings = [];          // { key, title, summary, defaultValue } in display order
    var registry = null;        // YouTube's known client settings ({ KEY: true })
    var defaults = null;        // YouTube's client setting defaults (Map)

    function readSetting(setting) {
        try {
            var stored = parse(localStorage.getItem(STORAGE_PREFIX + setting.key));
            if (stored && typeof stored.data === "boolean") return stored.data;
        } catch (e) {}
        return setting.defaultValue;
    }

    function registerSetting(setting) {
        registry[setting.key] = true;
        defaults.set(setting.key, setting.defaultValue);
    }

    // Both objects are minified, so find them by content: the registry is the plain object holding
    // ENABLE_PREVIEWS_WITH_SOUND: true, the defaults are the Map with that key.
    function findRegistry() {
        var namespace = window._yttv;
        if (!namespace) return false;
        var names = Object.keys(namespace);
        for (var i = 0; i < names.length && !(registry && defaults); i++) {
            var value;
            try { value = namespace[names[i]]; } catch (e) { continue; }
            if (!value || typeof value !== "object") continue;
            if (value instanceof Map) {
                if (!defaults && value.has("ENABLE_PREVIEWS_WITH_SOUND")) defaults = value;
            } else if (!registry && !Array.isArray(value) && value.ENABLE_PREVIEWS_WITH_SOUND === true) {
                registry = value;
            }
        }
        if (!registry || !defaults) {
            registry = defaults = null;
            return false;
        }
        settings.forEach(registerSetting);
        registerSetting(RESTART_SETTING);
        report("settings: registered " + settings.length + " setting(s)");
        return true;
    }

    // ---- restart dialog -----------------------------------------------------------------------
    // Switches marked restart: true open YouTube's own confirmation dialog. Its "Reiniciar" button
    // stores the hidden client setting YOUTV_RESTART_REQUEST; the storage hook below sees that write
    // and reloads youtube.com/tv, which fetches the menu (guide) again, like a fresh start.
    var CLOSE_POPUP = { signalAction: { signal: "CLOSE_POPUP" } };

    function restartDialogCommand() {
        var restart = { commandExecutorCommand: { commands: [CLOSE_POPUP, clientSettingEndpoint(RESTART_SETTING.key, true)] } };
        return { confirmDialogEndpoint: { content: { confirmDialogRenderer: {
            title: runs("Reinicio necesario"),
            dialogMessages: [runs("Este cambio se aplica al reiniciar YouTube. ¿Quieres reiniciar ahora?")],
            confirmButton: { buttonRenderer: {
                style: "STYLE_PRIMARY",
                text: runs("Reiniciar"),
                serviceEndpoint: restart,
                command: restart
            } },
            cancelButton: { buttonRenderer: {
                style: "STYLE_DEFAULT",
                text: runs("Más tarde"),
                serviceEndpoint: CLOSE_POPUP,
                command: CLOSE_POPUP
            } },
            primaryIsCancel: false
        } } } };
    }

    // The switch reads its on/off state from enableServiceEndpoint.setClientSettingEndpoint, so that
    // key has to stay at the top level. The dialog goes in a commandExecutorCommand next to it.
    function settingCommand(setting, value) {
        var save = clientSettingEndpoint(setting.key, value);
        if (!setting.restart) return save;
        save.commandExecutorCommand = { commands: [clientSettingEndpoint(setting.key, value), restartDialogCommand()] };
        return save;
    }

    function isRestartRequest(key, value) {
        return key === STORAGE_PREFIX + RESTART_SETTING.key && String(value).indexOf("true") !== -1;
    }

    var restarting = false;
    function restartApp() {
        if (restarting) return;
        restarting = true;
        report("restart requested");
        try { localStorage.removeItem(STORAGE_PREFIX + RESTART_SETTING.key); } catch (e) {}
        setTimeout(function () { location.reload(); }, 300);
    }

    try {
        var setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            var result = setItem.apply(this, arguments);
            try { if (this === localStorage && isRestartRequest(key, value)) restartApp(); } catch (e) {}
            return result;
        };
        // A leftover request (for example the app was closed before the reload) is dropped.
        localStorage.removeItem(STORAGE_PREFIX + RESTART_SETTING.key);
    } catch (e) {
        report("restart hook failed: " + e);
    }

    (function pollRegistry(attempt) {
        if (findRegistry()) return;
        if (attempt >= 600) {
            report("settings: client setting registry not found, YouTV menu disabled");
            return;
        }
        setTimeout(function () { pollRegistry(attempt + 1); }, 100);
    })(0);

    function runs(text) { return { runs: [{ text: text }] }; }
    function clientSettingEndpoint(key, value) {
        return { setClientSettingEndpoint: { settingDatas: [{ clientSettingEnum: { item: key }, boolValue: value }] } };
    }

    // The Settings response is items[] of settingCategoryCollectionRenderer. Ours goes right after
    // the first category, and only once the registry is patched (so every switch can be stored).
    // With "Custom branding", the "Obtener YouTube Premium" card (first item of the first category,
    // itemId PREMIUM_LANDING_PAGE*, sent by the server) becomes an app card whose button jumps to
    // the app's own settings.
    function brandPremiumCard(items) {
        var name = window.__youtvBranding;
        if (!name) return;
        for (var i = 0; i < items.length; i++) {
            var category = items[i] && items[i].settingCategoryCollectionRenderer;
            if (!category || !Array.isArray(category.items)) continue;
            for (var j = 0; j < category.items.length; j++) {
                var card = category.items[j] && category.items[j].settingActionRenderer;
                if (!card || !/^PREMIUM_/.test(card.itemId || "")) continue;
                var open = settings.length
                    ? { applicationSettingsEndpoint: { itemId: settings[0].key } }
                    : CLOSE_POPUP;
                card.title = runs(name);
                card.summary = runs("Sin anuncios, sin Shorts y con el reproductor a tu gusto. " +
                    "Todo se configura en la sección " + name + ", más abajo.");
                card.serviceEndpoint = open;
                var button = card.actionButton && card.actionButton.buttonRenderer;
                if (button) {
                    button.text = runs("Ir a la configuración de " + name);
                    button.serviceEndpoint = open;
                    button.command = open;
                }
                report("branding: premium card replaced");
            }
        }
    }

    function injectSettingsCategory(response) {
        var items = response.items;
        if (Array.isArray(items)) brandPremiumCard(items);
        if (!registry || !settings.length || !Array.isArray(items)) return;
        var isSettings = false;
        for (var i = 0; i < items.length; i++) {
            var category = items[i] && items[i].settingCategoryCollectionRenderer;
            if (!category) continue;
            if (category.categoryId === CATEGORY_ID) return;
            isSettings = true;
        }
        if (!isSettings) return;
        items.splice(1, 0, { settingCategoryCollectionRenderer: {
            title: runs("FaroTV"),
            categoryId: CATEGORY_ID,
            focused: false,
            items: settings.map(function (setting) {
                return { settingBooleanRenderer: {
                    title: runs(setting.title),
                    summary: runs(setting.summary || ""),
                    enableServiceEndpoint: settingCommand(setting, true),
                    disableServiceEndpoint: settingCommand(setting, false),
                    itemId: setting.key
                } };
            })
        } });
    }

    // ---- features -----------------------------------------------------------------------------
    var features = [];

    function settingKey(id, key) {
        return ("YOUTV_" + id + (key ? "_" + key : "")).toUpperCase().replace(/[^A-Z0-9]/g, "_");
    }

    function defineFeature(definition) {
        var id = definition && definition.id;
        if (!/^[a-z0-9-]+$/.test(id || "")) return report("feature rejected: invalid id " + id);
        for (var i = 0; i < features.length; i++) {
            if (features[i].id === id) return;
        }

        var master = {
            key: settingKey(id),
            title: definition.name || id,
            summary: definition.summary,
            defaultValue: definition.defaultEnabled !== false,
            restart: !!definition.restart
        };
        var extras = {};
        var own = [master];
        (definition.settings || []).forEach(function (extra) {
            var setting = {
                key: settingKey(id, extra.key),
                title: extra.title || extra.key,
                summary: extra.summary,
                defaultValue: !!extra.default,
                restart: !!extra.restart
            };
            extras[extra.key] = setting;
            own.push(setting);
        });
        own.forEach(function (setting) {
            settings.push(setting);
            if (registry) registerSetting(setting);
        });

        features.push({
            id: id,
            definition: definition,
            enabled: function () { return readSetting(master); },
            settings: {
                get: function (key) { return extras[key] ? readSetting(extras[key]) : undefined; }
            }
        });
    }

    // ---- response hook ------------------------------------------------------------------------
    JSON.parse = function () {
        var result = parse.apply(this, arguments);
        if (!result || typeof result !== "object") return result;
        try {
            injectSettingsCategory(result);
        } catch (e) {
            report("settings: inject failed: " + e);
        }
        for (var i = 0; i < features.length; i++) {
            var feature = features[i];
            if (typeof feature.definition.onResponse !== "function" || !feature.enabled()) continue;
            try {
                feature.definition.onResponse(result, feature.settings);
            } catch (e) {
                report(feature.id + ": failed: " + e);
            }
        }
        return result;
    };

    window.youtv = {
        report: report,
        rawParse: parse,
        feature: defineFeature,
        status: function () {
            return {
                registry: !!registry,
                features: features.map(function (f) { return f.id + (f.enabled() ? " (on)" : " (off)"); })
            };
        }
    };
    report("runtime loaded on " + location.href);
})();
