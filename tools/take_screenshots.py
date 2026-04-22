"""
take_screenshots.py — Automated screenshot generator for Lalien Companion.

Drives the live PWA through Playwright, forces specific pet states
(stage, weather, activity, time-of-day), and captures the canvas at a
high-quality resolution.

Run:
    pip install playwright && python -m playwright install chromium
    python tools/take_screenshots.py
"""

from __future__ import annotations
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright, Page

URL = "https://lalien.comesspa.it/"
OUT = Path(__file__).resolve().parents[1] / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

VIEWPORT = {"width": 480, "height": 860}   # phone-ish portrait
DPR = 3                                    # high-DPI crispness


JS_SETUP = r"""
(async () => {
    // Wait for Pet module to exist
    for (let i = 0; i < 80 && (!window.__modulesReady); i++) {
        await new Promise(r => setTimeout(r, 150));
        // probe: window.Pet may live as ES module, exposed on window.__lalien_debug?
        if (window.Pet) break;
    }
    return !!window.Pet;
})()
"""


async def bypass_login(page: Page):
    """Walk the onboarding setup with a dummy API key (never used — we'll
    override all LLM calls anyway) to reach the live game canvas."""
    async def click_when(sel, timeout=6000):
        await page.wait_for_selector(sel, state="visible", timeout=timeout)
        await page.click(sel)
        await page.wait_for_timeout(450)

    async def fill_when(sel, value, timeout=6000):
        await page.wait_for_selector(sel, state="visible", timeout=timeout)
        await page.fill(sel, value)
        await page.wait_for_timeout(250)

    # Login screen first — offline mode
    try:
        await click_when("#btn-login-offline", timeout=8000)
    except Exception:
        pass
    # Step 0 — welcome
    await click_when("#btn-setup-start")
    # Step 1 — language (Italian)
    await click_when("button[data-lang='it']")
    # Step 2 — provider + fake key
    await click_when("button[data-provider='openai']")
    await fill_when("#setup-api-key", "sk-screenshot-dummy-not-used")
    await click_when("#btn-setup-next")
    # Step 3 — pet name + plant
    await fill_when("#setup-pet-name", "Thishi-Vox")
    await click_when("#btn-setup-plant")
    # Canvas should now be the main view
    await page.wait_for_selector("#game-canvas", state="visible", timeout=10000)
    await page.wait_for_timeout(3000)


async def force_state(page: Page, *, stage: int = 3, weather: str = "clear", clouds: int = 10,
                     hour: int | None = None, activity: str | None = None,
                     bubble: str | None = None, minigame: str | None = None,
                     pet_name: str = "Thishi-Vox"):
    """Inject pet/weather/time state via debug hooks. Falls back gracefully
    if hooks don't exist — we use page.evaluate to set module exports via
    the global registry that game-loop.js sets up."""
    js = f"""
    (async () => {{
        // The app modules are ES-module scoped, so we reach them via the
        // debug surface. game-loop exposes nothing by default — we poke at
        // DOM + computed state the only way that's safe: import the modules.
        const mod = await import('/js/pet/pet.js');
        const Weather = (await import('/js/engine/weather.js')).Weather;
        const Activity = (await import('/js/pet/activity.js')).Activity;
        const Pet = mod.Pet;
        Pet.name = {pet_name!r};
        Pet.stage = {stage};
        Pet.ageSeconds = Math.max(Pet.ageSeconds, {stage} * 3 * 86400);
        // top up all needs
        const Needs = (await import('/js/pet/needs.js'));
        for (const k of Object.keys(Pet.needs)) Pet.needs[k] = 85 + Math.random() * 12;
        // Force weather by monkey-patching Weather.get() (the module-scoped
        // _state is not exported, so we replace the accessor directly).
        try {{
            const st = {{ condition: {weather!r}, clouds: {clouds}, temp: 20, humidity: 60,
                          wind: 2, description: {weather!r}, location: 'Screenshot',
                          feels_like: 18, pressure: 1015, sunrise: Date.now() - 4*3600*1000,
                          sunset:  Date.now() + 6*3600*1000 }};
            Weather.get       = () => st;
            Weather.isRaining = () => (st.condition === 'rain' || st.condition === 'thunder');
            Weather.isSnowing = () => st.condition === 'snow';
            Weather.isCloudy  = () => (st.condition === 'clouds' || st.clouds > 60);
            Weather.isThunder = () => st.condition === 'thunder';
        }} catch(e) {{ console.warn('weather force failed', e); }}
        // Force hour if requested — overrides Date for the renderer read
        {"" if hour is None else f'''
        const origNow = Date.now;
        const target = new Date();
        target.setHours({hour}, 10, 0, 0);
        const delta = target.getTime() - origNow();
        Date.now = () => origNow() + delta;
        const OrigDate = Date;
        window.Date = class extends OrigDate {{
            constructor(...a) {{ if (a.length === 0) super(origNow() + delta); else super(...a); }}
            static now() {{ return origNow() + delta; }}
        }};
        '''}
        {"" if activity is None else f'''
        try {{ Activity.start(Pet, Activity.Type.{activity}); }} catch(e) {{ console.warn(e); }}
        '''}
        // Always clear any lingering speech bubble from the prior scene,
        // then show this scene's bubble if specified.
        try {{
            const SB = (await import('/js/ui/speech-bubble.js')).SpeechBubble;
            SB.hide && SB.hide();
        }} catch(e) {{}}
        {"" if bubble is None else f'''
        try {{
            const SB = (await import('/js/ui/speech-bubble.js')).SpeechBubble;
            SB.show({bubble!r}, 'happy', 120000);
        }} catch(e) {{ console.warn('bubble failed', e); }}
        '''}
        {"" if minigame is None else f'''
        try {{
            const M = (await import('/js/pet/minigames.js')).MiniGames;
            const Screens = (await import('/js/ui/screens.js')).Screens;
            M.startGame(M.GameType.{minigame});
            Screens.show('minigame');
        }} catch(e) {{ console.warn('minigame failed', e); }}
        '''}
        // Trigger a state repaint
        window.dispatchEvent(new Event('resize'));
        return true;
    }})()
    """
    try:
        await page.evaluate(js)
    except Exception as e:
        print(f"  ! force_state failed: {e}")
    await page.wait_for_timeout(2000)   # let renderer catch up


HIDE_JS = """
(() => {
    const ids = ['chat-bar','action-bar','needs-overlay','debug-panel',
                 'btn-status-settings'];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.style.setProperty('display','none','important');
    }
    document.querySelectorAll('.toast').forEach(t => t.style.display='none');
    // Canvas fills the remaining viewport for a cleaner shot.
    const c = document.getElementById('game-canvas');
    if (c) { c.style.height = 'calc(100vh - 40px)'; }
})();
"""


async def snap(page: Page, name: str, hide_chrome: bool = True):
    target = OUT / name
    if hide_chrome:
        await page.evaluate(HIDE_JS)
        await page.wait_for_timeout(300)
        # Force a re-render after the canvas resize
        await page.evaluate("window.dispatchEvent(new Event('resize'))")
        await page.wait_for_timeout(700)
    await page.screenshot(path=str(target), full_page=False, omit_background=False)
    print(f"  OK {target.name}")


SCENES = [
    dict(file="01-lali-na-dawn.png",         stage=1, weather="clear",  clouds=10, hour=6,
         activity=None, bubble=None, minigame=None,
         label="Lali-na at dawn — first hours of life"),
    dict(file="02-lali-ko-sunny-chat.png",   stage=3, weather="clear",  clouds=15, hour=12,
         activity=None, bubble="ko! nashi-thi, custode... ven-thi!", minigame=None,
         label="Lali-ko chatting on a sunny noon"),
    dict(file="03-lali-ren-sunset.png",      stage=4, weather="clouds", clouds=45, hour=19,
         activity=None, bubble=None, minigame=None,
         label="Lali-ren at sunset with broken clouds"),
    dict(file="04-lali-vox-rain.png",        stage=5, weather="rain",   clouds=95, hour=15,
         activity=None, bubble=None, minigame=None,
         label="Lali-vox in the rain — veiled sun behind the drops"),
    dict(file="05-lali-mere-night-moon.png", stage=6, weather="clear",  clouds=10, hour=23,
         activity=None, bubble=None, minigame=None,
         label="Lali-mere at night under the moon"),
    dict(file="06-lali-thishi-dream.png",    stage=7, weather="clear",  clouds=20, hour=2,
         activity="SLEEPING", bubble=None, minigame=None,
         label="Lali-thishi dreaming — transcendent"),
]


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport=VIEWPORT, device_scale_factor=DPR)
        page = await context.new_page()
        print(f"-> opening {URL}")
        await page.goto(URL, wait_until="networkidle", timeout=30000)
        await bypass_login(page)

        for scene in SCENES:
            print(f"-> {scene['label']}")
            await force_state(page,
                              stage=scene["stage"],
                              weather=scene["weather"],
                              clouds=scene["clouds"],
                              hour=scene["hour"],
                              activity=scene["activity"],
                              bubble=scene.get("bubble"),
                              minigame=scene.get("minigame"))
            await page.wait_for_timeout(1500)
            await snap(page, scene["file"])

        await browser.close()
        print("done.")


if __name__ == "__main__":
    asyncio.run(main())
