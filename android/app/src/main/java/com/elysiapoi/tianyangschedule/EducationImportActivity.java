package com.elysiapoi.tianyangschedule;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.InputDevice;
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
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Set;

public final class EducationImportActivity extends Activity {
    public static final String EXTRA_SCHEDULE_JSON = "schedule_json";
    private static final String LOGIN_URL = "http://jxgl.dlut.edu.cn/student/home";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private TextView status;
    private ProgressBar progress;
    private Button readButton;
    private Button diagnosticButton;
    private boolean reading;
    private int readAttempts;
    private int failedCriticalAssetCount;
    private String firstFailedAssetHost;
    private String scheduleExtractorScript;
    private String networkCaptureScript;
    private String pendingScheduleJson;
    private String diagnosticReport;
    private final Runnable readRunnable = () -> {
        if (reading && webView != null) runReadStep();
    };

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        status = new TextView(this);
        status.setText(getString(R.string.import_hint));
        status.setTextColor(Color.rgb(45, 55, 72));
        status.setTextSize(14);
        status.setPadding(dp(16), dp(12), dp(16), dp(10));
        root.addView(status, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        progress.setVisibility(ProgressBar.GONE);
        root.addView(progress, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

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

        diagnosticButton = new Button(this);
        diagnosticButton.setText("复制诊断");
        diagnosticButton.setVisibility(Button.GONE);
        diagnosticButton.setOnClickListener(view -> copyDiagnosticReport());
        LinearLayout.LayoutParams diagnosticParams = new LinearLayout.LayoutParams(0, dp(48), 1);
        diagnosticParams.setMarginStart(dp(8));
        actions.addView(diagnosticButton, diagnosticParams);

        readButton = new Button(this);
        readButton.setText("读取当前课表");
        readButton.setTextColor(Color.WHITE);
        readButton.setBackgroundColor(Color.rgb(23, 92, 211));
        readButton.setOnClickListener(view -> {
            if (pendingScheduleJson != null) finishWithImportedSchedule(pendingScheduleJson);
            else readCurrentSchedule();
        });
        LinearLayout.LayoutParams readParams = new LinearLayout.LayoutParams(0, dp(48), 2);
        readParams.setMarginStart(dp(8));
        actions.addView(readButton, readParams);
        root.addView(actions, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        setContentView(root);
        scheduleExtractorScript = readRawText(R.raw.dlut_schedule_extractor);
        networkCaptureScript = buildNetworkCaptureScript();
        configureWebView();
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

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(
                    webView,
                    networkCaptureScript,
                    Set.of("http://jxgl.dlut.edu.cn", "https://jxgl.dlut.edu.cn"));
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                failedCriticalAssetCount = 0;
                firstFailedAssetHost = null;
                progress.setVisibility(ProgressBar.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(reading ? ProgressBar.VISIBLE : ProgressBar.GONE);
                installNetworkCaptureHook();
                if (reading) {
                    status.setText("页面已更新，正在读取当前课表…");
                    scheduleReadStep(500);
                } else if (failedCriticalAssetCount > 0) {
                    status.setText("页面资源加载失败 " + failedCriticalAssetCount + " 项（"
                            + firstFailedAssetHost + "），请截图反馈此提示");
                } else {
                    status.setText(getString(R.string.import_hint));
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
    }

    private String buildNetworkCaptureScript() {
        return "(() => {try{if(window.__tianyangCaptureInstalled)return;window.__tianyangCaptureInstalled=true;"
                + "window.__tianyangScheduleNetworkPayloads=window.__tianyangScheduleNetworkPayloads||[];"
                + "const keep=(v,u='')=>{try{const t=typeof v==='string'?v:JSON.stringify(v);"
                + "if(t&&t.length<1500000&&(/(?:teacher|教师|授课|任课|jsmc|jsxm|rkjs|skjs)/i.test(t)||/(?:schedule|timetable|lesson|course|kcb|kbxx|xskb)/i.test(String(u)))){"
                + "const a=window.__tianyangScheduleNetworkPayloads;a.push({url:String(u||''),text:t});if(a.length>10)a.shift()}}catch(e){}};"
                + "if(window.fetch){const f=window.fetch.bind(window);window.fetch=(...a)=>f(...a).then(r=>{"
                + "try{r.clone().text().then(t=>keep(t,r.url||a[0])).catch(()=>{})}catch(e){}return r})}"
                + "const X=window.XMLHttpRequest;if(X){const o=X.prototype.open;X.prototype.open=function(...a){"
                + "this.__tianyangUrl=a[1];this.addEventListener('load',()=>{try{keep(this.responseType==='json'?this.response:this.responseText,this.responseURL||this.__tianyangUrl)}catch(e){}});"
                + "return o.apply(this,a)}}}catch(e){}})()";
    }

    private void installNetworkCaptureHook() {
        if (webView != null && networkCaptureScript != null) {
            webView.evaluateJavascript(networkCaptureScript, null);
        }
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
        if (!("http".equals(scheme) || "https".equals(scheme))) return false;
        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        return host.equals("dlut.edu.cn") || host.endsWith(".dlut.edu.cn");
    }

    private void readCurrentSchedule() {
        if (reading) return;
        if (scheduleExtractorScript == null) {
            showReadFailure("网页读取组件加载失败");
            return;
        }
        reading = true;
        pendingScheduleJson = null;
        diagnosticReport = null;
        diagnosticButton.setVisibility(Button.GONE);
        readButton.setText("读取当前课表");
        readAttempts = 0;
        progress.setVisibility(ProgressBar.VISIBLE);
        status.setText("正在读取当前网页中的课程…");
        installNetworkCaptureHook();
        scheduleReadStep(0);
    }

    private void scheduleReadStep(long delayMillis) {
        mainHandler.removeCallbacks(readRunnable);
        mainHandler.postDelayed(readRunnable, delayMillis);
    }

    private void runReadStep() {
        if (++readAttempts > 40) {
            showReadFailure("教师详情读取超时，请保持在课表页面后重试");
            return;
        }
        webView.evaluateJavascript(scheduleExtractorScript, result -> {
            if (!reading) return;
            try {
                JSONObject response = new JSONObject(result);
                String action = response.optString("action", "none");
                if ("data".equals(action)) {
                    JSONObject schedule = response.optJSONObject("schedule");
                    if (!isValidExtractedSchedule(schedule)) throw new Exception("网页课表数据不完整");
                    int missingTeachers = countMissingTeachers(schedule);
                    if (missingTeachers > 0) {
                        pendingScheduleJson = schedule.toString();
                        diagnosticReport = buildDiagnosticReport(response, schedule, missingTeachers);
                        reading = false;
                        mainHandler.removeCallbacks(readRunnable);
                        progress.setVisibility(ProgressBar.GONE);
                        diagnosticButton.setVisibility(Button.VISIBLE);
                        readButton.setText("导入已读取课表");
                        status.setText("课表读取完成，但有 " + missingTeachers
                                + " 门课程未获取教师。请先点“复制诊断”，再导入课表。");
                        return;
                    }
                    status.setText("读取成功，正在导入课表…");
                    finishWithImportedSchedule(schedule.toString());
                    return;
                }
                if ("teacher-wait".equals(action)) {
                    int done = response.optInt("teacherDone", 0);
                    int total = response.optInt("teacherTotal", 0);
                    float x = (float) response.optDouble("x", -1);
                    float y = (float) response.optDouble("y", -1);
                    if (x >= 0 && y >= 0 && x <= 1 && y <= 1) hoverWebView(x, y);
                    status.setText("正在读取教师信息 " + Math.min(done + 1, total) + "/" + total + "…");
                    scheduleReadStep(Math.max(700, Math.min(3000, response.optLong("delayMs", 1200))));
                    return;
                }
                int count = response.optInt("courseCount", 0);
                boolean hasDate = response.optBoolean("hasStartDate", false);
                if (count > 0 && !hasDate) {
                    showReadFailure("已找到课程，但没有识别到学期开始日期");
                } else {
                    showReadFailure("当前页面没有识别到课表，请先手动进入“我的课表”并显示周课表");
                }
            } catch (Exception error) {
                showReadFailure("当前网页暂时无法识别，请确认课表已完整显示");
            }
        });
    }

    private boolean isValidExtractedSchedule(@Nullable JSONObject schedule) {
        if (schedule == null) return false;
        String startsOn = schedule.optString("startsOn", "");
        JSONArray courses = schedule.optJSONArray("courses");
        if (!startsOn.matches("20\\d{2}-\\d{2}-\\d{2}") || courses == null || courses.length() < 3) return false;
        for (int index = 0; index < courses.length(); index++) {
            JSONObject course = courses.optJSONObject(index);
            if (course == null || course.optString("name", "").trim().isEmpty()
                    || course.optInt("day", 0) < 1 || course.optInt("day", 0) > 7
                    || course.optInt("startSection", 0) < 1 || course.optInt("endSection", 0) > 12
                    || course.optJSONArray("weeks") == null || course.optJSONArray("weeks").length() == 0) return false;
        }
        return true;
    }

    private int countMissingTeachers(JSONObject schedule) {
        int missing = 0;
        JSONArray courses = schedule.optJSONArray("courses");
        if (courses == null) return 0;
        for (int index = 0; index < courses.length(); index++) {
            JSONObject course = courses.optJSONObject(index);
            JSONArray teachers = course == null ? null : course.optJSONArray("teachers");
            if (teachers == null || teachers.length() == 0) missing++;
        }
        return missing;
    }

    private String buildDiagnosticReport(JSONObject response, JSONObject schedule, int missingTeachers) {
        try {
            JSONObject report = new JSONObject();
            report.put("diagnosticVersion", "teacher-tooltip-1");
            report.put("android", Build.VERSION.RELEASE + " (SDK " + Build.VERSION.SDK_INT + ")");
            report.put("userAgent", webView.getSettings().getUserAgentString());
            Uri current = Uri.parse(webView.getUrl() == null ? "" : webView.getUrl());
            report.put("page", String.valueOf(current.getHost()) + String.valueOf(current.getPath()));
            report.put("courseCount", schedule.optJSONArray("courses").length());
            report.put("missingTeacherCount", missingTeachers);
            report.put("diagnostics", response.optJSONArray("diagnostics") == null
                    ? new JSONArray() : response.optJSONArray("diagnostics"));
            return report.toString(2);
        } catch (Exception error) {
            return "{\"diagnosticVersion\":\"teacher-tooltip-1\",\"error\":\"report-build-failed\"}";
        }
    }

    private void copyDiagnosticReport() {
        if (diagnosticReport == null || diagnosticReport.trim().isEmpty()) {
            Toast.makeText(this, "还没有可复制的诊断信息", Toast.LENGTH_SHORT).show();
            return;
        }
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("天扬课表教师读取诊断", diagnosticReport));
        Toast.makeText(this, "诊断信息已复制，请粘贴发给我", Toast.LENGTH_LONG).show();
    }

    private void finishWithImportedSchedule(String scheduleJson) {
        reading = false;
        mainHandler.removeCallbacks(readRunnable);
        Intent result = new Intent().putExtra(EXTRA_SCHEDULE_JSON, scheduleJson);
        setResult(RESULT_OK, result);
        finish();
    }

    private void showReadFailure(String message) {
        reading = false;
        mainHandler.removeCallbacks(readRunnable);
        progress.setVisibility(ProgressBar.GONE);
        status.setText(message);
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    private void hoverWebView(float xRatio, float yRatio) {
        if (webView == null) return;
        float x = Math.max(1, Math.min(webView.getWidth() - 1, xRatio * webView.getWidth()));
        float y = Math.max(1, Math.min(webView.getHeight() - 1, yRatio * webView.getHeight()));
        long eventTime = android.os.SystemClock.uptimeMillis();
        MotionEvent hover = MotionEvent.obtain(eventTime, eventTime,
                MotionEvent.ACTION_HOVER_MOVE, x, y, 0);
        hover.setSource(InputDevice.SOURCE_MOUSE);
        webView.dispatchGenericMotionEvent(hover);
        hover.recycle();
    }

    private String readRawText(int resourceId) {
        try (InputStream input = getResources().openRawResource(resourceId);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toString(StandardCharsets.UTF_8.name());
        } catch (Exception error) {
            Log.e("TianyangImport", "Raw resource unavailable", error);
            return null;
        }
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
