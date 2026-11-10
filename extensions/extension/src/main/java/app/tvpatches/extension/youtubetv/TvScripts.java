/*
 * Runs the YouTV script bundle (src/main/js) inside the youtube.com/tv web app.
 *
 * The injection technique (native WebContentsImpl.evaluateJavaScript reached through
 * org.jni_zero.GEN_JNI, the native pointer found by type) comes from:
 *   - ysamjo/morphe-patches (GPLv3), CobaltScriptInjector
 *   - DylanDuff/utv-runtime (MIT), RuntimeObserver
 *
 * Licensed under GPLv3, see the NOTICE file.
 */
package app.tvpatches.extension.youtubetv;

import android.util.Log;

import java.lang.reflect.Field;
import java.lang.reflect.Method;

@SuppressWarnings("unused")
public final class TvScripts {
    static final String TAG = "TvPatches";
    private static final String LOG_PREFIX = "tvp:";

    private static Object webContents;
    private static Field pointerField;
    private static Method evaluateJavaScript;

    private TvScripts() {
    }

    /** Called from the patched StartupGuardNavigationObserver constructor. */
    public static void setWebContents(Object contents) {
        webContents = contents;
        pointerField = null;
    }

    /** Called on primaryMainDocumentElementAvailable and didFinishNavigationInPrimaryMainFrame. */
    public static void onPageEvent(String event) {
        if (inject()) {
            Log.d(TAG, "scripts injected (" + event + ")");
        }
    }

    /** The script logs by setting document.title to "tvp:<message>". */
    public static void onTitle(String title) {
        if (title != null && title.startsWith(LOG_PREFIX)) {
            Log.i(TAG, title.substring(LOG_PREFIX.length()));
        }
    }

    private static boolean inject() {
        try {
            Object contents = webContents;
            if (contents == null) return false;

            if (pointerField == null) pointerField = findNativePointerField(contents);
            if (pointerField == null) {
                Log.w(TAG, "native pointer field not found");
                return false;
            }
            long pointer = pointerField.getLong(contents);
            if (pointer == 0L) return false;

            if (evaluateJavaScript == null) evaluateJavaScript = findEvaluateJavaScript();
            if (evaluateJavaScript == null) {
                Log.w(TAG, "evaluateJavaScript native not found");
                return false;
            }

            evaluateJavaScript.invoke(null, pointer, script(), null);
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "script injection failed", t);
            return false;
        }
    }

    /** Replaced by the "Custom branding" patch with the app name. Empty: no branding. */
    private static String getBrandingName() {
        return "";
    }

    /** The app name set by "Custom branding", or "" when that patch is not applied. */
    static String brandingName() {
        String name = getBrandingName();
        return name == null ? "" : name;
    }

    private static String cachedScript;

    private static String script() {
        if (cachedScript == null) {
            String name = getBrandingName();
            String prefix = "";
            if (name != null && !name.isEmpty()) {
                String escaped = name.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
                prefix = "window.__youtvBranding=\"" + escaped + "\";\n";
            }
            cachedScript = prefix + TvScriptsPayload.SCRIPT;
        }
        return cachedScript;
    }

    /** The only long field of WebContentsImpl holds the native pointer (its name is obfuscated). */
    private static Field findNativePointerField(Object contents) {
        for (Class<?> type = contents.getClass(); type != null && type != Object.class;
             type = type.getSuperclass()) {
            for (Field field : type.getDeclaredFields()) {
                if (field.getType() != long.class) continue;
                try {
                    field.setAccessible(true);
                    if (field.getLong(contents) != 0L) return field;
                } catch (Throwable ignored) {
                }
            }
        }
        return null;
    }

    /** R8 removed the Java wrapper, but the JNI stub is still registered. */
    private static Method findEvaluateJavaScript() throws ClassNotFoundException {
        Class<?> genJni = Class.forName("org.jni_zero.GEN_JNI");
        for (Method method : genJni.getDeclaredMethods()) {
            if (!method.getName().endsWith("WebContentsImpl_evaluateJavaScript")) continue;
            Class<?>[] parameters = method.getParameterTypes();
            if (parameters.length == 3 && parameters[0] == long.class) {
                method.setAccessible(true);
                return method;
            }
        }
        return null;
    }
}
