"""Capture the six review screenshots from the deployed Orbita application."""
from pathlib import Path
import tempfile

from PIL import Image
from playwright.sync_api import Page, sync_playwright


BASE = "https://example.org"
OUT = Path(__file__).resolve().parents[1] / "docs" / "assets" / "screens"


def settle(page: Page) -> None:
    page.wait_for_load_state("networkidle", timeout=60_000)
    page.wait_for_timeout(2_000)


def shot(page: Page, name: str) -> None:
    settle(page)
    # Playwright's screenshot encoder supports PNG/JPEG; convert to WebP here
    # so the committed artefacts stay compact and match the review brief.
    png = OUT / f".{name}.png"
    page.screenshot(path=str(png), type="png")
    with Image.open(png) as image:
        resized = image.convert("RGB").resize((1440, 900), Image.Resampling.LANCZOS)
        resized.save(OUT / name, "WEBP", quality=82, method=6)
    png.unlink(missing_ok=True)


def close_tour(page: Page) -> None:
    for label in ("\u041f\u0440\u043e\u043f\u0443\u0441\u0442\u0438\u0442\u044c", "\u0417\u0430\u0430\u043a\u0440\u044b\u0442\u044c", "\u00d7"):
        button = page.get_by_role("button", name=label, exact=False)
        if button.count():
            try:
                button.first.click(timeout=1_000)
                return
            except Exception:
                pass


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1600, "height": 1000}, device_scale_factor=2)
        page = context.new_page()
        page.goto(f"{BASE}/projects", wait_until="domcontentloaded")
        close_tour(page)
        shot(page, "01-projects.webp")

        # Pick the canonical fixture and create its project.
        page.locator("button").filter(has_text="01_full_constellation.json").first.click()
        page.locator("button").filter(has_text="\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u0440\u043e\u0435\u043a\u0442").first.click()
        page.wait_for_url("**/network/**", timeout=60_000)
        project_id = page.url.rstrip("/").split("/")[-1].split("?")[0]
        shot(page, "02-network.webp")

        # The run is started from the network screen; wait for the result URL/state.
        run_button = page.locator("button").filter(has_text="\u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0440\u0430\u0441\u0447\u0451\u0442")
        if run_button.count():
            run_button.click()
            page.wait_for_timeout(1_000)
            if page.locator("button").filter(has_text="\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0432\u0430\u0440\u0438\u0430\u043d\u0442").count():
                page.locator("button").filter(has_text="\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0432\u0430\u0440\u0438\u0430\u043d\u0442").first.click()
        page.wait_for_timeout(2_000)
        shot(page, "03-outages.webp") if False else None

        page.goto(f"{BASE}/outages/{project_id}", wait_until="domcontentloaded")
        close_tour(page)
        shot(page, "03-outages.webp")

        page.goto(f"{BASE}/comparison?project={project_id}", wait_until="domcontentloaded")
        close_tour(page)
        shot(page, "04-comparison.webp")

        # Use the first result link exposed by the application when available.
        result_link = page.locator('a[href*="/result/"]').first
        if result_link.count():
            result_url = result_link.get_attribute("href")
            if result_url:
                page.goto(f"{BASE}{result_url}", wait_until="domcontentloaded")
        shot(page, "05-result.webp")

        # Invalid JSON exercises the real validation error modal.
        page.goto(f"{BASE}/projects", wait_until="domcontentloaded")
        close_tour(page)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as bad:
            bad.write('{"meta": {"title": 7}, "environment": {}}')
            bad_path = bad.name
        with page.expect_file_chooser() as chooser_info:
            page.locator("button").filter(has_text="\u0412\u044b\u0431\u0440\u0430\u0442\u044c JSON").first.click()
        chooser_info.value.set_files(bad_path)
        page.wait_for_timeout(3_000)
        shot(page, "06-validation.webp")
        browser.close()


if __name__ == "__main__":
    main()
