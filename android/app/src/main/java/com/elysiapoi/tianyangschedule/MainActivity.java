package com.elysiapoi.tianyangschedule;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;

public final class MainActivity extends Activity {
    private static final int IMPORT_REQUEST = 1101;
    private static final String APP_ORIGIN = "https://appassets.androidplatform.net";

    private WebView webView;
    private WebViewAssetLoader assetLoader;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(245, 247, 251));
        getWindow().setNavigationBarColor(Color.WHITE);

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/imported/", new WebViewAssetLoader.InternalStoragePathHandler(
                        this, new java.io.File(getFilesDir(), "imported")))
                .addPathHandler("/", this::loadBundledAsset)
                .build();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(245, 247, 251));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " TianyangSchedule/1.1");

        webView.addJavascriptInterface(new AndroidBridge(), "TianyangAndroid");
        webView.setWebViewClient(new LocalContentClient());
        setContentView(webView);
        webView.loadUrl(APP_ORIGIN + "/index.html");
    }

    private WebResourceResponse loadBundledAsset(String path) {
        String safePath = path == null || path.isEmpty() ? "index.html" : Uri.decode(path);
        if (safePath.endsWith("/")) safePath += "index.html";
        if (safePath.contains("..")) return null;
        try {
            InputStream input = getAssets().open(safePath);
            String extension = MimeTypeMap.getFileExtensionFromUrl(safePath);
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
            if (mime == null) {
                if (safePath.endsWith(".mjs") || safePath.endsWith(".js")) mime = "application/javascript";
                else if (safePath.endsWith(".rsc")) mime = "text/x-component";
                else mime = "application/octet-stream";
            }
            return new WebResourceResponse(mime, null, input);
        } catch (IOException ignored) {
            return null;
        }
    }

    private void deliverImportedPdf(String filename) {
        String url = APP_ORIGIN + "/imported/schedule.pdf";
        String script = "window.dispatchEvent(new CustomEvent('tianyang:android-pdf-ready',{detail:{url:"
                + JSONObject.quote(url) + ",filename:" + JSONObject.quote(filename) + "}}));";
        webView.evaluateJavascript(script, null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == IMPORT_REQUEST && resultCode == RESULT_OK && data != null) {
            deliverImportedPdf(data.getStringExtra(EducationImportActivity.EXTRA_FILENAME));
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    public final class AndroidBridge {
        @JavascriptInterface
        public void openTeachingSystem() {
            runOnUiThread(() -> startActivityForResult(
                    new Intent(MainActivity.this, EducationImportActivity.class), IMPORT_REQUEST));
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }
    }

    private final class LocalContentClient extends WebViewClientCompat {
        @Nullable
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assetLoader.shouldInterceptRequest(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if ("appassets.androidplatform.net".equals(uri.getHost())) return false;
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
            return true;
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            view.destroy();
            recreate();
            return true;
        }
    }
}
