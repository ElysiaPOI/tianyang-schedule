# Android 正式版发布

正式 APK 使用项目专用密钥签名。签名密钥及密码不得提交到仓库；密钥一旦丢失，后续版本将无法覆盖安装到已有用户的手机。

## GitHub 仓库机密

在仓库 **Settings → Secrets and variables → Actions** 中添加：

- `ANDROID_SIGNING_KEY`：`tianyang-schedule-release.jks` 的 Base64 文本
- `ANDROID_KEYSTORE_PASSWORD`：密钥库密码
- `ANDROID_KEY_ALIAS`：密钥别名
- `ANDROID_KEY_PASSWORD`：私钥密码

生成 Base64 文本：

```bash
base64 -w 0 tianyang-schedule-release.jks
```

Windows PowerShell：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("tianyang-schedule-release.jks"))
```

## 构建但不发布

打开 **Actions → Verify and publish Android APK → Run workflow**，保持“同时创建 GitHub Release”为关闭状态。工作流会生成签名后的 `tianyang-schedule-release` 构建产物。

## 创建正式 Release

手动运行工作流，开启“同时创建 GitHub Release”，并填写与 `android/app/build.gradle` 中 `versionName` 一致的标签，例如 `v1.2.6`。工作流会验证签名、生成 SHA-256 校验文件，并创建 GitHub Release。

也可以推送格式为 `v*` 的 Git 标签触发发布。标签必须与 `versionName` 完全一致。

## 本地构建

先构建离线网页，再提供四个签名环境变量：

```bash
npm ci
npm run build:android-web
export TIANYANG_KEYSTORE_PATH=/absolute/path/tianyang-schedule-release.jks
export TIANYANG_KEYSTORE_PASSWORD=your-store-password
export TIANYANG_KEY_ALIAS=tianyang_release
export TIANYANG_KEY_PASSWORD=your-key-password
gradle -p android :app:assembleRelease
```

输出文件位于 `android/app/build/outputs/apk/release/app-release.apk`。

## 从 debug 版迁移

debug 版和正式版的签名证书不同，通常不能直接覆盖安装。先在旧版中通过“备份与恢复”导出 JSON，再卸载旧版、安装正式版并恢复数据。此后使用相同正式密钥构建的版本可以直接覆盖升级。
