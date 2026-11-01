# 发布与签名

本文说明如何产出可分发、可被 Windows/macOS 信任的安装包。没有签名的安装包依然能用，
但 Windows 用户会看到 SmartScreen「未知发布者」红屏、macOS 用户需要右键「打开」，
这会直接损失大部分下载转化。

## 1. 版本号与发布

1. 更新 `package.json` 的 `version`。
2. 在 `CHANGELOG.md` 顶部追加本次变更。
3. 提交后打 tag 并推送：

```bash
git tag v0.3.0
git push origin v0.3.0
```

tag 会触发 `.github/workflows/release.yml`，在 Windows / macOS / Linux 三个平台并行构建，
并通过 `--publish always` 上传到 GitHub Releases。仓库已配置为 `ShirakamiSora/subshell`。

先不签名也能发：产物会作为「未签名包」上传，只是用户首次运行会被系统拦截一次。

## 2. Windows 代码签名

### 2.1 需要什么

一张 **代码签名证书**（Code Signing Certificate），二选一：

| 类型 | 说明 | 大致成本 |
| --- | --- | --- |
| OV（组织验证） | 最常见的普通代码签名证书，私钥可导出为 `.pfx` | 约 $200–400/年 |
| EV（扩展验证） | 立即获得 SmartScreen 信誉，但私钥通常锁在硬件 token 里 | 约 $400–700/年 |

CA 可选 DigiCert、Sectigo、GlobalSign、SSL.com、Certum 等。购买时需要完成组织/个人身份验证，
通常 1–5 个工作日。**自签名证书不解决问题**：它不会被 SmartScreen 认可，用户看到的提示是一样的。

### 2.2 配置到仓库

拿到 `.pfx` 后，把它转成 base64 并写入 GitHub Secrets（用 `gh` 最省事）：

```powershell
# Windows PowerShell：转 base64 并直接写入 Secret
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\certs\subshell.pfx"))
$b64 | gh secret set CSC_LINK --repo ShirakamiSora/subshell
gh secret set CSC_KEY_PASSWORD --repo ShirakamiSora/subshell
```

```bash
# macOS / Linux
base64 -w0 cert.pfx | gh secret set CSC_LINK --repo ShirakamiSora/subshell
gh secret set CSC_KEY_PASSWORD --repo ShirakamiSora/subshell
```

`CSC_LINK` 也可以填一个只有 CI 能访问的 https 链接，效果相同。
`.github/workflows/release.yml` 已经把这些 Secrets 作为环境变量传给 electron-builder，
`electron-builder.yml` 里的 `win.signAndEditExecutable: true` 会让它对主程序与安装包签名。

### 2.3 EV 硬件 token 与云签名

EV 证书的私钥不能导出，无法直接塞进 GitHub Actions。两条路：

- **用 CA 的云签名服务**：DigiCert KeyLocker、SSL.com eSigner、Sectigo 云签名。它们提供
  HSM 中的签名接口，CI 里通过各自的工具或 `signtool` 的 `/csp` 参数调用；electron-builder
  需要用 `win.sign` 自定义签名函数替换默认的 signtool 调用。
- **Azure Trusted Signing**（更便宜，约 $9.99/月）：需要 Azure 订阅并通过身份验证，
  对组织成立年限和可验证信息有要求（个人开发者的资格限制以官方文档为准）。
  它不产出 `.pfx`，而是走 `trusted-signing-action` 之类的步骤。

在买到证之前，建议先按 2.2 的 OV 路线走，配置最简单。

### 2.4 验证

```powershell
Get-AuthenticodeSignature .\release\Subshell-Setup-0.3.0.exe | Format-List Status, SignerCertificate
# 期望 Status = Valid，SignerCertificate.Subject 是你的公司/个人名

signtool verify /pa /v .\release\Subshell-Setup-0.3.0.exe
```

SmartScreen 信誉：EV 立即生效；OV 需要累积下载量，刚发布时仍可能提示，通常几天到几周后消失。

## 3. macOS 签名与公证

### 3.1 需要什么

- **Apple Developer Program** 会员（$99/年），个人或公司账号都可以。
- 一张 **Developer ID Application** 证书（不是 App Store 分发证书）。

### 3.2 创建并导出证书

1. 在 [developer.apple.com](https://developer.apple.com/account/resources/certificates) 创建
   **Developer ID Application** 证书，下载 `.cer` 并双击导入钥匙串。
2. 钥匙串访问 → 找到该证书 → 右键「导出…」→ 格式选 `.p12`，设置一个导出密码。
3. 转 base64 写入 Secrets：

```bash
base64 -w0 developer-id.p12 | gh secret set CSC_LINK --repo ShirakamiSora/subshell
gh secret set CSC_KEY_PASSWORD --repo ShirakamiSora/subshell
```

### 3.3 公证凭据

electron-builder 26 用 `notarytool` 公证，凭据二选一：

**方式 A：Apple ID（当前 workflow 已支持，配置最少）**

```bash
gh secret set APPLE_ID --repo ShirakamiSora/subshell                 # Apple 账号邮箱
gh secret set APPLE_APP_SPECIFIC_PASSWORD --repo ShirakamiSora/subshell  # appleid.apple.com 生成的 App 专用密码
gh secret set APPLE_TEAM_ID --repo ShirakamiSora/subshell            # 开发者账号的 Team ID（10 位）
```

**方式 B：App Store Connect API Key（更稳，不受二次验证影响）**

在 App Store Connect → 用户和访问 → 密钥 → 生成 App 管理密钥，下载 `.p8`（只能下载一次），记下 Key ID 与 Issuer ID。
这种方式需要在 workflow 里先把 Secret 还原成文件，再告诉 electron-builder 路径：

```yaml
- name: Prepare notarization key
  if: matrix.target == 'mac'
  run: |
    mkdir -p "$RUNNER_TEMP/keys"
    printf '%s' "$APPLE_API_KEY_P8" | base64 --decode > "$RUNNER_TEMP/keys/AuthKey.p8"
    echo "APPLE_API_KEY=$RUNNER_TEMP/keys/AuthKey.p8" >> "$GITHUB_ENV"
    echo "APPLE_API_KEY_ID=$APPLE_API_KEY_ID" >> "$GITHUB_ENV"
    echo "APPLE_API_ISSUER=$APPLE_API_ISSUER" >> "$GITHUB_ENV"
  env:
    APPLE_API_KEY_P8: ${{ secrets.APPLE_API_KEY_P8 }}
    APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
    APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
```

### 3.4 打开公证开关

凭据就绪后，把 `electron-builder.yml` 里的：

```yaml
  notarize: false
```

改为：

```yaml
  notarize: true
```

公证失败会让构建中断——这比发布一个用户打不开的包要好。

`build/entitlements.mac.plist` 已包含 Electron 必需的 JIT、未签名可执行内存与库校验豁免，
不要删减，否则签名后应用会启动即崩溃。

### 3.5 验证

```bash
codesign --verify --deep --strict --verbose=2 "Subshell.app"
spctl --assess --type execute --verbose=4 "Subshell.app"    # 期望 accepted
xcrun stapler validate Subshell-0.3.0-arm64.dmg             # 期望 stapler: OK
```

## 4. 更新检查

应用内「设置 → 关于」会读取 GitHub Releases 的最新 tag，启动后也会自动检查一次（可在设置关闭）。

- 仓库：`ShirakamiSora/subshell`（见 `src/main/update/service.ts` 的 `REPO`）。
- 可用环境变量 `SUBSHELL_UPDATE_REPO=owner/repo` 覆盖，便于本地验证。
- 检查只查询版本号，不上报任何数据。

当前实现是「检查 → 提示 → 打开下载页」。要做到下载并静默安装，需要：

1. 完成上述签名（未签名的自动更新会被系统拦截）；
2. 引入 `electron-updater`，在主进程调用 `autoUpdater.checkForUpdatesAndNotify()`；
3. `publish` 配置会生成 `latest.yml`，electron-updater 依赖它判断版本。

在没有证书前，不要开启静默更新。

## 5. 本地打包

```bash
npm run dist:win   # Windows 便携版
npm run dist:dir   # 只解包不生成安装器，便于检查 asar 内容
```

产物在 `release/`。打包前请确认 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 全部通过。
