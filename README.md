# 天扬课表

一个面向手机桌面使用的简洁个人课表：打开即可查看当天课程，不含广告，课程数据保存在本地。

[在线使用](https://tianyang-schedule.hearty-gnat-4552.chatgpt.site)

![天扬课表界面](docs/screenshot.jpg)

## 为什么做这个项目

教务系统查看课表步骤较多，常见课表应用又包含广告。这个项目希望把课表还原成一个安静、直接的工具：从安卓桌面打开后，马上看到今天、本周以及下一节课。

## 功能

- 单日课表与完整周课表，上午、下午、晚间课程按时间对齐
- 显示当前周日期范围，以及“正在上课 / 下一节课”状态
- 支持从教务系统当前课表网页直接读取课程
- 支持本地导入 PDF、XLSX、CSV、TSV、ICS、HTML 和 JSON 课表
- 手动添加实验课、临时课程，并支持一次、多周或自选周次
- 点击课程查看详情、教师、教室、周次和备注
- 普通课程可按单周临时调课、停课和恢复
- 添加或修改课程时检查时间冲突，但不阻止用户保存
- JSON 数据备份与恢复
- 支持添加到安卓主屏幕和离线访问
- 安卓应用内登录综合教务系统，手动进入“我的课表”后一键读取当前网页

## 数据与隐私

课程、备注、调课和停课记录默认只保存在当前浏览器的 `localStorage` 中，不会上传账号密码或课表数据。清除浏览器数据或更换设备前，请先使用“备份与恢复”导出 JSON 文件。

安卓端的账号、密码和验证码只在大连理工大学官方登录页面中填写。应用不会读取或保存密码；导入窗口关闭时会清除登录 Cookie，读取到的网页课表也只在本机导入。

## 安卓版本

安卓端会把课表页面离线打包进 APK。查看课表不需要联网，只有从综合教务系统导入新学期课表时需要网络。

获取测试 APK：

1. 打开仓库的 **Actions → Build Android APK**。
2. 点击 **Run workflow**。
3. 构建完成后下载 `tianyang-schedule-debug`。
4. 解压并安装其中的 `app-debug.apk`。

在应用内点击“教务系统读取”，应用会打开综合教务系统首页 `http://jxgl.dlut.edu.cn/student/home`。完成统一身份认证后，请自己进入“我的课表”并让周课表完整显示，再点击底部“读取当前课表”。应用会合并网页课程卡片、悬浮详情以及课表接口响应中的信息；不再尝试自动点击学校页面，也不再经过网页端 PDF 导出。

“从文件导入”与教务系统读取完全独立，可选择 PDF、XLSX、CSV、TSV、TXT、ICS、HTML 或 JSON。旧版二进制 `.xls` 请先在 Excel/WPS 中另存为 `.xlsx` 或 `.csv`；表格文件应包含课程名称、星期或日期、节次或上课时间、周次，以及学期开始日期等列。

本地构建需要 Node.js 22.13、JDK 17、Android SDK 36 和 Gradle 9.5：

```bash
npm ci
npm run build:android-web
gradle -p android :app:assembleDebug
```

## 技术栈

- React 19 + TypeScript
- Next.js / Vinext
- Tailwind CSS
- Shadcn UI
- PDF.js + fflate
- Service Worker + Web App Manifest

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
git clone https://github.com/ElysiaPOI/tianyang-schedule.git
cd tianyang-schedule
npm install
npm run dev
```

开发服务器启动后，根据终端提示在浏览器中打开本地地址。

## 构建与测试

```bash
npm run build:local
npm test
```

项目的线上版本运行在 Cloudflare Workers 兼容环境中。仓库内的 Sites 配置用于当前演示站点的持续发布。

## 项目状态

当前版本已覆盖日常课表查看、临时课程、调课停课、冲突提醒、数据备份以及安卓端教务系统导入等核心场景。后续更新将优先解决真实使用中发现的问题，保持界面简洁。

## 开源协议

本项目采用 [MIT License](LICENSE)。
