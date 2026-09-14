"""Скриншоты интерфейса для README с локально поднятого стека.

    make up
    python scripts/capture_screens.py            # http://localhost:3000
    python scripts/capture_screens.py --base http://127.0.0.1:5173

Данные заводятся через API тем же путём, что и в интерфейсе: проект из сценария кейса,
три расчёта с разными политиками маршрутизации и небольшой перебор конфигураций.
Поэтому снимки воспроизводимы на чистом стеке и показывают настоящие числа, а не
мокапы.

Нужен Playwright для Python: `pip install playwright && playwright install chromium`.
"""

from __future__ import annotations

import argparse
import io
import json
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image
from playwright.sync_api import Browser, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "assets" / "screens"
SCENARIO = ROOT / "scenarios" / "01_full_constellation.json"
POLICIES = ("bfs_shortest", "persistent", "dijkstra_distance")

DESKTOP = {"width": 1920, "height": 1080}
PHONE = {"width": 390, "height": 844}

# Глобус рендерится программно: без аппаратного GPU в headless-режиме WebGL не поднимется.
CHROMIUM_ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"]


@dataclass(frozen=True)
class Seed:
    project_id: str
    run_ids: tuple[str, ...]
    failure_variant_id: str
    experiment_id: str


def call(api: str, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        api + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data is not None else {},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        raw = response.read()
    return json.loads(raw) if raw else None


def wait_run(api: str, run_id: str) -> None:
    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        status = call(api, "GET", f"/runs/{run_id}")["status"]
        if status == "succeeded":
            return
        if status in ("failed", "cancelled"):
            raise SystemExit(f"расчёт {run_id} завершился со статусом {status}")
        time.sleep(1)
    raise SystemExit(f"расчёт {run_id} не завершился за пять минут")


def wait_experiment(api: str, experiment_id: str) -> None:
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        status = call(api, "GET", f"/experiments/{experiment_id}")["status"]
        if status not in ("queued", "running"):
            return
        time.sleep(2)
    raise SystemExit(f"эксперимент {experiment_id} не завершился за десять минут")


def seed(api: str) -> Seed:
    scenario = json.loads(SCENARIO.read_text(encoding="utf-8"))
    project = call(api, "POST", "/projects", {"scenario": scenario})
    variant_id = call(api, "GET", f"/projects/{project['id']}")["variants"][0]["id"]

    run_ids: list[str] = []
    for policy in POLICIES:
        run = call(api, "POST", "/runs", {"variant_id": variant_id, "routing_policy": policy})
        wait_run(api, run["id"])
        run_ids.append(run["id"])

    # Отказ двух аппаратов с утра: на «Отказах» появляется что сравнивать.
    failed = dict(scenario)
    failed["failures"] = [
        {"satellite_id": "S09", "start_s": 18_000, "end_s": 32_400},
        {"satellite_id": "S39", "start_s": 19_800, "end_s": 26_000},
    ]
    variant = call(
        api,
        "POST",
        f"/projects/{project['id']}/variants",
        {"title": "Отказ S09 и S39", "scenario": failed, "parent_variant_id": variant_id},
    )
    failure_run = call(api, "POST", "/runs", {"variant_id": variant["id"], "routing_policy": "bfs_shortest"})
    wait_run(api, failure_run["id"])

    # Небольшой перебор фазирования второй плоскости: тепловая карта 3×3.
    experiment = call(
        api,
        "POST",
        "/experiments",
        {
            "variant_id": variant_id,
            "axes": [
                {"path": "design.planes[1].raan_deg", "from": 40, "to": 80, "step": 20},
                {"path": "design.planes[1].phase_deg", "from": 0, "to": 10, "step": 5},
            ],
            "budget": {"max_points": 10, "max_seconds": 600},
        },
    )
    wait_experiment(api, experiment["id"])

    return Seed(
        project_id=project["id"],
        run_ids=tuple(run_ids),
        failure_variant_id=variant["id"],
        experiment_id=experiment["id"],
    )


def new_page(browser: Browser, viewport: dict[str, int], theme: str, scale: float) -> Page:
    context = browser.new_context(viewport=viewport, device_scale_factor=scale)
    # Тур онбординга закрыл бы экран, а тема хранится там же, где её оставляет переключатель.
    context.add_init_script(
        f"localStorage.setItem('orbita.onboarding.completed.v1', '1');"
        f"localStorage.setItem('orbita.theme', '{theme}');"
    )
    return context.new_page()


def save(page: Page, name: str) -> None:
    page.wait_for_load_state("networkidle", timeout=90_000)
    page.wait_for_timeout(2_500)
    png = page.screenshot(type="png")
    with Image.open(io.BytesIO(png)) as image:
        image.convert("RGB").save(OUT / name, "WEBP", quality=86, method=6)
    print(f"  {name}")


def open_map_mode(page: Page, label: str) -> None:
    button = page.get_by_role("button", name=label, exact=True)
    if button.count():
        button.first.click()
        page.wait_for_timeout(3_000)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", default="http://localhost:3000")
    parser.add_argument("--api", default="http://localhost:8000/api")
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    data = seed(args.api)
    project, runs = data.project_id, data.run_ids
    compare = f"/comparison?project={project}&runs={','.join(runs)}"
    network = f"/network/{project}?run={runs[0]}&t=21600"
    outages = f"/outages/{project}?run={runs[0]}&variant={data.failure_variant_id}"
    experiments = f"/experiments/{project}?experiment={data.experiment_id}"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=CHROMIUM_ARGS)

        desktop = [
            ("01-projects.webp", "/projects", None),
            ("02-network-globe.webp", network, "3D"),
            ("03-network-scheme.webp", network, "2D"),
            ("04-outages.webp", outages, "3D"),
            ("05-experiments.webp", experiments, None),
            ("06-comparison.webp", compare, None),
            ("07-result.webp", f"/result/{runs[0]}", None),
        ]
        for name, route, mode in desktop:
            page = new_page(browser, DESKTOP, "dark", 1)
            page.goto(args.base + route, wait_until="domcontentloaded")
            if mode is not None:
                page.wait_for_load_state("networkidle", timeout=90_000)
                open_map_mode(page, mode)
            save(page, name)
            page.context.close()

        page = new_page(browser, DESKTOP, "light", 1)
        page.goto(args.base + network, wait_until="domcontentloaded")
        save(page, "08-network-light.webp")
        page.context.close()

        phone = [
            ("09-phone-network.webp", network),
            ("10-phone-outages.webp", outages),
            ("11-phone-result.webp", f"/result/{runs[0]}"),
        ]
        for name, route in phone:
            page = new_page(browser, PHONE, "dark", 3)
            page.goto(args.base + route, wait_until="domcontentloaded")
            save(page, name)
            page.context.close()

        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
