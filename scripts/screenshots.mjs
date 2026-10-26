// Screenshots of the main pages and flows, for review and the portfolio.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const base = process.env.BASE ?? "http://127.0.0.1:5173";
const homes = JSON.parse(readFileSync("public/data/homes.json", "utf8"));
const sample = homes.find((h) => h.b === "I" && h.t === "F" && h.m2 && h.v === "below") ?? homes[0];
mkdirSync("shots", { recursive: true });
const browser = await chromium.launch();

async function shoot(page, name, full = true) {
  await page.addStyleTag({ content: "[class*='tsqd'],[class*='TanStackRouterDevtools'],#tanstack-devtools{display:none!important}" });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `shots/${name}.png`, fullPage: full });
  console.log("::notice::captured " + name);
}

const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
desk.on("pageerror", (e) => console.log("::warning::page error " + String(e).slice(0, 200)));
await desk.goto(base + "/", { waitUntil: "networkidle", timeout: 180_000 });
await desk.waitForSelector("text=homes", { timeout: 120_000 });
await shoot(desk, "01-find-a-home", false);
await desk.getByRole("button", { name: "Near LSE" }).click();
await shoot(desk, "02-near-lse", false);
await desk.goto(`${base}/home/${sample.id}`, { waitUntil: "networkidle", timeout: 120_000 });
await desk.waitForSelector("text=Fair value estimate", { timeout: 120_000 });
await shoot(desk, "03-home");
await desk.goto(base + "/check", { waitUntil: "networkidle" });
await desk.fill("#pc", sample.pc);
await desk.fill("#price", String(Math.round(sample.f * 1.12 / 1000) * 1000));
if (await desk.$("#area")) await desk.fill("#area", String(sample.m2 ?? 60));
await desk.getByRole("button", { name: "Check the price" }).click();
await desk.waitForSelector("text=Fair value estimate", { timeout: 60_000 }).catch(() => {});
await shoot(desk, "04-check");
await desk.goto(base + "/method", { waitUntil: "networkidle" });
await shoot(desk, "05-method");

const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await phone.goto(`${base}/home/${sample.id}`, { waitUntil: "networkidle", timeout: 120_000 });
await phone.waitForSelector("text=Fair value estimate", { timeout: 120_000 });
await shoot(phone, "06-home-phone", false);
await browser.close();
