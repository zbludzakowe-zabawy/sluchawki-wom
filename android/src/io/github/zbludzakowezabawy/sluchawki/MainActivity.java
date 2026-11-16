package io.github.zbludzakowezabawy.sluchawki;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Słuchawki jako zwykła aplikacja na Androida: okno WebView ze stroną z GitHub Pages.
 * Cała aplikacja (nagrania offline, quizy, zbiory) działa w stronie – tu jest tylko „ramka”:
 * wybór plików, zapis eksportu, udostępnianie, przycisk Wstecz i ekran „brak internetu”.
 */
public class MainActivity extends Activity {
    static final String HOME = "https://zbludzakowe-zabawy.github.io/sluchawki-wom/";
    static final String HOST = "zbludzakowe-zabawy.github.io";
    static final String PATH = "/sluchawki-wom";
    static final int REQ_FILES = 1;
    static final int REQ_SAVE = 2;

    WebView web;
    ValueCallback<Uri[]> fileCallback;
    String pendingSave;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#2b2768"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportMultipleWindows(false);
        // strona rozpoznaje aplikację po tym dopisku (np. nie pokazuje baneru „Zainstaluj”)
        s.setUserAgentString(s.getUserAgentString() + " SluchawkiApp/1");

        web.addJavascriptInterface(new Bridge(), "SluchawkiAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (state != null && web.restoreState(state) != null) return;
        web.loadUrl(startUrl(getIntent()));
    }

    static boolean ours(Uri u) {
        return u != null && "https".equals(u.getScheme()) && HOST.equals(u.getHost())
                && u.getPath() != null && u.getPath().startsWith(PATH);
    }

    String startUrl(Intent i) {
        Uri u = i == null ? null : i.getData();
        return ours(u) ? u.toString() : HOME;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && ours(intent.getData())) web.loadUrl(intent.getData().toString());
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Nie można otworzyć linku", Toast.LENGTH_SHORT).show();
        }
    }

    class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (ours(u)) return false;
            openOutside(u); // np. instrukcja klucza API – w przeglądarce
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (!req.isForMainFrame()) return;
            String html = "<!doctype html><meta name=viewport content='width=device-width'>"
                    + "<body style='font-family:sans-serif;background:#2b2768;color:#fff;text-align:center;padding:3em 1.5em'>"
                    + "<h2>🎧 Brak internetu</h2>"
                    + "<p>Za pierwszym razem Słuchawki muszą się wczytać z internetu. Potem działają też bez niego.</p>"
                    + "<p><button onclick='location.replace(\"" + HOME + "\")' style='font-size:1.2em;padding:.6em 1.4em;border-radius:12px;border:0'>Spróbuj ponownie</button></p>";
            view.loadDataWithBaseURL(HOME, html, "text/html", "utf-8", req.getUrl().toString());
        }
    }

    class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            boolean images = false;
            for (String t : p.getAcceptTypes()) if (t != null && t.contains("image/")) images = true;
            if (images) {
                // lista utworów: zdjęcie, PDF albo tekst
                i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "application/pdf", "text/plain"});
            }
            // pliki .json: bez filtra – na Androidzie często mają typ „application/octet-stream”
            if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(Intent.createChooser(i, "Wybierz plik"), REQ_FILES);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_FILES) {
            if (fileCallback == null) return;
            Uri[] out = null;
            if (res == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null && clip.getItemCount() > 0) {
                    out = new Uri[clip.getItemCount()];
                    for (int k = 0; k < out.length; k++) out[k] = clip.getItemAt(k).getUri();
                } else if (data.getData() != null) {
                    out = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(out);
            fileCallback = null;
        } else if (req == REQ_SAVE) {
            String text = pendingSave;
            pendingSave = null;
            if (res != RESULT_OK || data == null || data.getData() == null || text == null) return;
            try (OutputStream os = getContentResolver().openOutputStream(data.getData())) {
                os.write(text.getBytes(StandardCharsets.UTF_8));
                Toast.makeText(this, "Zapisano plik", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Nie udało się zapisać pliku", Toast.LENGTH_LONG).show();
            }
        } else {
            super.onActivityResult(req, res, data);
        }
    }

    /** Funkcje dostępne w stronie jako window.SluchawkiAndroid */
    class Bridge {
        /** eksport zbioru: Android pyta, gdzie zapisać plik */
        @JavascriptInterface
        public void saveFile(final String name, final String text) {
            runOnUiThread(new Runnable() {
                public void run() {
                    pendingSave = text;
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("application/json");
                    i.putExtra(Intent.EXTRA_TITLE, name);
                    try {
                        startActivityForResult(i, REQ_SAVE);
                    } catch (ActivityNotFoundException e) {
                        pendingSave = null;
                        Toast.makeText(MainActivity.this, "Nie można zapisać pliku", Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        /** „Udostępnij” zbiór: zwykłe okno udostępniania Androida */
        @JavascriptInterface
        public void share(final String title, final String text) {
            runOnUiThread(new Runnable() {
                public void run() {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_SUBJECT, title);
                    i.putExtra(Intent.EXTRA_TEXT, text);
                    try {
                        startActivity(Intent.createChooser(i, title));
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(MainActivity.this, "Nie można udostępnić", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }
    }
}
