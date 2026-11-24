import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

if (process.env.FINALPOWERSHELL_E2E !== "1") {
  throw new Error("请仅在 FINALPOWERSHELL_E2E=1 的隔离测试环境中运行");
}
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const context = browser.contexts()[0];
const page = context.pages().find(item => item.url().includes("localhost:1420"));
if (!page) throw new Error("没有找到隔离测试窗口");

async function dragPanel(resizerSelector, panelSelector, distance) {
  const locator = page.locator(resizerSelector);
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error(`找不到拖动条 ${resizerSelector}`);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + 140;
  await page.mouse.move(x, y);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.waitForTimeout(200);
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(x + distance * step / 8, y);
    await page.waitForTimeout(80);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
  const result = await locator.boundingBox();
  if (!result || Math.abs(result.x - bounds.x - distance) > 8) {
    throw new Error(`面板拖动失败 ${panelSelector}: ${JSON.stringify({ bounds, result, distance, style: await page.locator(panelSelector).getAttribute("style") })}`);
  }
}

await mkdir(".preview-data/e2e-results", { recursive: true });
await page.reload();
await page.locator(".connection-open").waitFor();
await page.locator(".connection-open").click();
await page.waitForFunction(() => document.querySelectorAll(".terminal-host:not(.hidden)").length > 0, { timeout: 15000 });
if (await page.locator("#connect-dialog").isVisible()) throw new Error("已信任服务器仍然要求重复确认");
console.log("PASS 已信任服务器一键连接");
await page.waitForFunction(() => (document.querySelector(".terminal-host:not(.hidden) .xterm-rows")?.textContent ?? "").replaceAll("\n", "").replaceAll(" ", "").includes("local-test-shell"), { timeout: 15000 });

await page.locator(".terminal-host:visible").click();
await page.keyboard.type("ping");
await page.waitForFunction(() => {
  const output = document.querySelector(".terminal-host:not(.hidden) .xterm-rows")?.textContent ?? "";
  return ["p", "i", "n", "g"].every(character => output.includes(`echo: ${character}`));
}, { timeout: 10000 });
console.log("PASS 终端输入和回显");

if (!(await page.locator("#files-panel").isVisible())) await page.locator("#toggle-files").click();
await page.locator("#files-panel .file-name").filter({ hasText: "docs" }).waitFor({ timeout: 15000 });
console.log("PASS 文件列表读取");

await page.locator("#files-panel .file-row").filter({ hasText: "notes.txt" }).click({ button: "right" });
await page.locator('[data-action="edit"]').click();
await page.locator("#file-editor").waitFor({ state: "visible" });
await page.locator("#file-editor").fill("edited through automated UI");
await page.locator("#save-remote-file").click();
await page.locator("#editor-dialog").waitFor({ state: "hidden" });
await page.locator("#files-panel .file-row").filter({ hasText: "notes.txt" }).click({ button: "right" });
await page.locator('[data-action="view"]').click();
if (await page.locator("#file-editor").inputValue() !== "edited through automated UI") {
  throw new Error("远程文件保存后重新读取内容不一致");
}
await page.locator(".close-editor").first().click();
console.log("PASS 右键快速查看、编辑和保存");

const uploadPath = resolve(".preview-data/e2e-results/drag-upload.txt");
await writeFile(uploadPath, "uploaded through native drag and drop");
const dropPoint = await page.locator("#files-panel .file-list").boundingBox();
if (!dropPoint) throw new Error("找不到文件拖放区域");
await page.evaluate(async ({ path, x, y }) => {
  const { invoke } = await import("/node_modules/@tauri-apps/api/core.js");
  await invoke("e2e_drag_drop", { paths: [path], x, y });
}, { path: uploadPath, x: (dropPoint.x + 40) * await page.evaluate(() => devicePixelRatio), y: (dropPoint.y + 220) * await page.evaluate(() => devicePixelRatio) });
await page.locator("#files-panel .file-row").filter({ hasText: "drag-upload.txt" }).waitFor({ timeout: 15000 });
await page.locator("#files-panel .file-row").filter({ hasText: "drag-upload.txt" }).click({ button: "right" });
await page.locator('[data-action="view"]').click();
await page.locator("#editor-dialog").waitFor({ state: "visible" });
await page.waitForFunction(() => document.querySelector("#file-editor").value === "uploaded through native drag and drop");
if (await page.locator("#file-editor").inputValue() !== "uploaded through native drag and drop") {
  throw new Error("拖放上传后文件内容不一致");
}
await page.locator(".close-editor").first().click();
console.log("PASS Windows 文件拖放上传与重新读取");

await page.locator("#toggle-files").click();
if (await page.locator("#files-panel").isVisible()) throw new Error("文件面板未能隐藏");
await page.locator("#toggle-files").click();
console.log("PASS 文件面板隐藏和恢复");
if (!(await page.locator("#files-panel").isVisible())) await page.locator("#toggle-files").click();
await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const filePanel = await page.locator("#files-panel").boundingBox();
if (filePanel) {
  const resizer = await page.locator("#files-resizer").boundingBox();
  if (!resizer) throw new Error("找不到文件面板拖动条");
  const terminalBefore = await page.locator("#terminal-panel").boundingBox();
  if (!terminalBefore) throw new Error("找不到终端区域");
  const dragDistance = Math.min(70, Math.max(0, terminalBefore.width - 310));
  if (dragDistance < 15) throw new Error("测试窗口的终端空间不足，无法验证文件面板调宽");
  await dragPanel("#files-resizer", "#files-panel", -dragDistance);
  const resizedResizer = await page.locator("#files-resizer").boundingBox();
  if (!resizedResizer || resizedResizer.x >= resizer.x - 10) throw new Error("文件面板拖动调宽无效");
  const terminal = await page.locator("#terminal-panel").boundingBox();
  if (!terminal || terminal.width < 290) throw new Error("文件面板拖动后终端空间不足");
}
console.log("PASS 文件面板拖动调宽");

await page.locator(".metric-card").filter({ hasText: "内存" }).waitFor({ timeout: 20000 });
const metrics = await page.locator("#metrics-content").innerText();
if (!metrics.includes("75.0%")) throw new Error(`资源数据不正确: ${metrics}`);
for (const text of ["交换", "进程", "挂载点", "server"]) {
  if (!metrics.includes(text)) throw new Error(`资源面板缺少 ${text}`);
}
console.log("PASS 交换分区、进程和挂载点展示");
console.log("PASS 服务器资源读取");
await page.waitForTimeout(4500);
if (await page.locator("#metrics-content .metric-card").count() < 4) {
  throw new Error("连续刷新后资源卡片消失");
}
const firstUpdate = await page.locator(".metrics-updated").innerText();
await page.waitForFunction(previous => document.querySelector(".metrics-updated")?.textContent !== previous, firstUpdate, { timeout: 10000 });
console.log("PASS 资源数据连续刷新且不会消失");
await page.locator(".metrics-refresh-error").waitFor({ timeout: 20000 });
if (!(await page.locator("#metrics-content").innerText()).includes("75.0%")) {
  throw new Error("刷新失败后已有资源数据被清空");
}
await page.waitForFunction(() => !document.querySelector(".metrics-refresh-error"), { timeout: 20000 });
if (!(await page.locator("#metrics-content").innerText()).includes("75.0%")) {
  throw new Error("自动重试后资源数据未恢复");
}
console.log("PASS 刷新失败保留数据并自动恢复");

await page.locator("#toggle-metrics").click();
if (await page.locator("#metrics-panel").isVisible()) throw new Error("资源面板未能隐藏");
await page.locator("#toggle-metrics").click();
console.log("PASS 资源面板隐藏和恢复");

const metricsPanel = await page.locator("#metrics-panel").boundingBox();
if (metricsPanel) {
  const resizer = await page.locator("#metrics-resizer").boundingBox();
  if (!resizer) throw new Error("找不到资源面板拖动条");
  const terminalBefore = await page.locator("#terminal-panel").boundingBox();
  if (!terminalBefore) throw new Error("找不到终端区域");
  const dragDistance = Math.min(45, Math.max(0, terminalBefore.width - 310));
  if (dragDistance < 5) throw new Error("测试窗口的终端空间不足，无法验证资源面板调宽");
  await dragPanel("#metrics-resizer", "#metrics-panel", dragDistance);
  const resizedResizer = await page.locator("#metrics-resizer").boundingBox();
  if (!resizedResizer || resizedResizer.x <= resizer.x + 2) throw new Error("资源面板拖动调宽无效");
  const terminalAfter = await page.locator("#terminal-panel").boundingBox();
  if (!terminalAfter || terminalAfter.width < 290) throw new Error("资源面板拖动后终端空间不足");
}
console.log("PASS 资源面板拖动调宽");

await page.screenshot({ path: ".preview-data/e2e-results/connected.png" });
await page.locator("#add-connection").click();
await page.locator("#connection-dialog").waitFor({ state: "visible" });
await page.screenshot({ path: ".preview-data/e2e-results/connection-form.png" });
await page.locator("#connection-dialog .close-dialog").first().click();
console.log("PASS 新建连接表单展示");
console.log("PASS 界面自动化全部通过");
await browser.close();
