package io.freemytv.projektor;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * O.R.T.I.:s röst (kontor/orti.js): sidan skickar en text, här blir den en ljudfil och spelas upp. Två röstmotorer:
 * Androids egen talsyntes (Googles talmotor på stickan, svenska, ingen kostnad, fungerar utan nät när rösten är
 * nedladdad) och Microsoft Azure (rösten Mattias, med nyckeln som skrivits in på TV:n). Båda ger en WAV-fil, så att
 * ljudstyrkan kan räknas fram var 20:e millisekund: sidan får kurvan när uppspelningen börjar och låter kontrollrummet
 * pulsera i takt med rösten. Händelserna går till window.Orti._native({id, ev: start|end|error, …}).
 * Webbläsarens Web Speech API finns inte i Androids WebView, därav bryggan.
 */
class OrtiVoice {
    interface Sink { void send(String json); }

    private static final Locale SV = new Locale("sv", "SE");

    private final Context ctx;
    private final Sink sink;
    private final Handler bg, main;
    private final AudioManager am;
    private TextToSpeech tts;
    private boolean ready = false, failed = false;
    private final List<Runnable> waiting = new ArrayList<Runnable>();
    private final Map<String, Float> pendingVolume = new HashMap<String, Float>();
    private MediaPlayer player;
    private String playingId;
    private AudioFocusRequest focus;

    OrtiVoice(Context c, Sink s) {
        ctx = c.getApplicationContext();
        sink = s;
        HandlerThread t = new HandlerThread("orti");
        t.start();
        bg = new Handler(t.getLooper());
        main = new Handler(Looper.getMainLooper());
        am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
    }

    // MARK: - Androids talsyntes

    /** Kör r när talsyntesen har startat (eller inte gick att starta: då ser r det på ready). */
    private void withTts(final Runnable r) {
        synchronized (this) {
            if (ready || failed) { bg.post(r); return; }
            waiting.add(r);
            if (tts != null) return;
        }
        main.post(new Runnable() {
            public void run() {
                tts = new TextToSpeech(ctx, new TextToSpeech.OnInitListener() {
                    public void onInit(int status) {
                        List<Runnable> run;
                        synchronized (OrtiVoice.this) {
                            ready = status == TextToSpeech.SUCCESS;
                            failed = !ready;
                            run = new ArrayList<Runnable>(waiting);
                            waiting.clear();
                        }
                        if (ready) tts.setOnUtteranceProgressListener(new Progress());
                        for (Runnable x : run) bg.post(x);
                    }
                });
            }
        });
    }

    private class Progress extends UtteranceProgressListener {
        @Override public void onStart(String id) { }
        @Override public void onDone(final String id) {
            bg.post(new Runnable() { public void run() {
                Float v;
                synchronized (OrtiVoice.this) { v = pendingVolume.remove(id); }
                play(id, file(id), v != null ? v : 1f);
            } });
        }
        @Override public void onError(String id) { error(id, "Talsyntesen kunde inte läsa texten."); }
        @Override public void onError(String id, int code) { error(id, "Talsyntesen svarade med fel " + code + "."); }
    }

    /** Svenska röster på enheten: {ready, engine, swedish, voices: [{name, locale, quality, network, installed}]}. */
    String voices() {
        JSONObject o = new JSONObject();
        try {
            synchronized (this) {
                if (!ready) {
                    o.put("ready", false);
                    o.put("failed", failed);
                    if (!failed) withTts(new Runnable() { public void run() { } });
                    return o.toString();
                }
            }
            o.put("ready", true);
            o.put("engine", tts.getDefaultEngine());
            int avail = tts.isLanguageAvailable(SV);
            o.put("swedish", avail >= TextToSpeech.LANG_AVAILABLE);
            JSONArray list = new JSONArray();
            Set<Voice> all = tts.getVoices();
            if (all != null) for (Voice v : all) {
                Locale l = v.getLocale();
                if (l == null || !"sv".equals(l.getLanguage())) continue;
                Set<String> f = v.getFeatures();
                list.put(new JSONObject().put("name", v.getName()).put("locale", l.toString())
                        .put("quality", v.getQuality()).put("network", v.isNetworkConnectionRequired())
                        .put("installed", f == null || !f.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)));
            }
            o.put("voices", list);
        } catch (Exception e) { }
        return o.toString();
    }

    // MARK: - Tala

    /** {id, text (Android) eller ssml (Azure), engine: android|azure, voice, rate, pitch, volume, key, region}. */
    void speak(String json) {
        final JSONObject o;
        try { o = new JSONObject(json); } catch (Exception e) { return; }
        final String id = o.optString("id", "x");
        final float volume = (float) Math.max(0.05, Math.min(1.0, o.optDouble("volume", 1.0)));
        if ("azure".equals(o.optString("engine"))) {
            bg.post(new Runnable() { public void run() { azure(id, o, volume); } });
            return;
        }
        withTts(new Runnable() {
            public void run() {
                if (!ready) { error(id, "Androids talsyntes gick inte att starta."); return; }
                try {
                    String want = o.optString("voice", "");
                    Voice chosen = null;
                    Set<Voice> all = tts.getVoices();
                    if (all != null && want.length() > 0) for (Voice v : all) if (want.equals(v.getName())) chosen = v;
                    if (chosen != null) tts.setVoice(chosen);
                    else if (tts.setLanguage(SV) < TextToSpeech.LANG_AVAILABLE) { error(id, "Svenska saknas i talsyntesen. Ladda ner svenska under Inställningar → Text till tal."); return; }
                    tts.setSpeechRate((float) o.optDouble("rate", 0.95));
                    tts.setPitch((float) o.optDouble("pitch", 0.9));
                    synchronized (OrtiVoice.this) { pendingVolume.put(id, volume); }
                    Bundle p = new Bundle();
                    int r = tts.synthesizeToFile(o.optString("text", ""), p, file(id), id);
                    if (r != TextToSpeech.SUCCESS) error(id, "Talsyntesen tog inte emot texten.");
                } catch (Exception e) {
                    error(id, "Talsyntesen: " + e.getMessage());
                }
            }
        });
    }

    /** Microsoft Azure: SSML in, 24 kHz WAV ut (en fil, så att ljudkurvan kan räknas som för Androids röst). */
    private void azure(String id, JSONObject o, float volume) {
        HttpURLConnection c = null;
        try {
            String region = o.optString("region", "swedencentral").replaceAll("[^a-z0-9]", "");
            URL u = new URL("https://" + region + ".tts.speech.microsoft.com/cognitiveservices/v1");
            c = (HttpURLConnection) u.openConnection();
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setConnectTimeout(8000);
            c.setReadTimeout(20000);
            c.setRequestProperty("Ocp-Apim-Subscription-Key", o.optString("key", ""));
            c.setRequestProperty("Content-Type", "application/ssml+xml");
            c.setRequestProperty("X-Microsoft-OutputFormat", "riff-24khz-16bit-mono-pcm");
            c.setRequestProperty("User-Agent", "FreeMyTV-Orti");
            OutputStream out = c.getOutputStream();
            out.write(o.optString("ssml", "").getBytes("UTF-8"));
            out.close();
            int code = c.getResponseCode();
            if (code != 200) {
                error(id, code == 401 || code == 403 ? "Azure godtog inte nyckeln (" + code + ")." : code == 429 ? "Azure: gratisnivån är slut för i dag (429)." : "Azure svarade " + code + ".");
                return;
            }
            File f = file(id);
            InputStream in = c.getInputStream();
            FileOutputStream fo = new FileOutputStream(f);
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) fo.write(buf, 0, n);
            fo.close();
            in.close();
            play(id, f, volume);
        } catch (Exception e) {
            error(id, "Nådde inte Azure: " + e.getMessage());
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private File file(String id) { return new File(ctx.getCacheDir(), "orti-" + id.replaceAll("[^A-Za-z0-9_-]", "") + ".wav"); }

    // MARK: - Uppspelning och ljudkurvan

    private void play(final String id, final File f, float volume) {
        stopPlayer(false);
        try {
            JSONArray env = envelope(f);
            final MediaPlayer mp = new MediaPlayer();
            AudioAttributes.Builder ab = new AudioAttributes.Builder().setContentType(AudioAttributes.CONTENT_TYPE_SPEECH);
            ab.setUsage(Build.VERSION.SDK_INT >= 26 ? AudioAttributes.USAGE_ASSISTANT : AudioAttributes.USAGE_MEDIA);
            mp.setAudioAttributes(ab.build());
            mp.setDataSource(f.getPath());
            mp.setVolume(volume, volume);
            mp.prepare();
            mp.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                public void onCompletion(MediaPlayer m) { finish(id, f, "end"); }
            });
            mp.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                public boolean onError(MediaPlayer m, int what, int extra) { error(id, "Uppspelningen avbröts (" + what + ")."); finish(id, f, null); return true; }
            });
            player = mp;
            playingId = id;
            gainFocus();
            send(new JSONObject().put("id", id).put("ev", "start").put("dur", mp.getDuration()).put("env", env));
            mp.start();
        } catch (Exception e) {
            error(id, "Uppspelningen: " + e.getMessage());
            f.delete();
        }
    }

    private void finish(String id, File f, String ev) {
        if (player != null && id.equals(playingId)) {
            try { player.release(); } catch (Exception e) { }
            player = null;
            playingId = null;
        }
        dropFocus();
        if (f != null) f.delete();
        if (ev != null) {
            try { send(new JSONObject().put("id", id).put("ev", ev)); } catch (Exception e) { }
        }
    }

    void stop() {
        bg.post(new Runnable() { public void run() {
            stopPlayer(true);
            if (tts != null) { try { tts.stop(); } catch (Exception e) { } }
        } });
    }

    private void stopPlayer(boolean tell) {
        if (player == null) return;
        String id = playingId;
        try { player.stop(); } catch (Exception e) { }
        try { player.release(); } catch (Exception e) { }
        player = null;
        playingId = null;
        dropFocus();
        if (tell && id != null) { try { send(new JSONObject().put("id", id).put("ev", "end").put("stopped", true)); } catch (Exception e) { } }
    }

    /** Ljudstyrkan var 20:e ms (0–1), ur WAV-filen (16 bitar, första kanalen). Tom lista om formatet är okänt. */
    static JSONArray envelope(File f) {
        JSONArray out = new JSONArray();
        try {
            int len = (int) f.length();
            byte[] b = new byte[len];
            FileInputStream in = new FileInputStream(f);
            int got = 0, n;
            while (got < len && (n = in.read(b, got, len - got)) > 0) got += n;
            in.close();
            int pos = 12, channels = 1, rate = 22050, bits = 16, dataAt = -1, dataLen = 0;
            while (pos + 8 <= got) {
                String id = new String(b, pos, 4, "US-ASCII");
                int size = le32(b, pos + 4);
                if ("fmt ".equals(id)) { channels = le16(b, pos + 10); rate = le32(b, pos + 12); bits = le16(b, pos + 22); }
                if ("data".equals(id)) { dataAt = pos + 8; dataLen = Math.min(size < 0 ? got : size, got - dataAt); break; }
                pos += 8 + size + (size & 1);
            }
            if (dataAt < 0 || bits != 16 || channels < 1) return out;
            int frame = 2 * channels, win = Math.max(1, rate / 50), frames = dataLen / frame;
            List<Double> rms = new ArrayList<Double>();
            double max = 1e-9;
            for (int s = 0; s < frames; s += win) {
                double sum = 0;
                int count = 0;
                for (int k = s; k < Math.min(frames, s + win); k++) {
                    int i = dataAt + k * frame;
                    short v = (short) ((b[i] & 0xff) | (b[i + 1] << 8));
                    sum += (double) v * v;
                    count++;
                }
                double r = Math.sqrt(sum / Math.max(1, count));
                rms.add(r);
                if (r > max) max = r;
            }
            for (double r : rms) out.put(Math.round(Math.pow(r / max, 0.6) * 100) / 100.0);
        } catch (Exception e) { }
        return out;
    }

    private static int le16(byte[] b, int i) { return (b[i] & 0xff) | ((b[i + 1] & 0xff) << 8); }
    private static int le32(byte[] b, int i) { return (b[i] & 0xff) | ((b[i + 1] & 0xff) << 8) | ((b[i + 2] & 0xff) << 16) | ((b[i + 3] & 0xff) << 24); }

    // MARK: - Ljudfokus: annat ljud sänks medan O.R.T.I. talar

    private void gainFocus() {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).build();
                am.requestAudioFocus(focus);
            } else {
                am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            }
        } catch (Exception e) { }
    }

    private void dropFocus() {
        try {
            if (Build.VERSION.SDK_INT >= 26) { if (focus != null) am.abandonAudioFocusRequest(focus); focus = null; }
            else am.abandonAudioFocus(null);
        } catch (Exception e) { }
    }

    // MARK: - Till sidan

    private void error(String id, String msg) {
        try { send(new JSONObject().put("id", id).put("ev", "error").put("msg", msg)); } catch (Exception e) { }
    }

    private void send(JSONObject o) { sink.send(o.toString()); }

    void shutdown() {
        stopPlayer(false);
        if (tts != null) { try { tts.shutdown(); } catch (Exception e) { } }
    }
}
