package com.elysiapoi.tianyangschedule;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Picture;
import android.graphics.Rect;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.print.PrintAttributes;
import android.print.pdf.PrintedPdfDocument;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.http.SslError;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Set;

public final class EducationImportActivity extends Activity {
    public static final String EXTRA_FILENAME = "filename";
    private static final String LOGIN_URL = "http://jxgl.dlut.edu.cn/student/home";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private TextView status;
    private ProgressBar progress;
    private boolean downloading;
    private boolean importFlowActive;
    private boolean awaitingPdfDownload;
    private boolean pdfBridgeAvailable;
    private boolean capturedPdfReceived;
    private int automationAttempts;
    private int failedCriticalAssetCount;
    private String firstFailedAssetHost;
    private final Runnable automationRunnable = () -> {
        if (importFlowActive && !awaitingPdfDownload && !downloading && webView != null) {
            runAutomationStep();
        }
    };

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        status = new TextView(this);
        status.setText(getString(com.elysiapoi.tianyangschedule.R.string.import_hint));
        status.setTextColor(Color.rgb(45, 55, 72));
        status.setTextSize(14);
        status.setPadding(dp(16), dp(12), dp(16), dp(10));
        root.addView(status, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        root.addView(progress, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        WebView.enableSlowWholeDocumentDraw();
        webView = new WebView(this);
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        LinearLayout actions = new LinearLayout(this);
        actions.setGravity(Gravity.CENTER_VERTICAL);
        actions.setPadding(dp(12), dp(8), dp(12), dp(8));
        actions.setBackgroundColor(Color.rgb(245, 247, 251));

        Button close = new Button(this);
        close.setText("关闭");
        close.setOnClickListener(view -> finish());
        actions.addView(close, new LinearLayout.LayoutParams(0, dp(48), 1));

        Button importButton = new Button(this);
        importButton.setText("自动查找并导入");
        importButton.setTextColor(Color.WHITE);
        importButton.setBackgroundColor(Color.rgb(23, 92, 211));
        importButton.setOnClickListener(view -> findAndImport());
        LinearLayout.LayoutParams importParams = new LinearLayout.LayoutParams(0, dp(48), 2);
        importParams.setMarginStart(dp(8));
        actions.addView(importButton, importParams);
        root.addView(actions, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        setContentView(root);
        configureWebView();
        configurePdfBridge();
        webView.loadUrl(LOGIN_URL);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setBlockNetworkLoads(false);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(toDesktopUserAgent(WebSettings.getDefaultUserAgent(this)));

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                failedCriticalAssetCount = 0;
                firstFailedAssetHost = null;
                progress.setVisibility(ProgressBar.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(ProgressBar.GONE);
                installPdfCaptureHook();
                if (importFlowActive) {
                    if (awaitingPdfDownload) {
                        status.setText("正在等待教务系统返回 PDF…");
                    } else {
                        status.setText("正在自动进入课表导出页面…");
                        scheduleAutomationStep(650);
                    }
                } else if (failedCriticalAssetCount > 0) {
                    status.setText("页面资源加载失败 " + failedCriticalAssetCount + " 项（"
                            + firstFailedAssetHost + "），请截图反馈此提示");
                } else {
                    status.setText("登录成功后点一次下方按钮，应用会自动进入课表并导入");
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isDlutHttpUri(request.getUrl())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                recordResourceFailure(request, String.valueOf(error.getDescription()));
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                            WebResourceResponse errorResponse) {
                recordResourceFailure(request, "HTTP " + errorResponse.getStatusCode());
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                status.setText("官方页面的安全证书校验失败，已停止连接");
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
                startPdfDownload(url, userAgent, webView.getUrl()));
    }

    private void configurePdfBridge() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(
                webView,
                "TianyangPdfBridge",
                Set.of("http://jxgl.dlut.edu.cn", "https://jxgl.dlut.edu.cn"),
                (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                    if (!isDlutHttpUri(sourceOrigin)) return;
                    receiveCapturedPdf(message.getData());
                });
        pdfBridgeAvailable = true;
    }

    private void installPdfCaptureHook() {
        if (!pdfBridgeAvailable || webView == null) return;
        String script = "(() => {"
                + "const bridge=window.TianyangPdfBridge;if(!bridge)return;"
                + "const install=w=>{try{if(w.__tianyangPdfHook)return;w.__tianyangPdfHook=true;"
                + "const sendData=data=>{if(typeof data==='string'&&data.startsWith('data:application/pdf'))bridge.postMessage('pdf:'+data.slice(data.indexOf(',')+1));};"
                + "const sendBlob=blob=>{if(!blob||blob.__tianyangSeen)return;try{blob.__tianyangSeen=true}catch(e){}"
                + "const head=new w.FileReader();head.onload=()=>{if(String(head.result||'').startsWith('%PDF-')){const full=new w.FileReader();full.onload=()=>sendData(String(full.result||''));full.readAsDataURL(blob)}};head.readAsText(blob.slice(0,5));};"
                + "const originalCreate=w.URL.createObjectURL.bind(w.URL);w.URL.createObjectURL=blob=>{sendBlob(blob);return originalCreate(blob)};"
                + "const originalOpen=w.open?w.open.bind(w):null;if(originalOpen)w.open=(url,...args)=>{sendData(String(url||''));return originalOpen(url,...args)};"
                + "w.document.addEventListener('click',e=>{const a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(a)sendData(String(a.href||''))},true);"
                + "for(const f of w.document.querySelectorAll('iframe')){try{if(f.contentWindow)install(f.contentWindow)}catch(e){}}"
                + "}catch(e){}};install(window);"
                + "})()";
        webView.evaluateJavascript(script, null);
    }

    private String toDesktopUserAgent(String original) {
        String desktop = original.replaceFirst("\\(Linux; Android[^)]*\\)", "(X11; Linux x86_64)");
        desktop = desktop.replace(" Version/4.0", "");
        desktop = desktop.replace("; wv", "");
        desktop = desktop.replace(" Mobile", "");
        return desktop;
    }

    private void recordResourceFailure(WebResourceRequest request, String reason) {
        Uri uri = request.getUrl();
        if (request.isForMainFrame()) {
            status.setText("页面打开失败：" + reason);
            Log.w("TianyangImport", "Main page failed: " + uri + " (" + reason + ")");
            return;
        }
        String path = uri.getPath() == null ? "" : uri.getPath().toLowerCase(Locale.ROOT);
        if (!(path.endsWith(".css") || path.endsWith(".js") || path.endsWith(".mjs")
                || path.contains("/static/") || path.contains("/assets/"))) return;
        failedCriticalAssetCount++;
        if (firstFailedAssetHost == null) {
            firstFailedAssetHost = uri.getHost() == null ? uri.toString() : uri.getHost();
        }
        Log.w("TianyangImport", "Resource failed: " + uri + " (" + reason + ")");
    }

    private boolean isDlutHttpUri(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        return ("http".equals(scheme) || "https".equals(scheme)) && isDlutHost(uri);
    }

    private boolean isDlutHost(Uri uri) {
        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        return host.equals("dlut.edu.cn") || host.endsWith(".dlut.edu.cn");
    }

    private void findAndImport() {
        if (downloading) return;
        importFlowActive = true;
        awaitingPdfDownload = false;
        capturedPdfReceived = false;
        automationAttempts = 0;
        status.setText("正在自动查找“我的课表”…");
        installPdfCaptureHook();
        scheduleAutomationStep(0);
    }

    private void scheduleAutomationStep(long delayMillis) {
        mainHandler.removeCallbacks(automationRunnable);
        mainHandler.postDelayed(automationRunnable, delayMillis);
    }

    private void runAutomationStep() {
        if (++automationAttempts > 32) {
            importFlowActive = false;
            progress.setVisibility(ProgressBar.GONE);
            status.setText("未能自动定位课表入口，请截图当前页面反馈");
            Toast.makeText(this, "未能自动定位课表入口，请截图当前页面反馈", Toast.LENGTH_LONG).show();
            return;
        }

        String script = "(() => {"
                + "const docs=[document];"
                + "for(const f of document.querySelectorAll('iframe')){try{if(f.contentDocument)docs.push(f.contentDocument)}catch(e){}}"
                + "const text=n=>String(n.innerText||n.value||n.textContent||'').replace(/\\s+/g,'').trim();"
                + "const visible=n=>{const w=n.ownerDocument.defaultView,s=w.getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<w.innerHeight&&r.left<w.innerWidth};"
                + "const nodes=[].concat(...docs.map(d=>[...d.querySelectorAll('a,button,input,[role=button],[onclick],li,span,div,p')])).filter(visible);"
                + "const target=n=>{let c=n;for(let i=0;c&&i<12;i++,c=c.parentElement){const w=c.ownerDocument.defaultView,s=w.getComputedStyle(c);if(c.matches('a,button,input,[role=button],[onclick],li,.btn,.menu-item,.dropdown-toggle')||s.cursor==='pointer')return c}return n};"
                + "const point=(action,n)=>{n=target(n);const r=n.getBoundingClientRect();let x=r.left+r.width/2,y=r.top+r.height/2,w=n.ownerDocument.defaultView;while(w!==window&&w.frameElement){const fr=w.frameElement.getBoundingClientRect();x+=fr.left;y+=fr.top;w=w.parent}return {action,x:x/window.innerWidth,y:y/window.innerHeight}};"
                + "const exact=(...labels)=>nodes.filter(n=>labels.includes(text(n))).sort((a,b)=>text(a).length-text(b).length)[0];"
                + "const contains=(...labels)=>nodes.filter(n=>labels.some(v=>text(n).includes(v))&&text(n).length<36).sort((a,b)=>text(a).length-text(b).length)[0];"
                + "const pdf=exact('导出至一个PDF文件','导出为PDF文件','导出PDF','PDF导出')||nodes.find(n=>/导出.*PDF|PDF.*导出/i.test(text(n))&&text(n).length<36);"
                + "if(pdf)return point('pdf',pdf);"
                + "const exportMenu=exact('导出')||nodes.find(n=>/^导出[▼▽▾]?$/.test(text(n)));"
                + "if(exportMenu)return point('menu',exportMenu);"
                + "const printSchedule=exact('打印大课表','大课表','周课表')||contains('打印大课表');"
                + "if(printSchedule)return point('print',printSchedule);"
                + "const schedule=exact('我的课表')||contains('我的课表');"
                + "if(schedule)return point('schedule',schedule);"
                + "return {action:'none'};})()";
        webView.evaluateJavascript(script, result -> {
            if (!importFlowActive || downloading) return;
            try {
                JSONObject target = new JSONObject(result);
                String action = target.optString("action", "none");
                if ("none".equals(action)) {
                    status.setText("正在等待课表页面加载…");
                    scheduleAutomationStep(900);
                    return;
                }
                float x = (float) target.optDouble("x", -1);
                float y = (float) target.optDouble("y", -1);
                if (x < 0 || y < 0 || x > 1 || y > 1) throw new Exception("按钮位置异常");
                installPdfCaptureHook();
                tapWebView(x, y);
                if ("pdf".equals(action)) {
                    awaitingPdfDownload = true;
                    status.setText("正在请求教务系统导出 PDF…");
                    mainHandler.postDelayed(() -> {
                        if (importFlowActive && !downloading && !capturedPdfReceived) {
                            exportCurrentPageToPdf();
                        }
                    }, 6000);
                } else if ("menu".equals(action)) {
                    status.setText("正在选择“导出至一个 PDF 文件”…");
                    scheduleAutomationStep(850);
                } else if ("print".equals(action)) {
                    status.setText("正在打开大课表导出页面…");
                    scheduleAutomationStep(1300);
                } else if ("schedule".equals(action)) {
                    status.setText("正在进入“我的课表”…");
                    scheduleAutomationStep(1300);
                }
            } catch (Exception error) {
                status.setText("正在等待课表页面加载…");
                scheduleAutomationStep(900);
            }
        });
    }

    private void tapWebView(float xRatio, float yRatio) {
        if (webView == null) return;
        float x = Math.max(1, Math.min(webView.getWidth() - 1, xRatio * webView.getWidth()));
        float y = Math.max(1, Math.min(webView.getHeight() - 1, yRatio * webView.getHeight()));
        long downTime = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0);
        MotionEvent up = MotionEvent.obtain(downTime, downTime + 90, MotionEvent.ACTION_UP, x, y, 0);
        webView.dispatchTouchEvent(down);
        webView.dispatchTouchEvent(up);
        down.recycle();
        up.recycle();
    }

    private void receiveCapturedPdf(String message) {
        if (!importFlowActive || capturedPdfReceived || message == null || !message.startsWith("pdf:")) return;
        capturedPdfReceived = true;
        awaitingPdfDownload = false;
        downloading = true;
        mainHandler.removeCallbacks(automationRunnable);
        progress.setVisibility(ProgressBar.VISIBLE);
        status.setText("已取得学校原始 PDF，正在校验课表…");
        String encoded = message.substring(4);
        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                if (bytes.length < 5
                        || bytes[0] != '%'
                        || bytes[1] != 'P'
                        || bytes[2] != 'D'
                        || bytes[3] != 'F'
                        || bytes[4] != '-') {
                    throw new Exception("教务系统生成的文件不是 PDF");
                }
                savePdfBytes(bytes);
                mainHandler.post(this::finishWithImportedPdf);
            } catch (Exception error) {
                mainHandler.post(() -> failNativePdf(error.getMessage()));
            }
        }, "captured-schedule-pdf").start();
    }

    private void savePdfBytes(byte[] bytes) throws Exception {
        File directory = new File(getFilesDir(), "imported");
        if (!directory.exists() && !directory.mkdirs()) throw new Exception("无法创建本地目录");
        File temporary = new File(directory, "schedule.pdf.tmp");
        File destination = new File(directory, "schedule.pdf");
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write(bytes);
        }
        if (destination.exists() && !destination.delete()) throw new Exception("无法替换旧课表文件");
        if (!temporary.renameTo(destination)) throw new Exception("无法保存课表文件");
    }

    private void startPdfDownload(String url, String userAgent, String referer) {
        if (downloading) return;
        awaitingPdfDownload = false;
        Uri downloadUri = Uri.parse(url);
        if ("data".equals(downloadUri.getScheme())) {
            int comma = url.indexOf(',');
            if (comma >= 0 && url.substring(0, comma).toLowerCase(Locale.ROOT).contains("application/pdf")) {
                receiveCapturedPdf("pdf:" + url.substring(comma + 1));
            }
            return;
        }
        if ("blob".equals(downloadUri.getScheme())) {
            status.setText("正在读取教务系统生成的 PDF…");
            mainHandler.postDelayed(() -> {
                if (importFlowActive && !downloading && !capturedPdfReceived) exportCurrentPageToPdf();
            }, 3500);
            return;
        }
        if (!isDlutHttpUri(downloadUri)) {
            status.setText("已拒绝来自非大工域名的下载请求");
            return;
        }
        downloading = true;
        progress.setVisibility(ProgressBar.VISIBLE);
        status.setText("正在下载并校验课表…");
        new Thread(() -> {
            try {
                downloadPdf(url, userAgent, referer);
                mainHandler.post(this::finishWithImportedPdf);
            } catch (Exception error) {
                mainHandler.post(() -> {
                    downloading = false;
                    status.setText("官方下载无法读取，正在改用网页课表生成 PDF…");
                    exportCurrentPageToPdf();
                });
            }
        }, "schedule-pdf-download").start();
    }

    @SuppressWarnings("deprecation")
    private void exportCurrentPageToPdf() {
        if (downloading || webView == null) return;
        awaitingPdfDownload = false;
        downloading = true;
        progress.setVisibility(ProgressBar.VISIBLE);
        status.setText("官方下载未响应，正在直接生成课表 PDF…");

        File directory = new File(getFilesDir(), "imported");
        if (!directory.exists() && !directory.mkdirs()) {
            failNativePdf("无法创建本地目录");
            return;
        }
        File temporary = new File(directory, "schedule.webview.pdf.tmp");
        File destination = new File(directory, "schedule.pdf");
        if (temporary.exists() && !temporary.delete()) {
            failNativePdf("无法清理临时文件");
            return;
        }

        Picture picture = webView.capturePicture();
        int pictureWidth = Math.max(1, picture.getWidth());
        int pictureHeight = Math.max(1, picture.getHeight());
        int pageWidthMils = 8270;
        int pageHeightMils = Math.max(11690,
                Math.min(28000, Math.round(pageWidthMils * pictureHeight / (float) pictureWidth)));
        PrintAttributes.MediaSize singlePage = new PrintAttributes.MediaSize(
                "tianyang_schedule_single_page", "单页学生大课表", pageWidthMils, pageHeightMils);
        PrintAttributes attributes = new PrintAttributes.Builder()
                .setMediaSize(singlePage)
                .setResolution(new PrintAttributes.Resolution("tianyang_pdf", "课表 PDF", 240, 240))
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                .build();
        PrintedPdfDocument document = new PrintedPdfDocument(this, attributes);
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            Rect pageArea = document.getPageContentRect();
            float scale = Math.min(pageArea.width() / (float) pictureWidth,
                    pageArea.height() / (float) pictureHeight);
            PdfDocument.Page page = document.startPage(0);
            page.getCanvas().save();
            page.getCanvas().translate(pageArea.left, pageArea.top);
            page.getCanvas().scale(scale, scale);
            picture.draw(page.getCanvas());
            page.getCanvas().restore();
            document.finishPage(page);
            document.writeTo(output);
        } catch (Exception error) {
            failNativePdf(error.getMessage());
            return;
        } finally {
            document.close();
        }

        if (temporary.length() < 5) {
            failNativePdf("生成的网页课表为空");
        } else if (destination.exists() && !destination.delete()) {
            failNativePdf("无法替换旧课表文件");
        } else if (!temporary.renameTo(destination)) {
            failNativePdf("无法保存课表文件");
        } else {
            finishWithImportedPdf();
        }
    }

    private void failNativePdf(String message) {
        downloading = false;
        importFlowActive = false;
        awaitingPdfDownload = false;
        mainHandler.removeCallbacks(automationRunnable);
        progress.setVisibility(ProgressBar.GONE);
        status.setText("导入失败：" + (message == null ? "网页课表生成失败" : message));
    }

    private void finishWithImportedPdf() {
        importFlowActive = false;
        awaitingPdfDownload = false;
        mainHandler.removeCallbacks(automationRunnable);
        Intent result = new Intent().putExtra(EXTRA_FILENAME, "学生大课表.pdf");
        setResult(RESULT_OK, result);
        finish();
    }

    private void downloadPdf(String address, String userAgent, String referer) throws Exception {
        HttpURLConnection connection = openDlutConnection(address, userAgent, referer);

        File directory = new File(getFilesDir(), "imported");
        if (!directory.exists() && !directory.mkdirs()) throw new Exception("无法创建本地目录");
        File temporary = new File(directory, "schedule.pdf.tmp");
        File destination = new File(directory, "schedule.pdf");

        try (InputStream raw = connection.getInputStream();
             BufferedInputStream input = new BufferedInputStream(raw);
             FileOutputStream output = new FileOutputStream(temporary)) {
            byte[] signature = new byte[5];
            int read = input.read(signature);
            if (read != 5 || !"%PDF-".equals(new String(signature, StandardCharsets.US_ASCII))) {
                throw new Exception("教务系统没有返回 PDF 文件");
            }
            output.write(signature);
            byte[] buffer = new byte[16 * 1024];
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        } finally {
            connection.disconnect();
        }

        if (destination.exists() && !destination.delete()) throw new Exception("无法替换旧课表文件");
        if (!temporary.renameTo(destination)) throw new Exception("无法保存课表文件");
    }

    private HttpURLConnection openDlutConnection(String address, String userAgent, String referer) throws Exception {
        URL current = new URL(address);
        for (int redirects = 0; redirects < 5; redirects++) {
            Uri currentUri = Uri.parse(current.toString());
            if (!isDlutHttpUri(currentUri)) throw new Exception("已拒绝非大工域名的下载地址");

            HttpURLConnection connection = (HttpURLConnection) current.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "application/pdf,*/*;q=0.8");
            if (userAgent != null) connection.setRequestProperty("User-Agent", userAgent);
            if (referer != null && isDlutHttpUri(Uri.parse(referer))) {
                connection.setRequestProperty("Referer", referer);
            }
            String cookies = CookieManager.getInstance().getCookie(current.toString());
            if (cookies != null) connection.setRequestProperty("Cookie", cookies);

            int code = connection.getResponseCode();
            if (code >= 200 && code < 300) return connection;
            if (code >= 300 && code < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new Exception("下载跳转缺少地址");
                current = new URL(current, location);
                referer = currentUri.toString();
                continue;
            }
            connection.disconnect();
            throw new Exception("下载请求返回 " + code);
        }
        throw new Exception("课表下载跳转次数过多");
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
