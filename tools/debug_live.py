"""Quick live debugger — open the deployed app, collect console errors, screenshot."""
import asyncio
from playwright.async_api import async_playwright

URL = "https://lalien.comesspa.it/"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        c = await b.new_context(viewport={"width": 480, "height": 860}, device_scale_factor=2)
        page = await c.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(("pageerror", str(e))))
        page.on("console", lambda m: errors.append((m.type, m.text)) if m.type in ("error","warning") else None)
        await page.goto(URL, wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(4000)
        try:
            await page.click("#btn-login-offline", timeout=5000)
        except Exception: pass
        await page.wait_for_timeout(3000)
        await page.screenshot(path="tools/debug_live.png")
        print("Errors/warnings:")
        for t, m in errors:
            print(f"  [{t}] {m[:300]}")
        await b.close()

asyncio.run(main())
