"""Запись ответов API для демо на GitHub Pages.

    make up
    python scripts/record_demo.py                  # веб http://localhost:3000, api :8000
    cd web && npx vite build --mode demo           # dist/ с записью внутри

Данные заводятся тем же `seed()`, что и для скриншотов README: проект из сценария кейса,
три политики маршрутизации, вариант с отказом двух аппаратов и перебор 3×3. Затем
Playwright проходит экраны так, как их проходит пользователь, и сохраняет каждый ответ
`/api`, который запросил интерфейс. Что интерфейс запрашивает, решает он сам: скрипт не
знает списка endpoint и не устаревает вместе с экранами.

Отдельно дописывается сетка по времени: снимки сети и резервные пути клиентов на её
узлах. Воспроизведение суток запрашивает снимок на каждом из 720 отсчётов, и записывать их
все значило бы раздуть демо до сотни мегабайт; экран получает ближайший узел сетки
(`web/src/demo/replay.ts`).

Нужен Playwright для Python: `pip install playwright pillow && playwright install chromium`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import urllib.request
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from capture_screens import CHROMIUM_ARGS, DESKTOP, PHONE, Seed, call, seed
from playwright.sync_api import Page, Route, ViewportSize, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "demo-data"

# Должен совпадать с `RECORDING_FORMAT` в `web/src/demo/replay.ts`.
RECORDING_FORMAT = 1

# POST, которые только считают ответ по телу; список повторяет `READ_ONLY_POSTS` из
# `replay.ts`. Любой другой изменяющий запрос во время прохода — ошибка сценария записи:
# демо не должно зависеть от того, что проход что-то создал.
READ_ONLY_POSTS = frozenset(
    {"/api/comparisons", "/api/preview", "/api/analysis/criticality", "/api/scenarios/validate"}
)

# Сетка снимков. Снимок сети весит около 12,5 КБ, у расчёта 720 отсчётов. Четыре основных
# расчёта (три политики и вариант с отказом) пишутся через три отсчёта — шесть минут
# суток: 4 × 240 × 12,5 КБ ≈ 12 МБ, и при воспроизведении 1× аппараты сдвигаются раз в
# 0,75 с. Шаг в два отсчёта дал бы 18 МБ одних снимков. Прогоны перебора открываются
# только по ссылке из таблицы, им хватает двух часов: 9 × 12 × 12,5 КБ ≈ 1,4 МБ.
# Резервные пути (0,2 КБ на клиента) пишутся только на сетке основных расчётов. Вместе с
# остальными ответами демо занимает около 15 МБ, а Pages отдаёт их gzip-ом.
PRIMARY_STEP_TICKS = 3
SECONDARY_STEP_TICKS = 60
DATA_BUDGET_BYTES = 18 * 1024 * 1024

NETWORK_IDLE_MS = 90_000
SETTLE_MS = 1_200


@dataclass(frozen=True)
class Exchange:
    method: str
    path: str
    query: tuple[tuple[str, str], ...]
    body_sha256: str | None
    status: int
    body: bytes

    @property
    def key(self) -> str:
        search = "&".join(f"{name}={value}" for name, value in self.query)
        return f"{self.method} {self.path}?{search}#{self.body_sha256 or ''}"

    @property
    def file(self) -> str:
        return f"responses/{hashlib.sha256(self.key.encode()).hexdigest()[:24]}.json"


class _JsonNumber(str):
    """Число JSON в том написании, в каком его отправил браузер."""


def canonical_json(raw: str) -> str:
    """Канонический JSON тела, как `canonicalJson` в `replay.ts`.

    Числа не перечитываются во float: Python и JavaScript по-разному пишут, например,
    `1e-07` и `1e-7`, а тело запроса уже сериализовано `JSON.stringify` в клиенте, и
    исходное написание совпадает с тем, что получит браузер при воспроизведении.
    """
    return _canonical(json.loads(raw, parse_int=_JsonNumber, parse_float=_JsonNumber))


def _canonical(value: object) -> str:
    if isinstance(value, _JsonNumber):
        return str.__str__(value)
    if isinstance(value, dict):
        members = (
            f"{json.dumps(key, ensure_ascii=False)}:{_canonical(item)}"
            for key, item in sorted(value.items())
        )
        return "{" + ",".join(members) + "}"
    if isinstance(value, list):
        return "[" + ",".join(_canonical(item) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False)


def make_exchange(
    method: str, url: str, post_data: str | None, status: int, body: bytes
) -> Exchange:
    parts = urlsplit(url)
    digest = None
    if method == "POST" and post_data is not None:
        digest = hashlib.sha256(canonical_json(post_data).encode()).hexdigest()
    return Exchange(
        method=method,
        path=parts.path,
        query=tuple(sorted(parse_qsl(parts.query, keep_blank_values=True))),
        body_sha256=digest,
        status=status,
        body=body,
    )


class Recorder:
    def __init__(self) -> None:
        self.exchanges: dict[str, Exchange] = {}
        # Исключение из обработчика перехвата до скрипта не доходит, поэтому нарушения
        # копятся здесь, а запись падает после прохода.
        self.problems: list[str] = []

    def add(self, exchange: Exchange) -> None:
        if exchange.status >= 500:
            self.problems.append(f"{exchange.method} {exchange.path}: HTTP {exchange.status}")
            return
        # Первый ответ остаётся: повторы того же запроса за проход отдают те же данные.
        self.exchanges.setdefault(exchange.key, exchange)

    def intercept(self, route: Route) -> None:
        """Запросы `/api` проходят через запись, а не подслушиваются событием `response`.

        Тело ответа, прочитанное после события, браузер к тому времени мог уже выбросить —
        переход на следующий экран освобождает ресурсы прошлого. Перехват получает тело
        до того, как его увидит страница, поэтому ни один ответ не теряется.
        """
        request = route.request
        path = urlsplit(request.url).path
        # Шаблон перехвата ловит и модули dev-сервера вроде `/src/api/client.ts`. Поток
        # прогресса не заканчивается и не JSON; в демо он не открывается.
        if not path.startswith("/api/") or path.endswith("/events"):
            route.continue_()
            return
        method = request.method
        if method != "GET" and not (method == "POST" and path in READ_ONLY_POSTS):
            self.problems.append(f"проход изменил данные: {method} {path}")
            route.abort()
            return
        response = route.fetch()
        body = response.body()
        self.add(make_exchange(method, request.url, request.post_data, response.status, body))
        route.fulfill(response=response, body=body)

    def fetch(self, api_origin: str, path: str) -> None:
        with urllib.request.urlopen(api_origin + path, timeout=60) as response:
            body = response.read()
            status = response.status
        self.add(make_exchange("GET", api_origin + path, None, status, body))

    def write(self, out: Path) -> int:
        if out.exists():
            shutil.rmtree(out)
        (out / "responses").mkdir(parents=True)
        ordered = sorted(self.exchanges.values(), key=lambda item: item.key)
        size = 0
        for exchange in ordered:
            (out / exchange.file).write_bytes(exchange.body)
            size += len(exchange.body)
        index = {
            "format": RECORDING_FORMAT,
            "exchanges": [
                {
                    "method": item.method,
                    "path": item.path,
                    "query": [list(pair) for pair in item.query],
                    "body_sha256": item.body_sha256,
                    "status": item.status,
                    "file": item.file,
                }
                for item in ordered
            ],
        }
        text = json.dumps(index, ensure_ascii=False, separators=(",", ":"))
        (out / "index.json").write_text(text, encoding="utf-8")
        return size + len(text.encode())


@dataclass(frozen=True)
class Routes:
    project: str
    project_title: str
    runs: tuple[str, ...]
    failure_run: str
    network: str
    outages: str
    experiments: str
    comparison: str


def routes_for(api: str, data: Seed) -> Routes:
    detail = call(api, "GET", f"/projects/{data.project_id}")
    failure_run = next(
        run["id"]
        for run in detail["recent_runs"]
        if run["variant_id"] == data.failure_variant_id and run["status"] == "succeeded"
    )
    project, runs = data.project_id, data.run_ids
    return Routes(
        project=project,
        project_title=detail["project"]["title"],
        runs=runs,
        failure_run=failure_run,
        network=f"/network/{project}?run={runs[0]}&t=21600",
        outages=f"/outages/{project}?run={runs[0]}&variant={data.failure_variant_id}",
        experiments=f"/experiments/{project}?experiment={data.experiment_id}",
        comparison=f"/comparison?project={project}&runs={','.join(runs)}",
    )


Walk = Callable[[Page, str, Routes], None]


def settle(page: Page) -> None:
    page.wait_for_load_state("networkidle", timeout=NETWORK_IDLE_MS)
    page.wait_for_timeout(SETTLE_MS)


def open_route(page: Page, base: str, route: str) -> None:
    page.goto(base + route, wait_until="domcontentloaded")
    settle(page)


def click_and_settle(page: Page, name: str, *, exact: bool = True) -> None:
    button = page.get_by_role("button", name=name, exact=exact)
    if button.count() == 0:
        raise SystemExit(f"на {page.url} нет кнопки «{name}»")
    button.first.click()
    settle(page)


def play_timeline(page: Page, seconds: int) -> None:
    """Воспроизведение суток: интерфейс сам запрашивает снимки подряд, как у пользователя."""
    click_and_settle(page, "Воспроизвести")
    page.wait_for_timeout(seconds * 1_000)
    click_and_settle(page, "Пауза")


def walk_projects(page: Page, base: str, routes: Routes) -> None:
    open_route(page, base, "/projects")
    # Каждый пример проверяется сервисом при выборе: без записи проверки карточка сценария
    # в демо показала бы ошибку вместо обзора.
    cards = page.locator("button", has=page.locator("text=/\\.json$/"))
    for index in range(cards.count()):
        with page.expect_response(lambda response: "/api/scenarios/validate" in response.url):
            cards.nth(index).click()
        settle(page)
    open_route(page, base, f"/projects/{routes.project}")


def selection_walk(section: str) -> Walk:
    """Первый визит в раздел без проекта: экран выбора проекта, выбор открывает раздел."""

    def walk(page: Page, base: str, routes: Routes) -> None:
        open_route(page, base, section)
        page.get_by_role("link").filter(has_text=routes.project_title).first.click()
        settle(page)

    return walk


def walk_network(page: Page, base: str, routes: Routes) -> None:
    open_route(page, base, routes.network)
    click_and_settle(page, "2D")
    click_and_settle(page, "3D")
    page.wait_for_timeout(2_000)
    play_timeline(page, 4)
    click_and_settle(page, "Резервный маршрут", exact=False)
    for run in (*routes.runs[1:], routes.failure_run):
        open_route(page, base, f"/network/{routes.project}?run={run}")


def walk_outages(page: Page, base: str, routes: Routes) -> None:
    open_route(page, base, routes.outages)
    for mode in ("До", "Рядом", "После"):
        click_and_settle(page, mode)
    click_and_settle(page, "Рассчитать критичность")
    page.wait_for_timeout(3_000)
    settle(page)
    play_timeline(page, 3)


def walk_experiments(page: Page, base: str, routes: Routes) -> None:
    for action in ("Открыть", "Сравнить"):
        open_route(page, base, routes.experiments)
        count = page.get_by_role("button", name=action, exact=True).count()
        if count == 0:
            raise SystemExit(f"в таблице прогонов нет действий «{action}»")
        for index in range(count):
            open_route(page, base, routes.experiments)
            page.get_by_role("button", name=action, exact=True).nth(index).click()
            settle(page)


def walk_comparison(page: Page, base: str, routes: Routes) -> None:
    open_route(page, base, routes.comparison)
    click_and_settle(page, "Варианты")
    click_and_settle(page, "Политики")


def walk_results(page: Page, base: str, routes: Routes) -> None:
    for run in (*routes.runs, routes.failure_run):
        open_route(page, base, f"/result/{run}")


def walk_phone(page: Page, base: str, routes: Routes) -> None:
    for route in (
        "/projects",
        routes.network,
        routes.outages,
        routes.experiments,
        routes.comparison,
        f"/result/{routes.runs[0]}",
    ):
        open_route(page, base, route)


def record_grid(recorder: Recorder, api: str, project_id: str, primary: set[str]) -> None:
    """Снимки на узлах сетки для завершённых расчётов проекта, резервные пути — основным."""
    origin = api.removesuffix("/api")
    detail = call(api, "GET", f"/projects/{project_id}")
    for run in detail["recent_runs"]:
        if run["status"] != "succeeded":
            continue
        is_primary = run["id"] in primary
        step_ticks = PRIMARY_STEP_TICKS if is_primary else SECONDARY_STEP_TICKS
        variant = next(item for item in detail["variants"] if item["id"] == run["variant_id"])
        step_s = variant["scenario"]["environment"]["step_s"]
        sites = variant["scenario"]["ground_sites"]
        clients = [site["id"] for site in sites if site["role"] == "client"] if is_primary else []
        prefix = f"/api/runs/{run['id']}"
        for tick in range(0, run["total_ticks"], step_ticks):
            t_s = tick * step_s
            recorder.fetch(origin, f"{prefix}/snapshot?t_s={t_s}")
            for client in clients:
                recorder.fetch(origin, f"{prefix}/backup-paths?t_s={t_s}&client_id={client}")


def load_or_seed(api: str, seed_file: Path | None) -> Seed:
    if seed_file is not None and seed_file.exists():
        raw = json.loads(seed_file.read_text(encoding="utf-8"))
        return Seed(
            project_id=raw["project_id"],
            run_ids=tuple(raw["run_ids"]),
            failure_variant_id=raw["failure_variant_id"],
            experiment_id=raw["experiment_id"],
        )
    data = seed(api)
    if seed_file is not None:
        seed_file.write_text(json.dumps(asdict(data), indent=1), encoding="utf-8")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", default="http://localhost:3000")
    parser.add_argument("--api", default="http://localhost:8000/api")
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument(
        "--seed-file",
        type=Path,
        help="идентификаторы заведённых данных: если файл есть, данные не заводятся заново",
    )
    args = parser.parse_args()

    data = load_or_seed(args.api, args.seed_file)
    routes = routes_for(args.api, data)
    recorder = Recorder()

    desktop = ViewportSize(width=DESKTOP["width"], height=DESKTOP["height"])
    phone = ViewportSize(width=PHONE["width"], height=PHONE["height"])
    # Каждый проход идёт в новом контексте браузера. Выбранный проект хранится в
    # localStorage, и первый визит в раздел без проекта иначе сразу открыл бы проект,
    # выбранный предыдущим проходом, а не экран выбора.
    sessions: list[tuple[str, ViewportSize, Walk]] = [
        ("проекты", desktop, walk_projects),
        ("сеть", desktop, walk_network),
        ("отказы", desktop, walk_outages),
        ("исследования", desktop, walk_experiments),
        ("сравнение", desktop, walk_comparison),
        ("итоги расчётов", desktop, walk_results),
        ("телефон", phone, walk_phone),
        *(
            (f"выбор проекта {section}", desktop, selection_walk(section))
            for section in ("/network", "/outages", "/experiments", "/comparison")
        ),
    ]

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=CHROMIUM_ARGS)
        for label, viewport, walk in sessions:
            print(f"  {label}")
            context = browser.new_context(viewport=viewport)
            context.add_init_script("localStorage.setItem('orbita.onboarding.completed.v1', '1');")
            page = context.new_page()
            page.route("**/api/**", recorder.intercept)
            walk(page, args.base, routes)
            context.close()
        browser.close()

    if recorder.problems:
        for problem in recorder.problems:
            print(problem, file=sys.stderr)
        return 1

    print("  сетка снимков")
    record_grid(recorder, args.api, routes.project, {*routes.runs, routes.failure_run})

    size = recorder.write(args.out)
    print(f"записано ответов: {len(recorder.exchanges)}, {size / 1024 / 1024:.1f} МБ в {args.out}")
    if size > DATA_BUDGET_BYTES:
        print(f"запись больше бюджета {DATA_BUDGET_BYTES // 1024 // 1024} МБ", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
