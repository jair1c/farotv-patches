package app.tvpatches.extension.youtubetv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.pm.PackageManager;
import android.util.Log;

/**
 * Minimal, TV-friendly version of Morphe's GmsCoreSupportPatch extension.
 * Only checks that MicroG-RE is installed and warns with a dialog that works with a remote.
 *
 * The private methods are overwritten by the patch (returnEarly) with real values.
 */
@SuppressWarnings("unused")
public final class GmsCoreSupportPatch {
    private static final String TAG = "TvPatches";

    private static boolean dialogShown;

    private GmsCoreSupportPatch() {}

    /** Replaced by the patch with the original package name. */
    private static String getOriginalPackageName() {
        return null;
    }

    /** Replaced by the patch with the GmsCore vendor id ("app.revanced"). */
    private static String getGmsCoreVendorGroupId() {
        return "app.revanced";
    }

    private static String getGmsCorePackageName() {
        return getGmsCoreVendorGroupId() + ".android.gms";
    }

    public static boolean isPackageNameOriginal() {
        String original = getOriginalPackageName();
        return original == null;
    }

    /**
     * Injected at the start of CobaltActivity.onCreate().
     */
    public static void checkGmsCore(Activity activity) {
        try {
            if (activity == null || isPackageNameOriginal()) return;

            String gmsCore = getGmsCorePackageName();
            PackageManager pm = activity.getPackageManager();
            try {
                pm.getPackageInfo(gmsCore, 0);
                Log.i(TAG, "GmsCore found: " + gmsCore);
            } catch (PackageManager.NameNotFoundException e) {
                Log.w(TAG, "GmsCore not installed: " + gmsCore);
                showMissingDialog(activity, gmsCore);
            }
        } catch (Exception ex) {
            Log.e(TAG, "checkGmsCore failure", ex);
        }
    }

    private static void showMissingDialog(Activity activity, String gmsCore) {
        if (dialogShown) return;
        dialogShown = true;
        activity.runOnUiThread(() -> {
            try {
                new AlertDialog.Builder(activity)
                        .setTitle("MicroG-RE no está instalado")
                        .setMessage("Esta versión parcheada de YouTube necesita MicroG-RE ("
                                + gmsCore + ") para iniciar sesión y reproducir videos.\n\n"
                                + "Instálalo por adb y vuelve a abrir la app.")
                        .setPositiveButton(android.R.string.ok, null)
                        .show();
            } catch (Exception ex) {
                Log.e(TAG, "Could not show dialog", ex);
            }
        });
    }
}
