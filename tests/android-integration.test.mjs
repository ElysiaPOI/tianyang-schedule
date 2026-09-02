import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")

test("android build uses the offline static export", async () => {
  const [config, pkg, gradle] = await Promise.all([
    read("next.config.ts"),
    read("package.json"),
    read("android/app/build.gradle"),
  ])
  assert.match(config, /output: "export"/)
  assert.match(pkg, /build:android-web/)
  assert.match(gradle, /dist\/client/)
})

test("android import keeps credentials inside the official web page", async () => {
  const [main, importer, network] = await Promise.all([
    read("android/app/src/main/java/com/elysiapoi/tianyangschedule/MainActivity.java"),
    read("android/app/src/main/java/com/elysiapoi/tianyangschedule/EducationImportActivity.java"),
    read("android/app/src/main/res/xml/network_security_config.xml"),
  ])
  assert.match(main, /addJavascriptInterface\(new AndroidBridge\(\), "TianyangAndroid"\)/)
  assert.doesNotMatch(importer, /addJavascriptInterface/)
  assert.match(importer, /jxgl\.dlut\.edu\.cn\/student\/home/)
  assert.match(importer, /setUseWideViewPort\(true\)/)
  assert.match(importer, /isDlutHost/)
  assert.match(importer, /isDlutHttpUri/)
  assert.match(importer, /setInstanceFollowRedirects\(false\)/)
  assert.match(importer, /removeAllCookies/)
  assert.match(importer, /%PDF-/)
  assert.match(network, /base-config cleartextTrafficPermitted="false"/)
  assert.match(network, /includeSubdomains="true">dlut\.edu\.cn/)
  assert.doesNotMatch(importer, /password|passwd|账号密码/i)
})

test("web app accepts a PDF delivered by the native bridge", async () => {
  const source = await read("app/schedule-app.tsx")
  assert.match(source, /tianyang:android-pdf-ready/)
  assert.match(source, /openTeachingSystem/)
  assert.match(source, /教务系统导入/)
})

test("android webview opens the system PDF picker", async () => {
  const main = await read("android/app/src/main/java/com/elysiapoi/tianyangschedule/MainActivity.java")
  assert.match(main, /onShowFileChooser/)
  assert.match(main, /Intent\.ACTION_OPEN_DOCUMENT/)
  assert.match(main, /setType\("application\/pdf"\)/)
  assert.match(main, /PDF_PICKER_REQUEST/)
  assert.match(main, /FileChooserParams\.parseResult/)
  assert.match(main, /setAllowContentAccess\(true\)/)
})
