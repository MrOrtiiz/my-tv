package io.freemytv.projektor;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.role.RoleManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.media.tv.TvContract;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * Free My TV på kompisens projektor (HY300 Pro+, Android 14): ett WebView med samma hemskärm som The Frame och LG
 * (tv/ i MrOrtiiz/my-tv). Laddaren (assets/index.html) hämtar den senaste koden från GitHub vid varje start; utan
 * internet visas den inbyggda kopian (assets/app/). Sidan och apparnas ikoner serveras från appen själv under
 * https://appassets.androidplatform.net/ (Androids adress för just det), så sidan har ett fast ursprung och sin lagring.
 * Hemskärmen når projektorn genom bryggan window.FMTVAndroid (Bridge nedan): apparna, öppna en app, ingångar,
 * inställningar, YouTube, info. Tillbaka-knappen skickas till sidan som tangent 461, som på LG.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String START = "https://" + HOST + "/index.html";
    static final int BACK_KEY = 461;
    static final int ASK_HOME = 7;

    private FrameLayout root;
    private WebView web;
    private SharedPreferences prefs;
    private OrtiVoice orti;

    /** O.R.T.I.:s röst (OrtiVoice): skapas första gången sidan ber om den; händelserna går till window.Orti._native. */
    private synchronized OrtiVoice orti() {
        if (orti == null) orti = new OrtiVoice(this, new OrtiVoice.Sink() {
            public void send(final String json) {
                runOnUiThread(new Runnable() { public void run() {
                    if (web != null) web.evaluateJavascript("window.Orti&&Orti._native(" + json + ")", null);
                } });
            }
        });
        return orti;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("fmtv", MODE_PRIVATE);
        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0B0B0D);
        setContentView(root);
        immersive();
        makeWeb();
        // Första starten: fråga om Free My TV får bli startskärmen (en gång; sedan under Genvägar).
        if (!isHome() && !prefs.getBoolean("askedHome", false)) {
            prefs.edit().putBoolean("askedHome", true).apply();
            root.postDelayed(new Runnable() { public void run() { askHome(); } }, 4000);
        }
    }

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private void makeWeb() {
        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0B0D);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);          // sidan är 1920 × 1080 (viewport) och skalas till projektorns 1280 × 720
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);   // IPTV- och Plex-adresser är ofta http
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new Client());
        web.addJavascriptInterface(new Bridge(), "FMTVAndroid");
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.requestFocus();
        web.loadUrl(START);
    }

    /** Sidans process dog (minnet tog slut): ett nytt WebView i stället för att hela appen stängs. */
    private void remakeWeb() {
        if (web != null) {
            root.removeView(web);
            try { web.destroy(); } catch (Exception e) { }
        }
        makeWeb();
    }

    // MARK: - Tangenter

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        if (k == KeyEvent.KEYCODE_BACK || k == KeyEvent.KEYCODE_ESCAPE) {
            if (e.getAction() == KeyEvent.ACTION_DOWN && web != null) key(BACK_KEY);
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    /** En tangent till sidan, som om fjärrkontrollen skickat den (keyCode går inte att sätta på ett vanligt KeyboardEvent). */
    private void key(int code) {
        web.evaluateJavascript("(function(){var e=document.createEvent('Event');e.initEvent('keydown',true,true);"
                + "Object.defineProperty(e,'keyCode',{get:function(){return " + code + "}});"
                + "Object.defineProperty(e,'which',{get:function(){return " + code + "}});"
                + "(document.activeElement||document).dispatchEvent(e);})()", null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) { web.onPause(); web.pauseTimers(); }   // inget som rör sig bakom Netflix (1 GB minne)
    }

    @Override
    protected void onResume() {
        super.onResume();
        immersive();
        if (web != null) { web.onResume(); web.resumeTimers(); web.requestFocus(); }
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) immersive();
    }

    @Override
    protected void onDestroy() {
        if (orti != null) orti.shutdown();
        if (web != null) { root.removeView(web); web.destroy(); web = null; }
        super.onDestroy();
    }

    // MARK: - Startskärmen

    boolean isHome() {
        try {
            ResolveInfo ri = getPackageManager().resolveActivity(
                    new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY);
            return ri != null && ri.activityInfo != null && getPackageName().equals(ri.activityInfo.packageName);
        } catch (Exception e) {
            return false;
        }
    }

    /** Ber Android göra Free My TV till startskärmen: rollfrågan (Android 10+), annars inställningen för startskärm. */
    boolean askHome() {
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                RoleManager rm = getSystemService(RoleManager.class);
                if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_HOME) && !rm.isRoleHeld(RoleManager.ROLE_HOME)) {
                    startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_HOME), ASK_HOME);
                    return true;
                }
            } catch (Exception e) { }
        }
        return start(new Intent(Settings.ACTION_HOME_SETTINGS));
    }

    /** Projektorns egen startskärm (där finns skärpa, keystone och projektionsläge): den andra appen som är startskärm. */
    boolean stockHome() {
        PackageManager pm = getPackageManager();
        List<ResolveInfo> list = pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0);
        for (ResolveInfo ri : list) {
            String pkg = ri.activityInfo.packageName;
            if (pkg.equals(getPackageName()) || pkg.equals("com.android.settings") || pkg.startsWith("com.android.tv.settings")
                    || pkg.equals("com.android.provision")) continue;
            Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                    .setComponent(new ComponentName(pkg, ri.activityInfo.name));
            if (start(i)) return true;
        }
        return false;
    }

    // MARK: - Öppna saker

    boolean start(Intent i) {
        if (i == null) return false;
        final Intent intent = i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            if (intent.getComponent() == null && getPackageManager().resolveActivity(intent, 0) == null) return false;
        } catch (Exception e) {
            return false;
        }
        runOnUiThread(new Runnable() {
            public void run() {
                try { startActivity(intent); } catch (Exception e) { }
            }
        });
        return true;
    }

    boolean installed(String pkg) {
        try { getPackageManager().getPackageInfo(pkg, 0); return true; } catch (Exception e) { return false; }
    }

    // MARK: - Sidan och ikonerna, från appen själv

    private static final Map<String, String> TYPES = new HashMap<String, String>();
    static {
        TYPES.put("html", "text/html"); TYPES.put("js", "application/javascript"); TYPES.put("css", "text/css");
        TYPES.put("json", "application/json"); TYPES.put("png", "image/png"); TYPES.put("svg", "image/svg+xml");
        TYPES.put("jpg", "image/jpeg"); TYPES.put("jpeg", "image/jpeg"); TYPES.put("webp", "image/webp");
        TYPES.put("gif", "image/gif"); TYPES.put("woff2", "font/woff2"); TYPES.put("woff", "font/woff");
        TYPES.put("ttf", "font/ttf"); TYPES.put("otf", "font/otf"); TYPES.put("txt", "text/plain");
        TYPES.put("mp3", "audio/mpeg"); TYPES.put("mp4", "video/mp4");
    }

    private WebResourceResponse respond(String type, int status, InputStream data) {
        Map<String, String> h = new HashMap<String, String>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", "no-cache");
        boolean text = type.startsWith("text/") || type.endsWith("javascript") || type.endsWith("json") || type.endsWith("svg+xml");
        return new WebResourceResponse(type, text ? "utf-8" : null, status, status == 200 ? "OK" : "Not Found", h,
                data != null ? data : new ByteArrayInputStream(new byte[0]));
    }

    private WebResourceResponse serve(Uri url) {
        String path = url.getPath();
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        if (path.startsWith("/icon/")) return icon(path.substring(6));
        if (path.contains("..")) return respond("text/plain", 404, null);
        String name = path.substring(1), ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
        String type = TYPES.containsKey(ext) ? TYPES.get(ext) : "application/octet-stream";
        try {
            return respond(type, 200, getAssets().open(name));
        } catch (Exception e) {
            return respond("text/plain", 404, null);
        }
    }

    /** En apps ikon som PNG (192 × 192): Android TV-appars banner är bred, så appens vanliga ikon. */
    private WebResourceResponse icon(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            Drawable d = pm.getApplicationIcon(pkg);
            Bitmap b = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(b);
            d.setBounds(0, 0, 192, 192);
            d.draw(c);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            b.compress(Bitmap.CompressFormat.PNG, 100, out);
            b.recycle();
            WebResourceResponse r = respond("image/png", 200, new ByteArrayInputStream(out.toByteArray()));
            Map<String, String> h = r.getResponseHeaders();
            h.put("Cache-Control", "max-age=86400");
            r.setResponseHeaders(h);
            return r;
        } catch (Exception e) {
            return respond("text/plain", 404, null);
        }
    }

    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            return u != null && HOST.equals(u.getHost()) ? serve(u) : null;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            return u == null || !HOST.equals(u.getHost());   // sidan lämnar aldrig appen
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (view == web) {
                web = null;
                root.post(new Runnable() { public void run() { remakeWeb(); } });
            }
            return true;
        }
    }

    // MARK: - Bryggan (window.FMTVAndroid i tv/tv.js)

    private class Bridge {
        /** Apparna: [{id: paket, title}], Android TV-apparna (leanback) först, sedan de vanliga. */
        @JavascriptInterface
        public String apps() {
            PackageManager pm = getPackageManager();
            Map<String, String> found = new LinkedHashMap<String, String>();
            String[] cats = {Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER};
            for (String cat : cats) {
                List<ResolveInfo> list;
                try { list = pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(cat), 0); }
                catch (Exception e) { continue; }
                for (ResolveInfo ri : list) {
                    String pkg = ri.activityInfo.packageName;
                    if (pkg.equals(getPackageName()) || found.containsKey(pkg)) continue;
                    CharSequence label = ri.loadLabel(pm);
                    found.put(pkg, label != null ? label.toString() : pkg);
                }
            }
            JSONArray out = new JSONArray();
            try {
                for (Map.Entry<String, String> e : found.entrySet()) out.put(new JSONObject().put("id", e.getKey()).put("title", e.getValue()));
            } catch (Exception e) { }
            return out.toString();
        }

        @JavascriptInterface
        public boolean launch(String pkg) {
            if ("stockhome".equals(pkg)) return stockHome();
            PackageManager pm = getPackageManager();
            Intent i = null;
            try { i = pm.getLeanbackLaunchIntentForPackage(pkg); } catch (Exception e) { }
            if (i == null) { try { i = pm.getLaunchIntentForPackage(pkg); } catch (Exception e) { } }
            if (i == null) return false;
            i.addFlags(Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            return start(i);
        }

        /** Ingångarna (HDMI) som Android känner till och som något kan öppna: [{id, label}]. */
        @JavascriptInterface
        public String inputs() {
            JSONArray out = new JSONArray();
            try {
                TvInputManager tim = (TvInputManager) getSystemService(TV_INPUT_SERVICE);
                if (tim == null) return "[]";
                for (TvInputInfo info : tim.getTvInputList()) {
                    if (!info.isPassthroughInput() || info.getParentId() != null) continue;
                    Intent v = new Intent(Intent.ACTION_VIEW, TvContract.buildChannelUriForPassthroughInput(info.getId()));
                    if (getPackageManager().resolveActivity(v, 0) == null) continue;
                    CharSequence label = info.loadLabel(MainActivity.this);
                    out.put(new JSONObject().put("id", info.getId()).put("label", label != null ? label.toString() : ""));
                }
            } catch (Exception e) { }
            return out.toString();
        }

        @JavascriptInterface
        public boolean openInput(String id) {
            return start(new Intent(Intent.ACTION_VIEW, TvContract.buildChannelUriForPassthroughInput(id)));
        }

        /** Projektorns inställningar: den vanliga, annars Android TV:s egen, annars projektorns startskärm. */
        @JavascriptInterface
        public boolean settings() {
            if (start(new Intent(Settings.ACTION_SETTINGS))) return true;
            Intent tv = new Intent().setComponent(new ComponentName("com.android.tv.settings", "com.android.tv.settings.MainSettings"));
            if (installed("com.android.tv.settings") && start(tv)) return true;
            return stockHome();
        }

        @JavascriptInterface
        public boolean youtube(String video) {
            String[] pkgs = {"com.google.android.youtube.tv", "com.google.android.youtube", null};
            for (String pkg : pkgs) {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/watch?v=" + Uri.encode(video)));
                if (pkg != null) { if (!installed(pkg)) continue; i.setPackage(pkg); }
                if (start(i)) return true;
            }
            return false;
        }

        @JavascriptInterface
        public String about() {
            JSONObject o = new JSONObject();
            try {
                String version = "";
                try { version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { }
                o.put("model", (Build.MANUFACTURER + " " + Build.MODEL).trim());
                o.put("firmware", Build.DISPLAY);
                o.put("system", "Android " + Build.VERSION.RELEASE);
                o.put("version", version);
                o.put("ip", ip());
            } catch (Exception e) { }
            return o.toString();
        }

        /** Litet minne (HY300 Pro+: 1 GB): hemskärmens lätta läge, utan skuggor och glas. */
        @JavascriptInterface
        public boolean lowRam() {
            try {
                ActivityManager am = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
                ActivityManager.MemoryInfo m = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(m);
                return am.isLowRamDevice() || m.totalMem < 1700L * 1024 * 1024;
            } catch (Exception e) {
                return true;
            }
        }

        @JavascriptInterface
        public String zone() {
            return TimeZone.getDefault().getID();
        }

        @JavascriptInterface
        public boolean isHome() {
            return MainActivity.this.isHome();
        }

        @JavascriptInterface
        public boolean makeHome() {
            runOnUiThread(new Runnable() { public void run() { askHome(); } });
            return true;
        }

        // MARK: O.R.T.I.:s röst (kontor/orti.js)

        /** De svenska rösterna på enheten (JSON); {ready: false} medan talsyntesen startar. */
        @JavascriptInterface
        public String ortiVoices() { return orti().voices(); }

        /** Läser upp: {id, text eller ssml, engine, voice, rate, pitch, volume, key, region}; svaret kommer som händelser. */
        @JavascriptInterface
        public boolean ortiSpeak(String json) { orti().speak(json); return true; }

        @JavascriptInterface
        public void ortiStop() { orti().stop(); }

        /** Tillbaka på hemskärmens första sida: inget när Free My TV är startskärmen, annars dit man kom ifrån. */
        @JavascriptInterface
        public void back() {
            if (MainActivity.this.isHome()) return;
            runOnUiThread(new Runnable() { public void run() { moveTaskToBack(true); } });
        }
    }

    static String ip() {
        try {
            for (NetworkInterface n : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!n.isUp() || n.isLoopback()) continue;
                for (InetAddress a : Collections.list(n.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) return a.getHostAddress();
                }
            }
        } catch (Exception e) { }
        return "";
    }
}
